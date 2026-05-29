import type Database from 'better-sqlite3'
import type { ScannedFile } from '../../shared/ipc-types'

export type ScanStatus = 'running' | 'done' | 'cancelled' | 'error'

export interface ScanRow {
  id: string
  rootFolder: string
  startedAt: number
  endedAt: number | null
  totalFiles: number | null
  status: ScanStatus
}

export interface CompletePatch {
  status: ScanStatus
  totalFiles?: number | null
  endedAt: number
}

export interface ScanRepo {
  createScan(id: string, rootFolder: string, startedAt: number): void
  replaceScanForFolder(id: string, rootFolder: string, startedAt: number): void
  insertBatch(rows: ScannedFile[], scanId: string): void
  complete(scanId: string, patch: CompletePatch): void
  getScan(scanId: string): ScanRow | null
  listFiles(scanId: string): ScannedFile[]
  iterateFiles(scanId: string): IterableIterator<ScannedFile>
  deleteScansForFolder(rootFolder: string): void
}

/**
 * Ensure the scans + scanned_files tables exist. Safe to call repeatedly.
 * Mirrors the createXRepo + initXSchema(db) factory pattern from settingsRepo.
 */
export function initScanSchema(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS scans (' +
      'id TEXT PRIMARY KEY,' +
      'root_folder TEXT NOT NULL,' +
      'started_at INTEGER NOT NULL,' +
      'ended_at INTEGER,' +
      'total_files INTEGER,' +
      "status TEXT NOT NULL CHECK(status IN ('running','done','cancelled','error'))" +
      ');' +
      'CREATE TABLE IF NOT EXISTS scanned_files (' +
      'scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,' +
      'path TEXT NOT NULL,' +
      'format TEXT,' +
      'bitrate INTEGER,' +
      'size_bytes INTEGER NOT NULL,' +
      'sample_rate INTEGER,' +
      'duration_seconds REAL,' +
      'has_genre INTEGER NOT NULL,' +
      'has_bpm INTEGER NOT NULL,' +
      'has_key INTEGER NOT NULL,' +
      'parsed_ok INTEGER NOT NULL,' +
      'error_message TEXT,' +
      'PRIMARY KEY (scan_id, path)' +
      ');' +
      'CREATE INDEX IF NOT EXISTS idx_scanned_files_scan ON scanned_files(scan_id);'
  )
  // Enforce ON DELETE CASCADE (off by default in SQLite per connection).
  db.pragma('foreign_keys = ON')
}

interface ScanRowDb {
  id: string
  root_folder: string
  started_at: number
  ended_at: number | null
  total_files: number | null
  status: ScanStatus
}

interface FileRowDb {
  path: string
  format: string | null
  bitrate: number | null
  size_bytes: number
  sample_rate: number | null
  duration_seconds: number | null
  has_genre: number
  has_bpm: number
  has_key: number
  parsed_ok: number
  error_message: string | null
}

function toScanRow(r: ScanRowDb): ScanRow {
  return {
    id: r.id,
    rootFolder: r.root_folder,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    totalFiles: r.total_files,
    status: r.status
  }
}

function toScannedFile(r: FileRowDb): ScannedFile {
  return {
    path: r.path,
    format: r.format ?? 'UNKNOWN',
    bitrate: r.bitrate,
    sizeBytes: r.size_bytes,
    sampleRate: r.sample_rate,
    durationSeconds: r.duration_seconds,
    hasGenre: r.has_genre === 1,
    hasBpm: r.has_bpm === 1,
    hasKey: r.has_key === 1,
    parsedOk: r.parsed_ok === 1,
    errorMessage: r.error_message
  }
}

/**
 * Build a ScanRepo bound to the given Database. Uses prepared statements only —
 * no template-literal SQL with embedded values (defence-in-depth for V5).
 */
export function createScanRepo(db: Database.Database): ScanRepo {
  const insertScanStmt = db.prepare(
    'INSERT INTO scans (id, root_folder, started_at, status) VALUES (?, ?, ?, ?)'
  )
  const deleteScansForFolderStmt = db.prepare('DELETE FROM scans WHERE root_folder = ?')
  const completeStmt = db.prepare(
    'UPDATE scans SET status = @status, total_files = @totalFiles, ended_at = @endedAt WHERE id = @id'
  )
  const getScanStmt = db.prepare('SELECT * FROM scans WHERE id = ?')
  const insertFileStmt = db.prepare(
    'INSERT OR REPLACE INTO scanned_files ' +
      '(scan_id, path, format, bitrate, size_bytes, sample_rate, duration_seconds,' +
      ' has_genre, has_bpm, has_key, parsed_ok, error_message) ' +
      'VALUES (@scan_id, @path, @format, @bitrate, @size_bytes, @sample_rate, @duration_seconds,' +
      ' @has_genre, @has_bpm, @has_key, @parsed_ok, @error_message)'
  )
  const listFilesStmt = db.prepare(
    'SELECT path, format, bitrate, size_bytes, sample_rate, duration_seconds,' +
      ' has_genre, has_bpm, has_key, parsed_ok, error_message' +
      ' FROM scanned_files WHERE scan_id = ? ORDER BY path ASC'
  )

  const insertBatch = db.transaction((rows: ScannedFile[], scanId: string) => {
    for (const r of rows) {
      insertFileStmt.run({
        scan_id: scanId,
        path: r.path,
        format: r.format,
        bitrate: r.bitrate,
        size_bytes: r.sizeBytes,
        sample_rate: r.sampleRate,
        duration_seconds: r.durationSeconds,
        has_genre: r.hasGenre ? 1 : 0,
        has_bpm: r.hasBpm ? 1 : 0,
        has_key: r.hasKey ? 1 : 0,
        parsed_ok: r.parsedOk ? 1 : 0,
        error_message: r.errorMessage
      })
    }
  })

  const replaceForFolder = db.transaction((id: string, folder: string, startedAt: number) => {
    deleteScansForFolderStmt.run(folder)
    insertScanStmt.run(id, folder, startedAt, 'running')
  })

  return {
    createScan(id, rootFolder, startedAt) {
      insertScanStmt.run(id, rootFolder, startedAt, 'running')
    },

    replaceScanForFolder(id, rootFolder, startedAt) {
      replaceForFolder(id, rootFolder, startedAt)
    },

    insertBatch(rows, scanId) {
      if (rows.length === 0) {
        return
      }
      insertBatch(rows, scanId)
    },

    complete(scanId, patch) {
      completeStmt.run({
        id: scanId,
        status: patch.status,
        totalFiles: patch.totalFiles ?? null,
        endedAt: patch.endedAt
      })
    },

    getScan(scanId) {
      const r = getScanStmt.get(scanId) as ScanRowDb | undefined
      return r ? toScanRow(r) : null
    },

    listFiles(scanId) {
      const rows = listFilesStmt.all(scanId) as FileRowDb[]
      return rows.map(toScannedFile)
    },

    *iterateFiles(scanId) {
      for (const row of listFilesStmt.iterate(scanId) as IterableIterator<FileRowDb>) {
        yield toScannedFile(row)
      }
    },

    deleteScansForFolder(rootFolder) {
      deleteScansForFolderStmt.run(rootFolder)
    }
  }
}
