import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { resolveFfmpegPath } from './ffmpegPath'

describe('resolveFfmpegPath', () => {
  it('returns the raw path unchanged when isPackaged=false (dev mode)', () => {
    const raw = '/Users/x/cratekeeper/node_modules/ffmpeg-static/ffmpeg'
    expect(resolveFfmpegPath({ rawPath: raw, isPackaged: false })).toBe(raw)
  })

  it('rewrites app.asar → app.asar.unpacked on POSIX layout in production', () => {
    // Only run on POSIX (path.sep === '/'). The Windows variant is exercised
    // by the explicit win32 test below.
    if (path.sep !== '/') return
    const raw = '/Users/x/app/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
    const expected =
      '/Users/x/app/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg'
    expect(resolveFfmpegPath({ rawPath: raw, isPackaged: true })).toBe(expected)
  })

  it('does NOT rewrite app.asar when isPackaged=false even if path contains it', () => {
    const raw = '/Users/x/app/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg'
    expect(resolveFfmpegPath({ rawPath: raw, isPackaged: false })).toBe(raw)
  })

  it('passthrough when raw path does not contain app.asar segment', () => {
    const raw = '/usr/local/bin/ffmpeg'
    expect(resolveFfmpegPath({ rawPath: raw, isPackaged: true })).toBe(raw)
  })

  it('rewrites multiple occurrences (defensive — should not happen in practice)', () => {
    if (path.sep !== '/') return
    const raw = '/a/app.asar/b/app.asar/c'
    expect(resolveFfmpegPath({ rawPath: raw, isPackaged: true })).toBe(
      '/a/app.asar.unpacked/b/app.asar.unpacked/c'
    )
  })
})
