/**
 * tagWriter round-trip tests (Phase 5, Plan 01 — Task 2)
 *
 * Verifies TAGS-01 (write ID3v2.3 for MP3, tmpo atom for MP4),
 * TAGS-02 (atomic temp+rename; original intact on failure),
 * TAGS-03 (Rekordbox compat: ID3v2.3, integer BPM, Camelot TKEY),
 * TAGG-07 (POPM byte mapping: 4 stars → 204),
 * D-04 (non-destructive: null fields never overwrite existing frames),
 * D-06 (dispatch: unsupported formats return 'unsupported').
 *
 * Mirrors tagRoundtrip.test.ts structure exactly.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { parseFile } from 'music-metadata'
import {
  writeMp3Tags,
  writeMp4Tags,
  getWriteStrategy,
  starToPopmByte,
  type Mp3TagInput
} from './tagWriter'

const FIXTURES = path.join(__dirname, '..', 'workers', '__fixtures__')
const ffmpegPath = ffmpegStatic as unknown as string | null
const suite = ffmpegPath ? describe : describe.skip

// ─── Unit tests (no filesystem — always run) ─────────────────────────────────

describe('starToPopmByte', () => {
  it('maps 1 star → 51', () => {
    expect(starToPopmByte(1)).toBe(51)
  })

  it('maps 2 stars → 102', () => {
    expect(starToPopmByte(2)).toBe(102)
  })

  it('maps 3 stars → 153', () => {
    expect(starToPopmByte(3)).toBe(153)
  })

  it('maps 4 stars → 204', () => {
    expect(starToPopmByte(4)).toBe(204)
  })

  it('maps 5 stars → 255', () => {
    expect(starToPopmByte(5)).toBe(255)
  })

  it('maps 0 → 0 (unset/no POPM)', () => {
    expect(starToPopmByte(0)).toBe(0)
  })

  it('maps unknown value → 0 (fallback)', () => {
    expect(starToPopmByte(99)).toBe(0)
  })
})

describe('getWriteStrategy', () => {
  it('returns mp3 for .mp3', () => {
    expect(getWriteStrategy('/Music/track.mp3')).toBe('mp3')
  })

  it('returns mp4 for .m4a', () => {
    expect(getWriteStrategy('/Music/track.m4a')).toBe('mp4')
  })

  it('returns mp4 for .aac', () => {
    expect(getWriteStrategy('/Music/track.aac')).toBe('mp4')
  })

  it('returns mp4 for .mp4', () => {
    expect(getWriteStrategy('/Music/track.mp4')).toBe('mp4')
  })

  it('returns unsupported for .flac', () => {
    expect(getWriteStrategy('/Music/track.flac')).toBe('unsupported')
  })

  it('returns unsupported for .wav', () => {
    expect(getWriteStrategy('/Music/track.wav')).toBe('unsupported')
  })

  it('returns unsupported for .aiff', () => {
    expect(getWriteStrategy('/Music/track.aiff')).toBe('unsupported')
  })

  it('handles uppercase extensions', () => {
    expect(getWriteStrategy('/Music/track.MP3')).toBe('mp3')
    expect(getWriteStrategy('/Music/track.M4A')).toBe('mp4')
  })
})

// ─── Integration tests (real ffmpeg + real fixtures) ─────────────────────────

suite('tagWriter round-trip (real files)', () => {
  let tmpdir: string

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-tagwrite-'))
  })

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true })
  })

  // ── MP3 round-trip / TAGS-03 ────────────────────────────────────────────────

  it(
    'MP3: writes ID3v2.3 (not v2.4) — Rekordbox compat (TAGS-03)',
    async () => {
      const src = path.join(FIXTURES, 'tagged.mp3')
      const out = path.join(tmpdir, 'out.mp3')
      fs.copyFileSync(src, out)

      const input: Mp3TagInput = {
        artist: 'Test Artist',
        title: 'Test Title',
        genre: 'House',
        bpm: 128,
        key: '8A',
        comment: 'test comment',
        rating: null
      }
      await writeMp3Tags(out, input)

      const meta = await parseFile(out)
      expect(meta.format.tagTypes).toContain('ID3v2.3')
      expect(meta.common.artist).toBe('Test Artist')
      expect(meta.common.title).toBe('Test Title')
      expect(meta.common.genre ?? []).toContain('House')
      expect(meta.common.bpm).toBe(128)
      expect(meta.common.key).toBe('8A')
    },
    30_000
  )

  // ── POPM / TAGG-07 ─────────────────────────────────────────────────────────

  it(
    'MP3: POPM byte is 204 for 4 stars (TAGG-07)',
    async () => {
      const src = path.join(FIXTURES, 'tagged.mp3')
      const out = path.join(tmpdir, 'out-popm.mp3')
      fs.copyFileSync(src, out)

      await writeMp3Tags(out, { rating: 4 })

      const meta = await parseFile(out)
      const id3Native = meta.native['ID3v2.3'] ?? []
      const popm = id3Native.find((f) => f.id === 'POPM')
      expect(popm).toBeDefined()
      expect(popm?.value?.rating).toBe(204)
    },
    30_000
  )

  // ── POPM omitted for null rating ────────────────────────────────────────────

  it(
    'MP3: POPM frame absent for rating=null',
    async () => {
      const src = path.join(FIXTURES, 'untagged.mp3')
      const out = path.join(tmpdir, 'out-no-popm.mp3')
      fs.copyFileSync(src, out)

      await writeMp3Tags(out, { genre: 'House', rating: null })

      const meta = await parseFile(out)
      const id3Native = meta.native['ID3v2.3'] ?? []
      const popm = id3Native.find((f) => f.id === 'POPM')
      expect(popm).toBeUndefined()
    },
    30_000
  )

  // ── Non-destructive / D-04 ──────────────────────────────────────────────────

  it(
    'MP3: null fields do NOT overwrite existing frames (D-04)',
    async () => {
      const src = path.join(FIXTURES, 'test-tagged.mp3')
      const out = path.join(tmpdir, 'out-nd.mp3')
      fs.copyFileSync(src, out)

      // Write only genre — album must survive
      await writeMp3Tags(out, { genre: 'House' })

      const meta = await parseFile(out)
      expect(meta.common.genre ?? []).toContain('House')
      expect(meta.common.album).toBe('Original Album')
    },
    30_000
  )

  // ── Crash-safety / TAGS-02 ─────────────────────────────────────────────────

  it(
    'MP3: original file is byte-identical if write throws (TAGS-02)',
    async () => {
      const src = path.join(FIXTURES, 'tagged.mp3')
      const out = path.join(tmpdir, 'out-crash.mp3')
      fs.copyFileSync(src, out)

      const originalContent = fs.readFileSync(out)
      const originalSize = fs.statSync(out).size

      // Mock NodeID3.update to throw
      const NodeID3 = await import('node-id3')
      const spy = vi.spyOn(NodeID3.default, 'update').mockImplementation(() => {
        throw new Error('simulated crash')
      })

      await expect(writeMp3Tags(out, { genre: 'House' })).rejects.toThrow('simulated crash')

      spy.mockRestore()

      // Original must be untouched
      const afterContent = fs.readFileSync(out)
      expect(afterContent.equals(originalContent)).toBe(true)
      expect(fs.statSync(out).size).toBe(originalSize)

      // No temp file must remain
      const tmpFile = out + '.ck-tmp'
      expect(fs.existsSync(tmpFile)).toBe(false)
    },
    30_000
  )

  // ── MP4 round-trip / TAGS-01 + TAGS-03 ─────────────────────────────────────

  it(
    'MP4: BPM via tmpo atom reads back as integer (TAGS-01 + TAGS-03)',
    async () => {
      const src = path.join(FIXTURES, 'tagged.m4a')
      const out = path.join(tmpdir, 'out.m4a')
      fs.copyFileSync(src, out)

      await writeMp4Tags(out, { bpm: 128 }, ffmpegPath as string)

      const meta = await parseFile(out)
      expect(meta.common.bpm).toBe(128)
    },
    30_000
  )
})
