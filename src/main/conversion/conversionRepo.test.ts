import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  createConversionRepo,
  initConversionSchema,
  type ConversionRepo
} from './conversionRepo'
import { PRESETS } from './presets'
import type { Preset } from '../../shared/ipc-types'

const REPO_SOURCE = readFileSync(path.join(__dirname, 'conversionRepo.ts'), 'utf8')

const MP3_320: Preset = PRESETS[0]

describe('conversionRepo', () => {
  let db: Database.Database
  let repo: ConversionRepo

  beforeEach(() => {
    db = new Database(':memory:')
    initConversionSchema(db)
    repo = createConversionRepo(db)
  })

  describe('initConversionSchema', () => {
    it('creates the conversions + conversion_files tables and the index', () => {
      const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type='table'")
        .all() as { name: string }[]
      const names = tables.map((t) => t.name)
      expect(names).toContain('conversions')
      expect(names).toContain('conversion_files')

      const indexes = db
        .prepare("SELECT name FROM sqlite_master WHERE type='index'")
        .all() as { name: string }[]
      expect(indexes.map((i) => i.name)).toContain('idx_conversion_files_conv')
    })

    it('declares heartbeat_at NOT NULL', () => {
      const cols = db.prepare('PRAGMA table_info(conversions)').all() as Array<{
        name: string
        notnull: number
      }>
      const heartbeat = cols.find((c) => c.name === 'heartbeat_at')
      expect(heartbeat?.notnull).toBe(1)
    })

    it('is safe to call twice (IF NOT EXISTS)', () => {
      expect(() => initConversionSchema(db)).not.toThrow()
    })
  })

  describe('createConversion', () => {
    it('inserts a row with status=running and heartbeat_at=startedAt', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/Music',
        preset: MP3_320,
        outputDir: '/Music/converted/mp3-320',
        startedAt: 1_000
      })
      const r = repo.getConversion('c1')
      expect(r).not.toBeNull()
      expect(r!.status).toBe('running')
      expect(r!.heartbeatAt).toBe(1_000)
      expect(r!.preset.slug).toBe('mp3-320')
    })
  })

  describe('insertFileBatch', () => {
    beforeEach(() => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/Music',
        preset: MP3_320,
        outputDir: '/Music/converted/mp3-320',
        startedAt: 1_000
      })
    })

    it('inserts all rows in a single transaction', () => {
      repo.insertFileBatch(
        [
          { filePath: '/Music/a.mp3', status: 'pending' },
          { filePath: '/Music/b.mp3', status: 'pending' }
        ],
        'c1'
      )
      expect(repo.listFiles('c1')).toHaveLength(2)
    })

    it('is idempotent — second insert for same (conv,path) replaces (resume safety)', () => {
      repo.insertFileBatch([{ filePath: '/Music/a.mp3', status: 'pending' }], 'c1')
      repo.insertFileBatch([{ filePath: '/Music/a.mp3', status: 'pending' }], 'c1')
      expect(repo.listFiles('c1')).toHaveLength(1)
    })

    it('is a no-op on empty input', () => {
      repo.insertFileBatch([], 'c1')
      expect(repo.listFiles('c1')).toHaveLength(0)
    })
  })

  describe('updateFile', () => {
    beforeEach(() => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/Music',
        preset: MP3_320,
        outputDir: '/Music/converted/mp3-320',
        startedAt: 1
      })
      repo.insertFileBatch(
        [
          { filePath: '/Music/a.mp3', status: 'pending' },
          { filePath: '/Music/b.mp3', status: 'pending' }
        ],
        'c1'
      )
    })

    it('updates only status when only status is in the patch', () => {
      repo.updateFile('c1', '/Music/a.mp3', { status: 'running' })
      const [a] = repo.listFiles('c1').filter((f) => f.filePath === '/Music/a.mp3')
      expect(a.status).toBe('running')
      expect(a.errorMessage).toBeNull()
      expect(a.outputPath).toBeNull()
    })

    it('persists errorMessage on error transition', () => {
      repo.updateFile('c1', '/Music/a.mp3', {
        status: 'error',
        errorMessage: 'ffmpeg exited with code 1'
      })
      const [a] = repo.listFiles('c1').filter((f) => f.filePath === '/Music/a.mp3')
      expect(a.status).toBe('error')
      expect(a.errorMessage).toBe('ffmpeg exited with code 1')
    })

    it('persists outputPath on done transition', () => {
      repo.updateFile('c1', '/Music/a.mp3', {
        status: 'done',
        outputPath: '/Music/converted/mp3-320/a.mp3'
      })
      const [a] = repo.listFiles('c1').filter((f) => f.filePath === '/Music/a.mp3')
      expect(a.outputPath).toBe('/Music/converted/mp3-320/a.mp3')
    })

    it('CHECK constraint rejects invalid status values', () => {
      expect(() =>
        repo.updateFile('c1', '/Music/a.mp3', {
          status: 'banana' as never
        })
      ).toThrow()
    })
  })

  describe('bumpHeartbeat', () => {
    it('updates heartbeat_at only while running', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1_000
      })
      repo.bumpHeartbeat('c1', 5_000)
      expect(repo.getConversion('c1')!.heartbeatAt).toBe(5_000)
    })

    it('no-ops once the batch is in a terminal state', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1_000
      })
      repo.complete('c1', { status: 'done', endedAt: 2_000 })
      repo.bumpHeartbeat('c1', 9_000)
      expect(repo.getConversion('c1')!.heartbeatAt).toBe(1_000)
    })

    it('does not throw on unknown conversionId', () => {
      expect(() => repo.bumpHeartbeat('does-not-exist', 1)).not.toThrow()
    })
  })

  describe('complete', () => {
    it('updates status + ended_at on the conversions row', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1_000
      })
      repo.complete('c1', { status: 'done', endedAt: 3_000 })
      const r = repo.getConversion('c1')
      expect(r!.status).toBe('done')
      expect(r!.endedAt).toBe(3_000)
    })
  })

  describe('findResumable', () => {
    it('returns crashed batches with aggregated counts', () => {
      repo.createConversion({
        id: 'c-running',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 100
      })
      repo.createConversion({
        id: 'c-crashed',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 200
      })
      repo.complete('c-crashed', { status: 'crashed', endedAt: 250 })
      repo.insertFileBatch(
        [
          { filePath: '/M/a.mp3', status: 'pending' },
          { filePath: '/M/b.mp3', status: 'done' },
          { filePath: '/M/c.mp3', status: 'error' }
        ],
        'c-crashed'
      )

      const resumable = repo.findResumable()
      expect(resumable).toHaveLength(1)
      const r = resumable[0]
      expect(r.conversionId).toBe('c-crashed')
      expect(r.pendingCount).toBe(2) // pending + error
      expect(r.doneCount).toBe(1)
      expect(r.errorCount).toBe(1)
      expect(r.preset.slug).toBe('mp3-320')
    })

    it('sorts crashed batches by startedAt DESC', () => {
      repo.createConversion({
        id: 'old',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 100
      })
      repo.createConversion({
        id: 'new',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 500
      })
      repo.complete('old', { status: 'crashed', endedAt: 150 })
      repo.complete('new', { status: 'crashed', endedAt: 550 })
      const r = repo.findResumable()
      expect(r.map((b) => b.conversionId)).toEqual(['new', 'old'])
    })
  })

  describe('markStaleAsCrashed', () => {
    it("flips status to 'crashed' for running batches with stale heartbeat", () => {
      repo.createConversion({
        id: 'stale',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1_000
      })
      // heartbeat at 1_000; now=100_000; threshold=30_000 → stale
      const changed = repo.markStaleAsCrashed({ thresholdMs: 30_000, now: 100_000 })
      expect(changed).toBe(1)
      expect(repo.getConversion('stale')!.status).toBe('crashed')
    })

    it('does NOT touch fresh batches', () => {
      repo.createConversion({
        id: 'fresh',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 100_000
      })
      const changed = repo.markStaleAsCrashed({ thresholdMs: 30_000, now: 100_001 })
      expect(changed).toBe(0)
      expect(repo.getConversion('fresh')!.status).toBe('running')
    })

    it('only affects status=running rows (not done / cancelled / crashed)', () => {
      repo.createConversion({
        id: 'done',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1
      })
      repo.complete('done', { status: 'done', endedAt: 2 })
      const changed = repo.markStaleAsCrashed({ thresholdMs: 30_000, now: 100_000 })
      expect(changed).toBe(0)
    })
  })

  describe('getResumablePending', () => {
    beforeEach(() => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1
      })
      repo.insertFileBatch(
        [
          { filePath: '/M/pending.mp3', status: 'pending' },
          { filePath: '/M/running.mp3', status: 'running' },
          { filePath: '/M/error.mp3', status: 'error' },
          { filePath: '/M/done.mp3', status: 'done' },
          { filePath: '/M/skipped.mp3', status: 'skipped' },
          { filePath: '/M/cancelled.mp3', status: 'cancelled' }
        ],
        'c1'
      )
    })

    it("returns paths with status IN ('pending','running','error')", () => {
      const pending = repo.getResumablePending('c1')
      expect(pending.sort()).toEqual(
        ['/M/error.mp3', '/M/pending.mp3', '/M/running.mp3'].sort()
      )
    })

    it("excludes 'cancelled' files (LOCKED: cancelled batches NOT resumable)", () => {
      const pending = repo.getResumablePending('c1')
      expect(pending).not.toContain('/M/cancelled.mp3')
    })

    it("excludes 'done' and 'skipped' files", () => {
      const pending = repo.getResumablePending('c1')
      expect(pending).not.toContain('/M/done.mp3')
      expect(pending).not.toContain('/M/skipped.mp3')
    })
  })

  describe('listFiles', () => {
    it('returns rows in stable insert order', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1
      })
      repo.insertFileBatch(
        [
          { filePath: '/M/b.mp3', status: 'pending' },
          { filePath: '/M/a.mp3', status: 'pending' },
          { filePath: '/M/c.mp3', status: 'pending' }
        ],
        'c1'
      )
      const first = repo.listFiles('c1').map((f) => f.filePath)
      const second = repo.listFiles('c1').map((f) => f.filePath)
      expect(first).toEqual(second)
    })
  })

  describe('FK CASCADE', () => {
    it('deleting a conversions row cascades to conversion_files', () => {
      repo.createConversion({
        id: 'c1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        startedAt: 1
      })
      repo.insertFileBatch([{ filePath: '/M/a.mp3', status: 'pending' }], 'c1')
      repo.deleteConversion('c1')
      expect(repo.listFiles('c1')).toHaveLength(0)
      expect(repo.getConversion('c1')).toBeNull()
    })
  })

  describe('SQL safety (V5 defence-in-depth)', () => {
    it('uses prepared statements exclusively (no interpolated SQL)', () => {
      const offending = REPO_SOURCE.match(
        /`[^`]*\$\{[^`]*(SELECT|INSERT|UPDATE|DELETE|FROM)[^`]*`/i
      )
      expect(offending).toBeNull()
    })

    it('wraps batched inserts in db.transaction', () => {
      expect(REPO_SOURCE).toMatch(/db\.transaction/)
    })
  })
})
