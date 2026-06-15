import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { createScanRepo, initScanSchema, type ScanRepo } from './scanRepo'
import type { ScannedFile } from '../../shared/ipc-types'

const SCAN_REPO_SOURCE = readFileSync(path.join(__dirname, 'scanRepo.ts'), 'utf8')

function row(overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path: '/Music/track.mp3',
    format: 'MP3',
    bitrate: 320,
    sizeBytes: 1024,
    sampleRate: 44100,
    durationSeconds: 180,
    hasGenre: true,
    hasBpm: true,
    hasKey: true,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

describe('scanRepo', () => {
  let db: Database.Database
  let repo: ScanRepo

  beforeEach(() => {
    db = new Database(':memory:')
    initScanSchema(db)
    repo = createScanRepo(db)
  })

  describe('initScanSchema', () => {
    it('creates the scans and scanned_files tables', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
      const names = tables.map((t) => t.name)
      expect(names).toContain('scans')
      expect(names).toContain('scanned_files')
    })

    it('is safe to call twice (IF NOT EXISTS)', () => {
      expect(() => initScanSchema(db)).not.toThrow()
    })
  })

  describe('createScan', () => {
    it('inserts a row with status=running', () => {
      repo.createScan('scan-1', '/Music', 1_000)
      const r = repo.getScan('scan-1')
      expect(r).not.toBeNull()
      expect(r!.status).toBe('running')
      expect(r!.rootFolder).toBe('/Music')
      expect(r!.startedAt).toBe(1_000)
    })
  })

  describe('insertBatch', () => {
    it('inserts all rows in a single transaction', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch([row({ path: '/M/a.mp3' }), row({ path: '/M/b.mp3' })], 's1')
      const files = repo.listFiles('s1')
      expect(files).toHaveLength(2)
      expect(files.map((f) => f.path).sort()).toEqual(['/M/a.mp3', '/M/b.mp3'])
    })

    it('is idempotent on same (scanId, path) via INSERT OR REPLACE', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch([row({ path: '/M/a.mp3', bitrate: 128 })], 's1')
      repo.insertBatch([row({ path: '/M/a.mp3', bitrate: 320 })], 's1')
      const files = repo.listFiles('s1')
      expect(files).toHaveLength(1)
      expect(files[0].bitrate).toBe(320)
    })

    it('round-trips booleans via 0/1 storage', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch(
        [row({ path: '/M/a.mp3', hasGenre: false, hasBpm: false, hasKey: false })],
        's1'
      )
      const [f] = repo.listFiles('s1')
      expect(f.hasGenre).toBe(false)
      expect(f.hasBpm).toBe(false)
      expect(f.hasKey).toBe(false)
    })
  })

  describe('complete', () => {
    it('updates status / totalFiles / endedAt', () => {
      repo.createScan('s1', '/M', 1)
      repo.complete('s1', { status: 'done', totalFiles: 42, endedAt: 2_000 })
      const r = repo.getScan('s1')
      expect(r!.status).toBe('done')
      expect(r!.totalFiles).toBe(42)
      expect(r!.endedAt).toBe(2_000)
    })
  })

  describe('listFiles', () => {
    it('returns ScannedFile rows in stable order', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch(
        [
          row({ path: '/M/b.mp3' }),
          row({ path: '/M/a.mp3' }),
          row({ path: '/M/c.mp3' })
        ],
        's1'
      )
      const files = repo.listFiles('s1')
      // Stable: same call returns same order
      expect(repo.listFiles('s1').map((f) => f.path)).toEqual(files.map((f) => f.path))
    })
  })

  describe('iterateFiles', () => {
    it('yields ScannedFile rows one at a time (for streaming CSV in Plan 02-03)', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch([row({ path: '/M/a.mp3' }), row({ path: '/M/b.mp3' })], 's1')
      const collected: ScannedFile[] = []
      for (const f of repo.iterateFiles('s1')) {
        collected.push(f)
      }
      expect(collected).toHaveLength(2)
      expect(collected[0]).toHaveProperty('path')
      expect(collected[0]).toHaveProperty('hasGenre')
    })
  })

  describe('replaceScanForFolder (one-scan-per-folder, Open Question 5)', () => {
    it('deletes prior scans for the same root folder before inserting the new running scan', () => {
      repo.createScan('old', '/M', 1)
      repo.insertBatch([row({ path: '/M/a.mp3' })], 'old')

      repo.replaceScanForFolder('new', '/M', 100)

      expect(repo.getScan('old')).toBeNull()
      expect(repo.listFiles('old')).toHaveLength(0)
      const fresh = repo.getScan('new')
      expect(fresh).not.toBeNull()
      expect(fresh!.status).toBe('running')
      expect(fresh!.rootFolder).toBe('/M')
    })

    it('does not touch scans for a different root folder', () => {
      repo.createScan('keep', '/Other', 1)
      repo.replaceScanForFolder('fresh', '/M', 2)
      expect(repo.getScan('keep')).not.toBeNull()
    })
  })

  describe('deleteScansForFolder', () => {
    it('removes all scans + cascaded files for a given root folder', () => {
      repo.createScan('a', '/M', 1)
      repo.insertBatch([row({ path: '/M/x.mp3' })], 'a')
      repo.deleteScansForFolder('/M')
      expect(repo.getScan('a')).toBeNull()
      expect(repo.listFiles('a')).toHaveLength(0)
    })
  })

  describe('findLatestScan (Phase 4 — Tagger queue source)', () => {
    it('returns the most recent done scan for the folder', () => {
      repo.createScan('s1', '/Music', 100)
      repo.complete('s1', { status: 'done', totalFiles: 1, endedAt: 200 })
      repo.createScan('s2', '/Music', 300)
      repo.complete('s2', { status: 'done', totalFiles: 1, endedAt: 400 })
      const r = repo.findLatestScan('/Music')
      expect(r?.id).toBe('s2')
    })

    it('excludes running status (returns older done instead)', () => {
      repo.createScan('older', '/Music', 100)
      repo.complete('older', { status: 'done', totalFiles: 1, endedAt: 200 })
      repo.createScan('runner', '/Music', 500)
      // still running — not completed
      const r = repo.findLatestScan('/Music')
      expect(r?.id).toBe('older')
    })

    it('excludes cancelled and error statuses', () => {
      repo.createScan('c', '/Music', 100)
      repo.complete('c', { status: 'cancelled', endedAt: 200 })
      repo.createScan('e', '/Music', 300)
      repo.complete('e', { status: 'error', endedAt: 400 })
      const r = repo.findLatestScan('/Music')
      expect(r).toBeNull()
    })

    it('returns null when no scans exist for the folder', () => {
      expect(repo.findLatestScan('/Music')).toBeNull()
    })

    it('returns null when only non-done scans exist', () => {
      repo.createScan('r', '/Music', 100)
      // still running
      expect(repo.findLatestScan('/Music')).toBeNull()
    })
  })

  describe('listIncompleteFiles (Phase 4 — Tagger queue source)', () => {
    it('returns rows missing at least one of has_genre/has_bpm/has_key, path ASC', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch(
        [
          row({ path: '/M/c.mp3', hasGenre: false, hasBpm: true, hasKey: true }),
          row({ path: '/M/a.mp3', hasGenre: true, hasBpm: false, hasKey: true }),
          row({ path: '/M/b.mp3', hasGenre: true, hasBpm: true, hasKey: false }),
          row({ path: '/M/full.mp3', hasGenre: true, hasBpm: true, hasKey: true })
        ],
        's1'
      )
      const files = repo.listIncompleteFiles('s1')
      expect(files.map((f) => f.path)).toEqual(['/M/a.mp3', '/M/b.mp3', '/M/c.mp3'])
    })

    it('excludes files where all three flags are 1 (fully tagged)', () => {
      repo.createScan('s1', '/M', 1)
      repo.insertBatch(
        [row({ path: '/M/full.mp3', hasGenre: true, hasBpm: true, hasKey: true })],
        's1'
      )
      expect(repo.listIncompleteFiles('s1')).toEqual([])
    })

    it('returns empty for a scanId with no matches', () => {
      expect(repo.listIncompleteFiles('nope')).toEqual([])
    })
  })

  describe('SQL safety (V5 defence-in-depth)', () => {
    it('uses prepared statements exclusively (no interpolated SQL)', () => {
      // No template literal SQL with embedded ${} value substitutions.
      // We allow ${} inside template literals only if they are NOT SQL keywords; the simplest
      // strict check: no `${` anywhere inside backtick-delimited blocks that also contain SQL.
      const offending = SCAN_REPO_SOURCE.match(/`[^`]*\$\{[^`]*(SELECT|INSERT|UPDATE|DELETE|FROM)[^`]*`/i)
      expect(offending).toBeNull()
    })
  })
})
