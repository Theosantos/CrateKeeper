import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SettingsRepo } from '../db/settingsRepo'

// Mock electron BEFORE importing the module under test.
vi.mock('electron', () => ({
  protocol: { handle: vi.fn() },
  net: {
    fetch: vi.fn(async (_url: string) => new Response('ok', { status: 200 }))
  }
}))

// Import after the mock is in place.
import { protocol, net } from 'electron'
import {
  AUDIO_PROTOCOL_SCHEME,
  registerAudioProtocol
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

function makeReq(url: string): Request {
  return new Request(url)
}

beforeEach(() => {
  vi.clearAllMocks()
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
    expect(net.fetch).not.toHaveBeenCalled()
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
    expect(net.fetch).not.toHaveBeenCalled()
  })

  it('accepts uppercase audio extension (case-insensitive)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/Track.MP3'))
    )
    expect(res.status).not.toBe(415)
    expect(net.fetch).toHaveBeenCalled()
  })

  it('streams via net.fetch with file:// URL when path + ext valid', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    const res = await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/song.mp3'))
    )
    expect(res.status).toBe(200)
    expect(net.fetch).toHaveBeenCalledWith('file:///Music/song.mp3')
  })

  it('decodes URL pathname (handles spaces)', async () => {
    registerAudioProtocol(makeSettings('/Music'))
    const handler = captureHandler()
    await handler(
      makeReq('cratekeeper://audio/' + encodeURIComponent('/Music/My Song.mp3'))
    )
    expect(net.fetch).toHaveBeenCalledWith('file:///Music/My Song.mp3')
  })
})
