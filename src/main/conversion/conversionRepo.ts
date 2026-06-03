import type Database from 'better-sqlite3'
import type {
  Preset,
  ConversionFileStatus,
  ResumableBatch
} from '../../shared/ipc-types'

export type ConversionStatus = 'running' | 'done' | 'cancelled' | 'crashed'

export interface ConversionRow {
  id: string
  rootFolder: string
  preset: Preset
  outputDir: string
  status: ConversionStatus
  startedAt: number
  endedAt: number | null
  heartbeatAt: number
}

export interface ConversionFileRow {
  conversionId: string
  filePath: string
  status: ConversionFileStatus
  errorMessage: string | null
  outputPath: string | null
}

export interface CreateConversionParams {
  id: string
  rootFolder: string
  preset: Preset
  outputDir: string
  startedAt: number
}

export interface InsertFileRow {
  filePath: string
  status: ConversionFileStatus
}

export interface UpdateFilePatch {
  status?: ConversionFileStatus
  errorMessage?: string | null
  outputPath?: string | null
}

export interface CompleteConversionPatch {
  status: ConversionStatus
  endedAt: number
}

export interface ConversionRepo {
  createConversion(params: CreateConversionParams): void
  insertFileBatch(rows: InsertFileRow[], conversionId: string): void
  updateFile(conversionId: string, filePath: string, patch: UpdateFilePatch): void
  bumpHeartbeat(conversionId: string, ts: number): void
  complete(conversionId: string, patch: CompleteConversionPatch): void
  findResumable(): ResumableBatch[]
  markStaleAsCrashed(opts: { thresholdMs: number; now: number }): number
  getResumablePending(conversionId: string): string[]
  listFiles(conversionId: string): ConversionFileRow[]
  deleteConversion(conversionId: string): void
  getConversion(conversionId: string): ConversionRow | null
}

/**
 * Schema for the Phase 3 conversion tier (D-CONV-PERSISTENCE).
 *
 * Tables:
 *   - conversions:        one row per batch; heartbeat_at drives crash detection
 *   - conversion_files:   one row per pending/running/terminal file
 *
 * Safe to call repeatedly (`IF NOT EXISTS`). Enables foreign_keys pragma so
 * `ON DELETE CASCADE` on conversion_files is honoured (better-sqlite3 ships
 * with FKs OFF by default per connection).
 */
export function initConversionSchema(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS conversions (' +
      'id TEXT PRIMARY KEY,' +
      'root_folder TEXT NOT NULL,' +
      'preset_json TEXT NOT NULL,' +
      'output_dir TEXT NOT NULL,' +
      "status TEXT NOT NULL CHECK(status IN ('running','done','cancelled','crashed'))," +
      'started_at INTEGER NOT NULL,' +
      'ended_at INTEGER,' +
      'heartbeat_at INTEGER NOT NULL' +
      ');' +
      'CREATE TABLE IF NOT EXISTS conversion_files (' +
      'conversion_id TEXT NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,' +
      'file_path TEXT NOT NULL,' +
      "status TEXT NOT NULL CHECK(status IN ('pending','running','done','error','skipped','cancelled'))," +
      'error_message TEXT,' +
      'output_path TEXT,' +
      'PRIMARY KEY (conversion_id, file_path)' +
      ');' +
      'CREATE INDEX IF NOT EXISTS idx_conversion_files_conv ON conversion_files(conversion_id);'
  )
  db.pragma('foreign_keys = ON')
}

interface ConversionRowDb {
  id: string
  root_folder: string
  preset_json: string
  output_dir: string
  status: ConversionStatus
  started_at: number
  ended_at: number | null
  heartbeat_at: number
}

interface ConversionFileRowDb {
  conversion_id: string
  file_path: string
  status: ConversionFileStatus
  error_message: string | null
  output_path: string | null
}

interface ResumableAggregateDb {
  id: string
  root_folder: string
  preset_json: string
  output_dir: string
  started_at: number
  pending_count: number
  done_count: number
  error_count: number
}

function toConversionRow(r: ConversionRowDb): ConversionRow {
  return {
    id: r.id,
    rootFolder: r.root_folder,
    preset: JSON.parse(r.preset_json) as Preset,
    outputDir: r.output_dir,
    status: r.status,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    heartbeatAt: r.heartbeat_at
  }
}

function toConversionFileRow(r: ConversionFileRowDb): ConversionFileRow {
  return {
    conversionId: r.conversion_id,
    filePath: r.file_path,
    status: r.status,
    errorMessage: r.error_message,
    outputPath: r.output_path
  }
}

/**
 * Build a ConversionRepo bound to the given database. Uses prepared statements
 * exclusively — no template-literal SQL with embedded values (V5 defence).
 *
 * Mirrors createScanRepo from Phase 2 (locked pattern, STATE.md).
 */
export function createConversionRepo(db: Database.Database): ConversionRepo {
  const insertConversionStmt = db.prepare(
    'INSERT INTO conversions (id, root_folder, preset_json, output_dir, status, started_at, heartbeat_at) ' +
      "VALUES (@id, @root_folder, @preset_json, @output_dir, 'running', @started_at, @heartbeat_at)"
  )

  const insertFileStmt = db.prepare(
    'INSERT OR REPLACE INTO conversion_files ' +
      '(conversion_id, file_path, status, error_message, output_path) ' +
      'VALUES (@conversion_id, @file_path, @status, @error_message, @output_path)'
  )

  const updateFileStmt = db.prepare(
    'UPDATE conversion_files SET ' +
      'status = COALESCE(@status, status),' +
      ' error_message = CASE WHEN @error_message_set = 1 THEN @error_message ELSE error_message END,' +
      ' output_path = CASE WHEN @output_path_set = 1 THEN @output_path ELSE output_path END' +
      ' WHERE conversion_id = @conversion_id AND file_path = @file_path'
  )

  const bumpHeartbeatStmt = db.prepare(
    "UPDATE conversions SET heartbeat_at = ? WHERE id = ? AND status = 'running'"
  )

  const completeStmt = db.prepare(
    'UPDATE conversions SET status = @status, ended_at = @ended_at WHERE id = @id'
  )

  const findResumableStmt = db.prepare(
    'SELECT c.id, c.root_folder, c.preset_json, c.output_dir, c.started_at,' +
      "  SUM(CASE WHEN f.status IN ('pending','running','error') THEN 1 ELSE 0 END) AS pending_count," +
      "  SUM(CASE WHEN f.status = 'done' THEN 1 ELSE 0 END) AS done_count," +
      "  SUM(CASE WHEN f.status = 'error' THEN 1 ELSE 0 END) AS error_count" +
      ' FROM conversions c' +
      ' LEFT JOIN conversion_files f ON f.conversion_id = c.id' +
      " WHERE c.status = 'crashed'" +
      ' GROUP BY c.id' +
      ' ORDER BY c.started_at DESC'
  )

  const markStaleStmt = db.prepare(
    "UPDATE conversions SET status = 'crashed', ended_at = @now" +
      " WHERE status = 'running' AND heartbeat_at < (@now - @thresholdMs)"
  )

  const getResumablePendingStmt = db.prepare(
    'SELECT file_path FROM conversion_files' +
      ' WHERE conversion_id = ?' +
      " AND status IN ('pending','running','error')" +
      ' ORDER BY file_path ASC'
  )

  const listFilesStmt = db.prepare(
    'SELECT conversion_id, file_path, status, error_message, output_path' +
      ' FROM conversion_files WHERE conversion_id = ? ORDER BY rowid ASC'
  )

  const deleteConversionStmt = db.prepare('DELETE FROM conversions WHERE id = ?')

  const getConversionStmt = db.prepare('SELECT * FROM conversions WHERE id = ?')

  // One transaction per IPC batch — ~100× faster than per-row commits.
  const insertFileBatchTx = db.transaction((rows: InsertFileRow[], conversionId: string) => {
    for (const r of rows) {
      insertFileStmt.run({
        conversion_id: conversionId,
        file_path: r.filePath,
        status: r.status,
        error_message: null,
        output_path: null
      })
    }
  })

  return {
    createConversion({ id, rootFolder, preset, outputDir, startedAt }) {
      insertConversionStmt.run({
        id,
        root_folder: rootFolder,
        preset_json: JSON.stringify(preset),
        output_dir: outputDir,
        started_at: startedAt,
        heartbeat_at: startedAt
      })
    },

    insertFileBatch(rows, conversionId) {
      if (rows.length === 0) return
      insertFileBatchTx(rows, conversionId)
    },

    updateFile(conversionId, filePath, patch) {
      updateFileStmt.run({
        conversion_id: conversionId,
        file_path: filePath,
        status: patch.status ?? null,
        error_message_set: patch.errorMessage !== undefined ? 1 : 0,
        error_message: patch.errorMessage ?? null,
        output_path_set: patch.outputPath !== undefined ? 1 : 0,
        output_path: patch.outputPath ?? null
      })
    },

    bumpHeartbeat(conversionId, ts) {
      bumpHeartbeatStmt.run(ts, conversionId)
    },

    complete(conversionId, patch) {
      completeStmt.run({
        id: conversionId,
        status: patch.status,
        ended_at: patch.endedAt
      })
    },

    findResumable() {
      const rows = findResumableStmt.all() as ResumableAggregateDb[]
      return rows.map((r) => ({
        conversionId: r.id,
        rootFolder: r.root_folder,
        preset: JSON.parse(r.preset_json) as Preset,
        outputDir: r.output_dir,
        pendingCount: Number(r.pending_count ?? 0),
        doneCount: Number(r.done_count ?? 0),
        errorCount: Number(r.error_count ?? 0),
        startedAt: r.started_at
      }))
    },

    markStaleAsCrashed({ thresholdMs, now }) {
      const result = markStaleStmt.run({ now, thresholdMs })
      return result.changes ?? 0
    },

    getResumablePending(conversionId) {
      const rows = getResumablePendingStmt.all(conversionId) as { file_path: string }[]
      return rows.map((r) => r.file_path)
    },

    listFiles(conversionId) {
      const rows = listFilesStmt.all(conversionId) as ConversionFileRowDb[]
      return rows.map(toConversionFileRow)
    },

    deleteConversion(conversionId) {
      deleteConversionStmt.run(conversionId)
    },

    getConversion(conversionId) {
      const r = getConversionStmt.get(conversionId) as ConversionRowDb | undefined
      return r ? toConversionRow(r) : null
    }
  }
}
