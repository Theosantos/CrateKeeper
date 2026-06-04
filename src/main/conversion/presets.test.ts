import { describe, it, expect } from 'vitest'
import { PRESETS, buildFfmpegArgs, getPresetBySlug, presetSlugOf } from './presets'
import type { Preset } from '../../shared/ipc-types'

describe('PRESETS registry', () => {
  it('exports exactly 5 entries in the locked order', () => {
    expect(PRESETS).toHaveLength(5)
    expect(PRESETS.map((p) => p.slug)).toEqual([
      'mp3-320',
      'mp3-v0',
      'aac-256',
      'flac',
      'wav'
    ])
  })

  it('mp3-320 has codec=libmp3lame, bitrate=320, extension=.mp3', () => {
    const p = PRESETS[0]
    expect(p.codec).toBe('libmp3lame')
    expect(p.bitrateKbps).toBe(320)
    expect(p.vbrQuality).toBeNull()
    expect(p.extension).toBe('.mp3')
  })

  it('aac-256 uses native aac encoder (NOT libfdk_aac per Pitfall 2)', () => {
    const aac = PRESETS.find((p) => p.slug === 'aac-256')!
    expect(aac.codec).toBe('aac')
    expect(aac.codec).not.toBe('libfdk_aac')
  })

  it('aac-256 emits .aac container (NOT .m4a per Pitfall 7)', () => {
    const aac = PRESETS.find((p) => p.slug === 'aac-256')!
    expect(aac.extension).toBe('.aac')
    expect(aac.extension).not.toBe('.m4a')
  })
})

describe('buildFfmpegArgs', () => {
  const mp3_320 = PRESETS[0]
  const mp3_v0 = PRESETS[1]
  const flac = PRESETS.find((p) => p.slug === 'flac')!
  const wav = PRESETS.find((p) => p.slug === 'wav')!

  it('starts with the canonical preamble and -i src', () => {
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', mp3_320)
    // `-loglevel info` is required so the worker sees the `Duration:` header
    // from ffmpeg's input-open output; with `-loglevel error` the duration
    // line is suppressed and progress events never fire (see presets.ts).
    expect(args.slice(0, 7)).toEqual([
      '-hide_banner',
      '-loglevel',
      'info',
      '-stats',
      '-y',
      '-i',
      '/in.mp3'
    ])
  })

  it('ends with the output path (LAST positional)', () => {
    const args = buildFfmpegArgs('/in.mp3', '/converted/out.mp3', mp3_320)
    expect(args[args.length - 1]).toBe('/converted/out.mp3')
  })

  it('mp3-320 emits -c:a libmp3lame -b:a 320k', () => {
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', mp3_320)
    const codecIdx = args.indexOf('-c:a')
    expect(args[codecIdx + 1]).toBe('libmp3lame')
    const brIdx = args.indexOf('-b:a')
    expect(args[brIdx + 1]).toBe('320k')
  })

  it('mp3-320 contains -map_metadata 0 followed by -id3v2_version 3 in that order (Rekordbox lock)', () => {
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', mp3_320)
    const mapIdx = args.indexOf('-map_metadata')
    const id3Idx = args.indexOf('-id3v2_version')
    expect(mapIdx).toBeGreaterThan(-1)
    expect(id3Idx).toBeGreaterThan(-1)
    expect(args[mapIdx + 1]).toBe('0')
    expect(args[id3Idx + 1]).toBe('3')
    expect(mapIdx).toBeLessThan(id3Idx)
  })

  it('mp3-v0 emits -q:a 0 (VBR), no -b:a (CBR)', () => {
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', mp3_v0)
    expect(args).toContain('-q:a')
    const qIdx = args.indexOf('-q:a')
    expect(args[qIdx + 1]).toBe('0')
    expect(args).not.toContain('-b:a')
  })

  it('flac emits -map_metadata 0 but NOT -id3v2_version', () => {
    const args = buildFfmpegArgs('/in.flac', '/out.flac', flac)
    expect(args).toContain('-map_metadata')
    expect(args).not.toContain('-id3v2_version')
  })

  it('wav emits -map_metadata 0 but NOT -id3v2_version', () => {
    const args = buildFfmpegArgs('/in.wav', '/out.wav', wav)
    expect(args).toContain('-map_metadata')
    expect(args).not.toContain('-id3v2_version')
  })

  it('omits -ar when sampleRate is null (preserve source)', () => {
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', mp3_320)
    expect(args).not.toContain('-ar')
  })

  it('emits -ar <rate> when sampleRate is set', () => {
    const custom: Preset = { ...mp3_320, sampleRate: 44100 }
    const args = buildFfmpegArgs('/in.mp3', '/out.mp3', custom)
    expect(args).toContain('-ar')
    expect(args[args.indexOf('-ar') + 1]).toBe('44100')
  })
})

describe('getPresetBySlug', () => {
  it('returns the matching preset for a known slug', () => {
    expect(getPresetBySlug('mp3-320')?.slug).toBe('mp3-320')
    expect(getPresetBySlug('flac')?.codec).toBe('flac')
  })

  it('returns undefined for an unknown slug', () => {
    expect(getPresetBySlug('bogus')).toBeUndefined()
  })
})

describe('presetSlugOf', () => {
  it("returns the slug of a hardcoded preset", () => {
    expect(presetSlugOf(PRESETS[0])).toBe('mp3-320')
  })

  it("returns 'custom' for a Custom-form preset (escape hatch)", () => {
    const custom: Preset = {
      slug: 'custom',
      label: 'Custom',
      codec: 'aac',
      bitrateKbps: 192,
      vbrQuality: null,
      sampleRate: null,
      extension: '.aac'
    }
    expect(presetSlugOf(custom)).toBe('custom')
  })
})
