import type Database from 'better-sqlite3'
import type { PendingTagEdit, TaggerSession } from '../../shared/ipc-types'

export interface GenreCount {
  genre: string
  count: number
}

export interface TaggerRepo {
  upsertEdit(row: PendingTagEdit, now: number): void
  deleteEdit(filePath: string): void
  getEdit(filePath: string): PendingTagEdit | null
  listEditsByPaths(paths: string[]): Map<string, PendingTagEdit>
  getSession(): TaggerSession | null
  setSession(
    input: {
      rootFolder: string
      currentFilePath: string | null
      scanId: string | null
    },
    now: number
  ): void
  /**
   * Cross-table read: queries scanned_files (Phase 2 schema). Returns the
   * top `limit` non-empty genres ordered by count DESC.
   */
  topGenres(limit: number): GenreCount[]
  /**
   * Phase 5 — Returns all pending_tag_edits that have not yet been written,
   * OR were re-edited after a prior write (Option B re-edit predicate, adopted
   * per RESEARCH recommendation):
   *   `applied_at IS NULL OR updated_at > applied_at`
   *
   * This correctly re-includes rows where the user made a new edit after a prior
   * Appliquer pass without clearing applied_at (04-CONTEXT.md constraint).
   */
  listPendingWrites(): PendingTagEdit[]
  /**
   * Phase 5 — Mark a single file as written (D-05 per-file retryable).
   * Sets applied_at=now ONLY for the named file_path. A per-file write failure
   * leaves applied_at=NULL for that path so it stays retryable.
   */
  markApplied(filePath: string, now: number): void
}

/**
 * Phase 4 Plan 01 — Tagger persistence schema.
 *
 * Tables:
 *   - pending_tag_edits: PK file_path; applied_at NULL until Phase 5 writes the file
 *   - tagger_session:    single-row table (CHECK id=1) for session-resume identity
 *
 * Safe to call repeatedly (`IF NOT EXISTS`). Mirrors initConversionSchema.
 */
export function initTaggerSchema(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS pending_tag_edits (' +
      'file_path TEXT PRIMARY KEY,' +
      'genre TEXT,' +
      'bpm INTEGER,' +
      'key TEXT,' +
      'artist TEXT,' +
      'title TEXT,' +
      'comment TEXT,' +
      'rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),' +
      'updated_at INTEGER NOT NULL,' +
      'applied_at INTEGER' +
      ');' +
      'CREATE TABLE IF NOT EXISTS tagger_session (' +
      'id INTEGER PRIMARY KEY CHECK(id = 1),' +
      'root_folder TEXT NOT NULL,' +
      'current_file_path TEXT,' +
      'scan_id TEXT,' +
      'updated_at INTEGER NOT NULL' +
      ');'
  )
  // Symmetry with conversionRepo; no FKs in this schema but pragma kept for parity.
  db.pragma('foreign_keys = ON')
}

interface PendingTagEditDb {
  file_path: string
  genre: string | null
  bpm: number | null
  key: string | null
  artist: string | null
  title: string | null
  comment: string | null
  rating: number | null
  updated_at: number
  applied_at: number | null
}

interface TaggerSessionDb {
  id: number
  root_folder: string
  current_file_path: string | null
  scan_id: string | null
  updated_at: number
}

interface GenreCountDb {
  genre: string
  count: number
}

function toPendingTagEdit(r: PendingTagEditDb): PendingTagEdit {
  return {
    filePath: r.file_path,
    genre: r.genre,
    bpm: r.bpm,
    key: r.key,
    artist: r.artist,
    title: r.title,
    comment: r.comment,
    rating: r.rating,
    updatedAt: r.updated_at,
    appliedAt: r.applied_at
  }
}

function toTaggerSession(r: TaggerSessionDb): TaggerSession {
  return {
    rootFolder: r.root_folder,
    currentFilePath: r.current_file_path,
    scanId: r.scan_id,
    updatedAt: r.updated_at
  }
}

/**
 * Build a TaggerRepo bound to the given database. Uses prepared statements
 * exclusively — no template-literal SQL with embedded values (V5 defence,
 * T-4-06 mitigation).
 *
 * Mirrors createConversionRepo from Phase 3 (locked pattern, STATE.md).
 */
export function createTaggerRepo(db: Database.Database): TaggerRepo {
  // upsertEdit intentionally OMITS applied_at from the UPDATE clause: Phase 5
  // sets applied_at when the file is actually written, and a Phase 4 re-edit
  // must NOT clear that marker (LOCKED in 04-CONTEXT.md).
  const upsertEditStmt = db.prepare(
    'INSERT INTO pending_tag_edits ' +
      '(file_path, genre, bpm, key, artist, title, comment, rating, updated_at) ' +
      'VALUES (@file_path, @genre, @bpm, @key, @artist, @title, @comment, @rating, @updated_at) ' +
      'ON CONFLICT(file_path) DO UPDATE SET ' +
      ' genre = excluded.genre,' +
      ' bpm = excluded.bpm,' +
      ' key = excluded.key,' +
      ' artist = excluded.artist,' +
      ' title = excluded.title,' +
      ' comment = excluded.comment,' +
      ' rating = excluded.rating,' +
      ' updated_at = excluded.updated_at'
  )

  const deleteEditStmt = db.prepare(
    'DELETE FROM pending_tag_edits WHERE file_path = ?'
  )

  const getEditStmt = db.prepare(
    'SELECT * FROM pending_tag_edits WHERE file_path = ?'
  )

  const getSessionStmt = db.prepare(
    'SELECT * FROM tagger_session WHERE id = 1'
  )

  const setSessionStmt = db.prepare(
    'INSERT INTO tagger_session ' +
      '(id, root_folder, current_file_path, scan_id, updated_at) ' +
      'VALUES (1, @root_folder, @current_file_path, @scan_id, @updated_at) ' +
      'ON CONFLICT(id) DO UPDATE SET ' +
      ' root_folder = excluded.root_folder,' +
      ' current_file_path = excluded.current_file_path,' +
      ' scan_id = excluded.scan_id,' +
      ' updated_at = excluded.updated_at'
  )

  // Cross-table read of Phase 2 scanned_files (LOCKED in 04-CONTEXT.md).
  const topGenresStmt = db.prepare(
    "SELECT genre, COUNT(*) AS count FROM scanned_files " +
      "WHERE genre IS NOT NULL AND genre != '' " +
      'GROUP BY genre ORDER BY count DESC LIMIT ?'
  )

  // Phase 5: re-edit predicate (Option B, adopted per RESEARCH recommendation):
  // Rows are pending if applied_at IS NULL (never written) OR updated_at > applied_at
  // (re-edited after a prior write). Does NOT clear applied_at on re-edit.
  const listPendingWritesStmt = db.prepare(
    'SELECT * FROM pending_tag_edits ' +
    'WHERE applied_at IS NULL OR updated_at > applied_at'
  )

  // Phase 5: per-file mark-applied. Positional bind: (now, filePath).
  const markAppliedStmt = db.prepare(
    'UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?'
  )

  return {
    upsertEdit(row, now) {
      upsertEditStmt.run({
        file_path: row.filePath,
        genre: row.genre,
        bpm: row.bpm,
        key: row.key,
        artist: row.artist,
        title: row.title,
        comment: row.comment,
        rating: row.rating,
        updated_at: now
      })
    },

    deleteEdit(filePath) {
      deleteEditStmt.run(filePath)
    },

    getEdit(filePath) {
      const r = getEditStmt.get(filePath) as PendingTagEditDb | undefined
      return r ? toPendingTagEdit(r) : null
    },

    listEditsByPaths(paths) {
      const out = new Map<string, PendingTagEdit>()
      if (paths.length === 0) return out
      // Dynamic placeholder count — values still bound, not interpolated.
      // Build the SQL via string concatenation (not template literals) to
      // keep the V5 grep gate clean (no ${} inside SQL strings).
      const placeholders = paths.map(() => '?').join(', ')
      const stmt = db.prepare(
        'SELECT * FROM pending_tag_edits WHERE file_path IN (' + placeholders + ')'
      )
      const rows = stmt.all(...paths) as PendingTagEditDb[]
      for (const r of rows) {
        out.set(r.file_path, toPendingTagEdit(r))
      }
      return out
    },

    getSession() {
      const r = getSessionStmt.get() as TaggerSessionDb | undefined
      return r ? toTaggerSession(r) : null
    },

    setSession(input, now) {
      setSessionStmt.run({
        root_folder: input.rootFolder,
        current_file_path: input.currentFilePath,
        scan_id: input.scanId,
        updated_at: now
      })
    },

    topGenres(limit) {
      const rows = topGenresStmt.all(limit) as GenreCountDb[]
      return rows.map((r) => ({ genre: r.genre, count: Number(r.count) }))
    },

    listPendingWrites() {
      const rows = listPendingWritesStmt.all() as PendingTagEditDb[]
      return rows.map(toPendingTagEdit)
    },

    markApplied(filePath, now) {
      markAppliedStmt.run(now, filePath)
    }
  }
}
