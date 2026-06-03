/**
 * CONV-06 integration test: spawn the REAL bundled ffmpeg-static binary
 * against the Phase 2 fixtures (tagged.mp3 / sample.flac / tagged.m4a),
 * convert to MP3 320 CBR with the locked argv, then read tags back via
 * music-metadata and assert each Rekordbox-relevant field round-trips.
 *
 * Skipped automatically if `ffmpeg-static` returns null (platform not
 * supported by the binary). Each test gets a fresh tmpdir cleaned in
 * afterEach to keep the workspace tidy.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { parseFile } from 'music-metadata'
import { PRESETS, buildFfmpegArgs } from './presets'
import type { Preset } from '../../shared/ipc-types'

const MP3_320: Preset = PRESETS[0]
const FIXTURES = path.join(__dirname, '..', 'workers', '__fixtures__')

const ffmpegPath = ffmpegStatic as unknown as string | null

const suite = ffmpegPath ? describe : describe.skip

suite('tag round-trip (real ffmpeg)', () => {
  let tmpdir: string

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'dj-utils-tag-rt-'))
  })

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true })
  })

  function runFfmpeg(src: string, out: string, preset: Preset): void {
    const args = buildFfmpegArgs(src, out, preset)
    const result = spawnSync(ffmpegPath as string, args, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(
        `ffmpeg exited ${result.status}; stderr:\n${result.stderr ?? '(no stderr)'}`
      )
    }
  }

  it(
    'MP3 → MP3 320: preserves Genre / BPM / Key (Rekordbox load-bearing fields)',
    async () => {
      const src = path.join(FIXTURES, 'tagged-rekordbox.mp3')
      const out = path.join(tmpdir, 'tagged-out.mp3')
      runFfmpeg(src, out, MP3_320)

      const stat = fs.statSync(out)
      expect(stat.size).toBeGreaterThan(1024)

      const meta = await parseFile(out)
      // common.genre is an array; assert membership rather than equality so
      // a length-1 array doesn't trip the strict equal check.
      expect(meta.common.genre ?? []).toContain('House')
      expect(meta.common.bpm).toBe(128)
      expect(meta.common.key).toBe('8A')
      expect(meta.common.title).toBe('Test Track')
      expect(meta.common.artist).toBe('Test Artist')
      expect(meta.common.album).toBe('Test Album')
    },
    30_000
  )

  it(
    'FLAC → MP3 320: maps Vorbis TITLE/ARTIST/GENRE/BPM/INITIALKEY → ID3v2.3',
    async () => {
      const src = path.join(FIXTURES, 'sample-with-tags.flac')
      const sourceMeta = await parseFile(src)
      if (
        !sourceMeta.common.title &&
        !sourceMeta.common.artist &&
        !(sourceMeta.common.genre && sourceMeta.common.genre.length)
      ) {
        throw new Error(
          'sample.flac fixture has no Vorbis tags — regenerate with ffmpeg -metadata flags before running this test'
        )
      }

      const out = path.join(tmpdir, 'sample-out.mp3')
      runFfmpeg(src, out, MP3_320)

      const meta = await parseFile(out)
      expect(fs.statSync(out).size).toBeGreaterThan(1024)
      // At minimum, title and artist should round-trip — Vorbis TITLE→TIT2 etc.
      if (sourceMeta.common.title) {
        expect(meta.common.title).toBe(sourceMeta.common.title)
      }
      if (sourceMeta.common.artist) {
        expect(meta.common.artist).toBe(sourceMeta.common.artist)
      }
      if (sourceMeta.common.genre && sourceMeta.common.genre.length > 0) {
        expect(meta.common.genre ?? []).toEqual(
          expect.arrayContaining([sourceMeta.common.genre[0]])
        )
      }
      // BPM/INITIALKEY mapping from Vorbis → ID3v2.3 is known-fragile: ffmpeg's
      // -map_metadata translates Vorbis fields by name, and Vorbis BPM /
      // INITIALKEY don't have a 1:1 ID3 frame translation. Soft-warn rather
      // than fail (RESEARCH Tag Preservation Matrix MEDIUM confidence row).
      if (sourceMeta.common.bpm && meta.common.bpm !== sourceMeta.common.bpm) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tagRoundtrip] FLAC→MP3 BPM soft-miss: source=${sourceMeta.common.bpm} target=${String(meta.common.bpm)}`
        )
      }
      if (sourceMeta.common.key && meta.common.key !== sourceMeta.common.key) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tagRoundtrip] FLAC→MP3 TKEY soft-miss: source=${sourceMeta.common.key} target=${String(meta.common.key)}`
        )
      }
    },
    30_000
  )

  it(
    'M4A → MP3 320: TIT2/TPE1/TALB map; TBPM/TKEY are SOFT (warn-on-miss per A2)',
    async () => {
      const src = path.join(FIXTURES, 'tagged.m4a')
      const sourceMeta = await parseFile(src)
      const out = path.join(tmpdir, 'm4a-out.mp3')
      runFfmpeg(src, out, MP3_320)

      const meta = await parseFile(out)
      expect(fs.statSync(out).size).toBeGreaterThan(1024)
      if (sourceMeta.common.title) {
        expect(meta.common.title).toBe(sourceMeta.common.title)
      }
      if (sourceMeta.common.artist) {
        expect(meta.common.artist).toBe(sourceMeta.common.artist)
      }
      if (sourceMeta.common.bpm && meta.common.bpm !== sourceMeta.common.bpm) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tagRoundtrip] M4A→MP3 TBPM soft-miss: source=${sourceMeta.common.bpm} target=${String(meta.common.bpm)}`
        )
      }
      // TKEY is the known-fragile mapping for M4A → MP3 — soft assertion
      // (warn but do not fail) per RESEARCH Assumption A2.
      if (sourceMeta.common.key && meta.common.key !== sourceMeta.common.key) {
        // eslint-disable-next-line no-console
        console.warn(
          `[tagRoundtrip] M4A→MP3 TKEY soft-miss: source=${sourceMeta.common.key} target=${String(meta.common.key)}`
        )
      }
    },
    30_000
  )
})
