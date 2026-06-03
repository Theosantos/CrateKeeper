import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import {
  parseFfmpegTimeProgress,
  parseFfmpegDuration,
  computeOutputPath
} from './conversionCore'
import { PRESETS } from '../conversion/presets'
import type { Preset } from '../../shared/ipc-types'

const CORE_SOURCE = readFileSync(path.join(__dirname, 'conversionCore.ts'), 'utf8')
const MP3_320: Preset = PRESETS[0]

describe('parseFfmpegTimeProgress', () => {
  it('parses a single time= occurrence', () => {
    const chunk = 'frame=1024 fps=42 time=00:00:03.50 bitrate=...'
    expect(parseFfmpegTimeProgress(chunk)).toBe(3.5)
  })

  it('returns the LAST match when multiple time= tokens appear in one chunk', () => {
    const chunk = 'time=00:00:01.00 ... \r time=00:00:02.50 ... \r time=00:00:05.25'
    const result = parseFfmpegTimeProgress(chunk)
    expect(result).toBe(5.25)
    // Sanity: rightmost > leftmost (parser does not return first match).
    expect(result).toBeGreaterThan(1.0)
  })

  it('handles hours: time=01:02:03.40 → 3723.4 s', () => {
    const chunk = 'time=01:02:03.40'
    expect(parseFfmpegTimeProgress(chunk)).toBeCloseTo(3723.4, 3)
  })

  it('returns null when no time= token is present', () => {
    expect(parseFfmpegTimeProgress('frame=1024 fps=42 size=1024kB')).toBeNull()
    expect(parseFfmpegTimeProgress('')).toBeNull()
  })

  it('is stateless — successive calls on the same input return the same value (regression for /g lastIndex)', () => {
    const chunk = 'time=00:00:07.00'
    const a = parseFfmpegTimeProgress(chunk)
    const b = parseFfmpegTimeProgress(chunk)
    const c = parseFfmpegTimeProgress(chunk)
    expect(a).toBe(7)
    expect(b).toBe(7)
    expect(c).toBe(7)
  })
})

describe('parseFfmpegDuration', () => {
  it('parses the canonical Duration line', () => {
    const chunk = '  Duration: 00:03:24.12, start: 0.000000, bitrate: 320 kb/s'
    expect(parseFfmpegDuration(chunk)).toBeCloseTo(204.12, 3)
  })

  it('returns null when no Duration line is present', () => {
    expect(parseFfmpegDuration('frame=42 time=00:00:01.00')).toBeNull()
  })
})

describe('computeOutputPath', () => {
  it('joins outputDir + basename + preset.extension', () => {
    expect(
      computeOutputPath('/Music/song.mp3', '/Music/converted/mp3-320', MP3_320)
    ).toBe('/Music/converted/mp3-320/song.mp3')
  })

  it('strips the source extension before appending the preset extension', () => {
    expect(
      computeOutputPath('/Music/song.flac', '/Music/converted/mp3-320', MP3_320)
    ).toBe('/Music/converted/mp3-320/song.mp3')
  })

  it('flattens subfolder structure (no subfolder mirror in v1)', () => {
    expect(
      computeOutputPath('/Music/Sub/song.mp3', '/Music/converted/mp3-320', MP3_320)
    ).toBe('/Music/converted/mp3-320/song.mp3')
  })

  it('result never escapes outputDir for inputs containing parent-dir segments', () => {
    const out = computeOutputPath(
      '/Music/../../etc/passwd',
      '/Music/converted/mp3-320',
      MP3_320
    )
    const outResolved = path.resolve(out)
    const dirResolved = path.resolve('/Music/converted/mp3-320')
    expect(
      outResolved === dirResolved || outResolved.startsWith(dirResolved + path.sep)
    ).toBe(true)
  })
})

describe('conversionCore module boundary', () => {
  it('does not import node:worker_threads', () => {
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]node:worker_threads['"]/)
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]worker_threads['"]/)
  })

  it('does not import node:child_process', () => {
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]node:child_process['"]/)
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]child_process['"]/)
  })

  it('does not import node:fs', () => {
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]node:fs['"]/)
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]node:fs\/promises['"]/)
  })

  it('does not import electron', () => {
    expect(CORE_SOURCE).not.toMatch(/from\s+['"]electron['"]/)
  })
})
