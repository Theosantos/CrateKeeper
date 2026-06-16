import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createTaggerRepo, initTaggerSchema, type TaggerRepo } from './taggerRepo'
import { initScanSchema } from '../scan/scanRepo'
import type { PendingTagEdit } from '../../shared/ipc-types'

const TAGGER_REPO_SOURCE = readFileSync(path.join(__dirname, 'taggerRepo.ts'), 'utf8')

function edit(overrides: Partial<PendingTagEdit> = {}): PendingTagEdit {
  return {
    filePath: '/Music/a.mp3',
    genre: 'House',
    bpm: 128,
    key: '8A',
    artist: 'Artist',
    title: 'Title',
    comment: null,
    rating: 4,
    updatedAt: 1000,
    appliedAt: null,
    ...overrides
  }
}

describe('taggerRepo', () => {
  let db: Database.Database
  let repo: TaggerRepo

  beforeEach(() => {
    db = new Database(':memory:')
    initScanSchema(db) // topGenres reads scanned_files
    initTaggerSchema(db)
    repo = createTaggerRepo(db)
  })

  describe('initTaggerSchema', () => {
    it('creates pending_tag_edits + tagger_session tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
      const names = tables.map((t) => t.name)
      expect(names).toContain('pending_tag_edits')
      expect(names).toContain('tagger_session')
    })

    it('is safe to call twice (IF NOT EXISTS)', () => {
      expect(() => initTaggerSchema(db)).not.toThrow()
    })
  })

  describe('upsertEdit', () => {
    it('inserts a new row with updated_at=now and applied_at=NULL', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      const r = repo.getEdit('/M/a.mp3')
      expect(r).not.toBeNull()
      expect(r!.updatedAt).toBe(1000)
      expect(r!.appliedAt).toBeNull()
      expect(r!.genre).toBe('House')
    })

    it('UPSERTs on conflict but preserves applied_at set by a prior write', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3', genre: 'House' }), 1000)
      // Simulate Phase 5 marking the row as applied.
      db.prepare(
        'UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?'
      ).run(5000, '/M/a.mp3')

      // Re-edit (Phase 4) — applied_at must stay set.
      repo.upsertEdit(edit({ filePath: '/M/a.mp3', genre: 'Techno' }), 2000)
      const r = repo.getEdit('/M/a.mp3')
      expect(r!.genre).toBe('Techno')
      expect(r!.updatedAt).toBe(2000)
      expect(r!.appliedAt).toBe(5000)
    })

    it('rejects rating=6 (DB CHECK 1..5)', () => {
      expect(() => repo.upsertEdit(edit({ rating: 6 }), 1000)).toThrow()
    })

    it('rejects rating=0 (DB CHECK)', () => {
      expect(() => repo.upsertEdit(edit({ rating: 0 }), 1000)).toThrow()
    })

    it('accepts rating=null', () => {
      expect(() => repo.upsertEdit(edit({ rating: null }), 1000)).not.toThrow()
      expect(repo.getEdit('/Music/a.mp3')!.rating).toBeNull()
    })
  })

  describe('deleteEdit + getEdit', () => {
    it('removes the row; subsequent getEdit returns null', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      repo.deleteEdit('/M/a.mp3')
      expect(repo.getEdit('/M/a.mp3')).toBeNull()
    })

    it('getEdit returns null for missing path', () => {
      expect(repo.getEdit('/nope')).toBeNull()
    })
  })

  describe('listEditsByPaths', () => {
    it('returns Map keyed by file_path of matching rows', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      repo.upsertEdit(edit({ filePath: '/M/b.mp3' }), 1000)
      repo.upsertEdit(edit({ filePath: '/M/c.mp3' }), 1000)
      const m = repo.listEditsByPaths(['/M/a.mp3', '/M/b.mp3'])
      expect(m.size).toBe(2)
      expect(m.get('/M/a.mp3')).toBeDefined()
      expect(m.get('/M/b.mp3')).toBeDefined()
      expect(m.get('/M/c.mp3')).toBeUndefined()
    })

    it('returns empty Map for empty input without running a query', () => {
      // No way to spy directly; just assert it does not throw and returns empty.
      const m = repo.listEditsByPaths([])
      expect(m.size).toBe(0)
    })
  })

  describe('session', () => {
    it('getSession returns null when no row exists', () => {
      expect(repo.getSession()).toBeNull()
    })

    it('setSession UPSERTs the single id=1 row', () => {
      repo.setSession(
        { rootFolder: '/Music', currentFilePath: '/Music/a.mp3', scanId: 's1' },
        2000
      )
      const s1 = repo.getSession()
      expect(s1!.rootFolder).toBe('/Music')
      expect(s1!.currentFilePath).toBe('/Music/a.mp3')
      expect(s1!.scanId).toBe('s1')
      expect(s1!.updatedAt).toBe(2000)

      repo.setSession(
        { rootFolder: '/Music', currentFilePath: '/Music/b.mp3', scanId: 's2' },
        3000
      )
      const s2 = repo.getSession()
      expect(s2!.currentFilePath).toBe('/Music/b.mp3')
      expect(s2!.scanId).toBe('s2')
      expect(s2!.updatedAt).toBe(3000)
    })

    it('only one row allowed (CHECK id=1)', () => {
      repo.setSession(
        { rootFolder: '/Music', currentFilePath: null, scanId: null },
        1000
      )
      const rows = db.prepare('SELECT COUNT(*) AS n FROM tagger_session').get() as {
        n: number
      }
      expect(rows.n).toBe(1)
    })
  })

  describe('topGenres', () => {
    function seedScannedFile(genre: string | null, path: string): void {
      db.prepare(
        'INSERT INTO scans (id, root_folder, started_at, status) ' +
          "VALUES ('s', '/M', 1, 'done') ON CONFLICT(id) DO NOTHING"
      ).run()
      db.prepare(
        'INSERT INTO scanned_files (scan_id, path, format, size_bytes, has_genre, has_bpm, has_key, parsed_ok) ' +
          "VALUES ('s', ?, 'MP3', 1, 1, 1, 1, 1)"
      ).run(path)
      if (genre !== null) {
        db.prepare('UPDATE scanned_files SET genre = ? WHERE path = ?').run(
          genre,
          path
        )
      }
    }

    it('returns up to N rows ordered by count DESC', () => {
      seedScannedFile('House', '/M/a.mp3')
      seedScannedFile('House', '/M/b.mp3')
      seedScannedFile('House', '/M/c.mp3')
      seedScannedFile('Techno', '/M/d.mp3')
      seedScannedFile('Techno', '/M/e.mp3')
      seedScannedFile('Disco', '/M/f.mp3')

      const top = repo.topGenres(9)
      expect(top[0]).toEqual({ genre: 'House', count: 3 })
      expect(top[1]).toEqual({ genre: 'Techno', count: 2 })
      expect(top[2]).toEqual({ genre: 'Disco', count: 1 })
    })

    it('excludes rows with NULL or empty genre', () => {
      seedScannedFile('House', '/M/a.mp3')
      seedScannedFile(null, '/M/null.mp3')
      seedScannedFile('', '/M/empty.mp3')
      const top = repo.topGenres(9)
      expect(top).toHaveLength(1)
      expect(top[0].genre).toBe('House')
    })

    it('returns [] when no rows', () => {
      expect(repo.topGenres(9)).toEqual([])
    })
  })

  describe('SQL safety (V5 defence-in-depth)', () => {
    it('uses prepared statements exclusively (no interpolated SQL with values)', () => {
      const offending = TAGGER_REPO_SOURCE.match(
        /`[^`]*\$\{[^`]*(SELECT|INSERT|UPDATE|DELETE|FROM)[^`]*`/i
      )
      expect(offending).toBeNull()
    })

    it('source contains the literal re-edit predicate (applied_at IS NULL OR updated_at > applied_at)', () => {
      expect(TAGGER_REPO_SOURCE).toContain('applied_at IS NULL OR updated_at > applied_at')
    })
  })

  // ── Phase 5: listPendingWrites + markApplied ────────────────────────────────

  describe('listPendingWrites (Phase 5 — re-edit predicate)', () => {
    it('includes a row with applied_at=NULL', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      const pending = repo.listPendingWrites()
      expect(pending.map((p) => p.filePath)).toContain('/M/a.mp3')
    })

    it('includes a re-edited row (updated_at > applied_at)', () => {
      // Simulate: file written at T=2000, then re-edited at T=3000
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      db.prepare('UPDATE pending_tag_edits SET applied_at = 2000 WHERE file_path = ?').run(
        '/M/a.mp3'
      )
      // Re-edit bumps updated_at to 3000
      repo.upsertEdit(edit({ filePath: '/M/a.mp3', genre: 'Techno' }), 3000)
      const pending = repo.listPendingWrites()
      expect(pending.map((p) => p.filePath)).toContain('/M/a.mp3')
    })

    it('excludes a row that was written AFTER its last edit (applied_at >= updated_at)', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000) // updated_at = 1000
      // applied_at=2000 > updated_at=1000 → already written, not re-edited
      db.prepare('UPDATE pending_tag_edits SET applied_at = 2000 WHERE file_path = ?').run(
        '/M/a.mp3'
      )
      const pending = repo.listPendingWrites()
      expect(pending.map((p) => p.filePath)).not.toContain('/M/a.mp3')
    })
  })

  describe('markApplied (Phase 5 — per-file)', () => {
    it('sets applied_at only for the named file_path (D-05)', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      repo.upsertEdit(edit({ filePath: '/M/b.mp3' }), 1000)

      repo.markApplied('/M/a.mp3', 5000)

      const a = repo.getEdit('/M/a.mp3')!
      const b = repo.getEdit('/M/b.mp3')!
      expect(a.appliedAt).toBe(5000)
      expect(b.appliedAt).toBeNull() // b must be unchanged
    })

    it('after markApplied a row is no longer in listPendingWrites', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      repo.markApplied('/M/a.mp3', 5000)
      // applied_at=5000 > updated_at=1000 → written after last edit → excluded
      const pending = repo.listPendingWrites()
      expect(pending.map((p) => p.filePath)).not.toContain('/M/a.mp3')
    })

    it('per-file failure leaves untouched rows pending (D-05)', () => {
      repo.upsertEdit(edit({ filePath: '/M/a.mp3' }), 1000)
      repo.upsertEdit(edit({ filePath: '/M/b.mp3' }), 1000)

      // Only mark a applied; b stays pending
      repo.markApplied('/M/a.mp3', 5000)

      const pending = repo.listPendingWrites()
      expect(pending.map((p) => p.filePath)).not.toContain('/M/a.mp3')
      expect(pending.map((p) => p.filePath)).toContain('/M/b.mp3')
    })
  })
})
