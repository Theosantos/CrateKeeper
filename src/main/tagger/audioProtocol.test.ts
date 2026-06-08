import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SettingsRepo } from '../db/settingsRepo'

// Mock electron BEFORE importing the module under test.
vi.mock('electron', () => ({
  protocol: { handle: vi.fn() }
}))

// Mock fs so we can fabricate file size + body without touching disk.
vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return {
    ...actual,
    promises: {
      ...actual.promises,
      stat: vi.fn(async (_p: string) => ({ size: 1000 }))
    },
    createReadStream: vi.fn((_p: string, opts?: { start?: number; end?: number }) => {
      const start = opts?.start ?? 0
      const end = opts?.end ?? 999
      const buf = Buffer.alloc(end - start + 1, 0x41)
      // Minimal Readable stub: emit one chunk then end.
      const handlers: Record<string, ((arg?: unknown) => void)[]> = {}
      const stream = {
        on(event: string, cb: (arg?: unknown) => void) {
          ;(handlers[event] ??= []).push(cb)
          if (event === 'data') {
            queueMicrotask(() => cb(buf))
          }
          if (event === 'end') {
            queueMicrotask(() => cb())
          }
          return stream
        },
        destroy() {}
      }
      return stream as unknown as ReturnType<typeof actual.createReadStream>
    })
  }
})

import { protocol } from 'electron'
import {
  AUDIO_PROTOCOL_SCHEME,
  registerAudioProtocol,
  parseRange
} from './audioProtocol'

type Handler = (request: Request) => Promise<Response>

function makeSettings(root: string | null): SettingsRepo {
  return {
    get: vi.fn((_k: string) => root),
    set: vi.fn()
  } as unknown as SettingsRepo
}

function captureHandler(): Handler {
  const calls = (protocol.handle as unknown as { mock: { calls: unknown[][] } })
    .mock.calls
  const last = calls[calls.length - 1]
  return last[1] as Handler
}

function makeReq(url: string, init?: RequestInit): Request {
  return new Request(url, init)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('parseRange', () => {
  it('returns null when header is null', () => {
    expect(parseRange(null, 1000)).toBeNull()
  })

  it('parses bytes=0-499', () => {
    expect(parseRange('bytes=0-499', 1000)).toEqual({ start: 0, end: 499 })
  })

  it('parses bytes=500- (open end clamps to size-1)', () => {
    expect(parseRange('bytes=500-', 1000)).toEqual({ start: 500, end: 999 })
  })

  it('parses suffix bytes=-200 (last 200 bytes)', () => {
    expect(parseRange('bytes=-200', 1000)).toEqual({ start: 800, end: 999 })
  })

  it('returns null on malformed header', () => {
    expect(parseRange('bytes=abc-xyz', 1000)).toBeNull()
    expect(parseRange('items=0-100', 1000)).toBeNull()
    expect(parseRange('bytes=-', 1000)).toBeNull()
  })

  it('returns null when start >= size (unsatisfiable)', () => {
    expect(parseRange('bytes=2000-', 1000)).toBeNull()
  })

  it('clamps end to size-1', () => {
    expect(parseRange('bytes=0-9999', 1000)).toEqual({ start: 0, end: 999 })
  })
})

describe('audioProtocol', () => {
  it('exports the literal "cratekeeper" scheme constant', () => {
    expect(AUDIO_PROTOCOL_SCHEME).toBe('cratekeeper')
  })

  it('registers protocol.handle once for the cratekeeper scheme', () => {
    registerAudioProtocol(makeSettings('/Music'))
    expect(protocol.handle).toHaveBeenCalledTimes(1)
    expect(
      (protocol.handle as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0]
    ).toBe('cratekeeper')
  })

  it('returns 404 when hostname is not "audio"', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(makeReq('cratekeeper://wrong-host/foo.mp3'))
    expect(res.status).toBe(404)
  })

  it('returns 403 when settings.rootFolder is null', async () => {
    registerAudioProtocol(makeSettings(null))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/a.mp3'))
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 for a path that is NOT under rootFolder (T-4-01)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/etc/passwd'))
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 for path equal to rootFolder (directory, not file)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music'))
    )
    expect(res.status).toBe(403)
  })

  it('returns 403 for ../ segments that escape rootFolder', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/../etc/passwd'))
    )
    expect(res.status).toBe(403)
  })

  it('returns 415 for an extension not in AUDIO_EXTS (T-4-02)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/note.txt'))
    )
    expect(res.status).toBe(415)
  })

  it('accepts uppercase audio extension (case-insensitive)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/Track.MP3'))
    )
    expect(res.status).not.toBe(415)
    expect(res.status).toBe(200)
  })

  it('returns 200 with explicit Content-Length when no Range header is present', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/song.mp3'))
    )
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Length')).toBe('1000')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('returns 206 Partial Content with Content-Range when Range is present', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq(
        'cratekeeper://audio/' + encodeURIComponent('/Music/song.mp3'),
        { headers: { Range: 'bytes=100-499' } }
      )
    )
    expect(res.status).toBe(206)
    expect(res.headers.get('Content-Range')).toBe('bytes 100-499/1000')
    expect(res.headers.get('Content-Length')).toBe('400')
    expect(res.headers.get('Accept-Ranges')).toBe('bytes')
  })

  it('sets Content-Type by extension so <audio> can decode the stream', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const cases: Array<[string, string]> = [
      ['/Music/a.mp3', 'audio/mpeg'],
      ['/Music/a.m4a', 'audio/mp4'],
      ['/Music/a.flac', 'audio/flac'],
      ['/Music/a.wav', 'audio/wav'],
      ['/Music/a.ogg', 'audio/ogg'],
      ['/Music/a.opus', 'audio/ogg'],
      ['/Music/a.aac', 'audio/aac']
    ]
    for (const [p, expected] of cases) {
      const res = await handler(makeReq('cratekeeper://audio/' + encodeURIComponent(p)))
      expect(res.headers.get('Content-Type')).toBe(expected)
    }
  })

  it('decodes URL pathname (handles spaces)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/My Song.mp3'))
    )
    expect(res.status).toBe(200)
  })
})
