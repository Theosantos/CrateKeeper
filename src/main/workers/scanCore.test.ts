import { describe, it, expect, beforeAll } from 'vitest'
import { stat } from 'node:fs/promises'
import path from 'node:path'
import { parseFile, type IAudioMetadata } from 'music-metadata'
import {
  AUDIO_EXTS,
  inferFormat,
  hasGenreTag,
  hasBpmTag,
  hasKeyTag,
  rowFromMetadata,
  errorRow
} from './scanCore'

const FIXTURES = path.join(__dirname, '__fixtures__')
const TAGGED = path.join(FIXTURES, 'tagged.mp3')
const UNTAGGED = path.join(FIXTURES, 'untagged.mp3')
const FLAC = path.join(FIXTURES, 'sample.flac')

interface Parsed {
  meta: IAudioMetadata
  size: number
}

const cache: Record<string, Parsed> = {}

async function load(file: string): Promise<Parsed> {
  if (!cache[file]) {
    const meta = await parseFile(file, { duration: true, skipCovers: true })
    const s = await stat(file)
    cache[file] = { meta, size: s.size }
  }
  return cache[file]
}

describe('scanCore', () => {
  beforeAll(async () => {
    await load(TAGGED)
    await load(UNTAGGED)
    await load(FLAC)
  })

  describe('AUDIO_EXTS', () => {
    it('contains exactly the v1 allowlist', () => {
      expect([...AUDIO_EXTS]).toEqual([
        '.mp3',
        '.flac',
        '.m4a',
        '.aac',
        '.wav',
        '.aiff',
        '.aif',
        '.ogg',
        '.opus'
      ])
    })
  })

  describe('inferFormat', () => {
    it('prefers meta.format.container uppercased', () => {
      const fake = { format: { container: 'mp3' } } as unknown as IAudioMetadata
      expect(inferFormat('/x/foo.mp3', fake)).toBe('MP3')
    })

    it('falls back to the path extension when meta is undefined', () => {
      expect(inferFormat('/x/foo.flac')).toBe('FLAC')
    })

    it('returns UNKNOWN when path has no extension and no meta', () => {
      expect(inferFormat('/x/noext')).toBe('UNKNOWN')
    })
  })

  describe('has*Tag helpers', () => {
    it('hasGenreTag is false for empty array, whitespace-only, and missing', () => {
      expect(hasGenreTag({ common: { genre: [] } } as unknown as IAudioMetadata)).toBe(false)
      expect(hasGenreTag({ common: { genre: [''] } } as unknown as IAudioMetadata)).toBe(false)
      expect(hasGenreTag({ common: { genre: ['   '] } } as unknown as IAudioMetadata)).toBe(false)
      expect(hasGenreTag({ common: {} } as unknown as IAudioMetadata)).toBe(false)
    })

    it('hasGenreTag is true for a non-empty genre string', () => {
      expect(hasGenreTag({ common: { genre: ['House'] } } as unknown as IAudioMetadata)).toBe(true)
    })

    it('hasBpmTag is true only for a positive numeric bpm', () => {
      expect(hasBpmTag({ common: { bpm: 128 } } as unknown as IAudioMetadata)).toBe(true)
      expect(hasBpmTag({ common: { bpm: 0 } } as unknown as IAudioMetadata)).toBe(false)
      expect(hasBpmTag({ common: {} } as unknown as IAudioMetadata)).toBe(false)
    })

    it('hasKeyTag is true only for a non-empty key string', () => {
      expect(hasKeyTag({ common: { key: '8A' } } as unknown as IAudioMetadata)).toBe(true)
      expect(hasKeyTag({ common: { key: '   ' } } as unknown as IAudioMetadata)).toBe(false)
      expect(hasKeyTag({ common: {} } as unknown as IAudioMetadata)).toBe(false)
    })
  })

  describe('rowFromMetadata — tagged.mp3', () => {
    it('returns all 11 fields populated with G/B/K=true', async () => {
      const { meta, size } = await load(TAGGED)
      const row = rowFromMetadata(TAGGED, size, meta)
      expect(row.path).toBe(TAGGED)
      expect(row.format).toBe('MPEG') // music-metadata container value for MP3
      expect(row.bitrate).toBeGreaterThan(0)
      expect(row.sizeBytes).toBe(size)
      expect(row.sampleRate).toBe(22050)
      expect(row.durationSeconds).toBeGreaterThan(0)
      expect(row.hasGenre).toBe(true)
      expect(row.hasBpm).toBe(true)
      expect(row.hasKey).toBe(true)
      expect(row.parsedOk).toBe(true)
      expect(row.errorMessage).toBeNull()
    })
  })

  describe('rowFromMetadata — untagged.mp3', () => {
    it('returns G/B/K=false but parsedOk=true (SCAN-03 badge logic)', async () => {
      const { meta, size } = await load(UNTAGGED)
      const row = rowFromMetadata(UNTAGGED, size, meta)
      expect(row.hasGenre).toBe(false)
      expect(row.hasBpm).toBe(false)
      expect(row.hasKey).toBe(false)
      expect(row.parsedOk).toBe(true)
      expect(row.errorMessage).toBeNull()
    })
  })

  describe('rowFromMetadata — sample.flac (multi-format coverage, Assumption A2)', () => {
    it('returns FLAC container and a positive duration', async () => {
      const { meta, size } = await load(FLAC)
      const row = rowFromMetadata(FLAC, size, meta)
      expect(row.format.toUpperCase()).toContain('FLAC')
      expect(row.durationSeconds).toBeGreaterThan(0)
      expect(row.parsedOk).toBe(true)
    })
  })

  describe('errorRow', () => {
    it('marks parsedOk=false and stores the error message, with nullish numerics', () => {
      const row = errorRow('/Music/broken.mp3', 1234, 'boom')
      expect(row.parsedOk).toBe(false)
      expect(row.errorMessage).toBe('boom')
      expect(row.bitrate).toBeNull()
      expect(row.sampleRate).toBeNull()
      expect(row.durationSeconds).toBeNull()
      expect(row.sizeBytes).toBe(1234)
      expect(row.format).toBe('MP3')
      expect(row.hasGenre).toBe(false)
      expect(row.hasBpm).toBe(false)
      expect(row.hasKey).toBe(false)
    })
  })
})
