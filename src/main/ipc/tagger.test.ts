import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IpcMain } from 'electron'
import { registerTaggerHandlers } from './tagger'
import {
  IpcChannels,
  type PendingTagEdit,
  type ScannedFile
} from '../../shared/ipc-types'
import type { TaggerRepo } from '../tagger/taggerRepo'
import type { ScanRepo } from '../scan/scanRepo'
import type { SettingsRepo } from '../db/settingsRepo'

type Handler = (e: unknown, ...args: unknown[]) => Promise<unknown>

function makeIpc(): {
  ipcMain: IpcMain
  handlers: Map<string, Handler>
} {
  const handlers = new Map<string, Handler>()
  const ipcMain = {
    handle: vi.fn((channel: string, h: Handler) => {
      handlers.set(channel, h)
    })
  } as unknown as IpcMain
  return { ipcMain, handlers }
}

function makeTaggerRepo(): TaggerRepo {
  return {
    upsertEdit: vi.fn(),
    deleteEdit: vi.fn(),
    getEdit: vi.fn(() => null),
    listEditsByPaths: vi.fn(() => new Map()),
    getSession: vi.fn(() => null),
    setSession: vi.fn(),
    topGenres: vi.fn(() => [])
  } as unknown as TaggerRepo
}

function makeScanRepo(): ScanRepo {
  return {
    findLatestScan: vi.fn(() => null),
    listIncompleteFiles: vi.fn(() => [])
  } as unknown as ScanRepo
}

function makeSettings(root: string | null): SettingsRepo {
  return {
    get: vi.fn(() => root),
    set: vi.fn()
  } as unknown as SettingsRepo
}

function file(p: string): ScannedFile {
  return {
    path: p,
    format: 'MP3',
    bitrate: 320,
    sizeBytes: 1,
    sampleRate: 44100,
    durationSeconds: 1,
    hasGenre: false,
    hasBpm: false,
    hasKey: false,
    parsedOk: true,
    errorMessage: null
  }
}

describe('registerTaggerHandlers', () => {
  let ipcMain: IpcMain
  let handlers: Map<string, Handler>
  let taggerRepo: TaggerRepo
  let scanRepo: ScanRepo
  let settingsRepo: SettingsRepo
  const NOW = 1000

  beforeEach(() => {
    const ipc = makeIpc()
    ipcMain = ipc.ipcMain
    handlers = ipc.handlers
    taggerRepo = makeTaggerRepo()
    scanRepo = makeScanRepo()
    settingsRepo = makeSettings('/Music')
    registerTaggerHandlers({
      ipcMain,
      taggerRepo,
      scanRepo,
      settingsRepo,
      resolveFfmpegPath: () => '/fake/ffmpeg',
      now: () => NOW
    })
  })

  it('registers all 7 channels', () => {
    expect(ipcMain.handle).toHaveBeenCalledTimes(7)
    expect(handlers.has(IpcChannels.TaggerLoadQueue)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerSaveEdit)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerDeleteEdit)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerGetSession)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerSetSession)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerGetGenrePresets)).toBe(true)
    expect(handlers.has(IpcChannels.TaggerGetWaveform)).toBe(true)
  })

  describe('tagger:get-waveform', () => {
    it('returns empty when no rootFolder', async () => {
      settingsRepo.get = vi.fn(() => null)
      const r = await handlers.get(IpcChannels.TaggerGetWaveform)!(
        {},
        '/Music/a.mp3',
        100
      )
      expect(r).toEqual({ peaks: [], durationSec: null })
    })

    it('returns empty for a path outside rootFolder (no ffmpeg spawn)', async () => {
      const r = await handlers.get(IpcChannels.TaggerGetWaveform)!(
        {},
        '/etc/passwd',
        100
      )
      expect(r).toEqual({ peaks: [], durationSec: null })
    })

    it('returns empty for a non-audio extension', async () => {
      const r = await handlers.get(IpcChannels.TaggerGetWaveform)!(
        {},
        '/Music/note.txt',
        100
      )
      expect(r).toEqual({ peaks: [], durationSec: null })
    })
  })

  describe('tagger:load-queue', () => {
    it('returns empty when no rootFolder', async () => {
      settingsRepo.get = vi.fn(() => null)
      const r = (await handlers.get(IpcChannels.TaggerLoadQueue)!({})) as {
        scanId: string | null
        files: ScannedFile[]
        pendingEdits: Record<string, PendingTagEdit>
      }
      expect(r).toEqual({ scanId: null, files: [], pendingEdits: {} })
    })

    it('returns empty when no latest scan exists', async () => {
      const r = (await handlers.get(IpcChannels.TaggerLoadQueue)!({})) as {
        scanId: string | null
      }
      expect(r.scanId).toBeNull()
    })

    it('returns files + pendingEdits when a scan exists', async () => {
      scanRepo.findLatestScan = vi.fn(
        () =>
          ({
            id: 's1',
            rootFolder: '/Music',
            startedAt: 1,
            endedAt: null,
            totalFiles: 1,
            status: 'done'
          }) as never
      )
      scanRepo.listIncompleteFiles = vi.fn(() => [file('/Music/a.mp3')])
      const editMap = new Map<string, PendingTagEdit>([
        [
          '/Music/a.mp3',
          {
            filePath: '/Music/a.mp3',
            genre: 'House',
            bpm: 128,
            key: null,
            artist: null,
            title: null,
            comment: null,
            rating: null,
            updatedAt: 1,
            appliedAt: null
          }
        ]
      ])
      taggerRepo.listEditsByPaths = vi.fn(() => editMap)
      const r = (await handlers.get(IpcChannels.TaggerLoadQueue)!({})) as {
        scanId: string | null
        files: ScannedFile[]
        pendingEdits: Record<string, PendingTagEdit>
      }
      expect(r.scanId).toBe('s1')
      expect(r.files).toHaveLength(1)
      expect(r.pendingEdits['/Music/a.mp3']?.genre).toBe('House')
    })
  })

  describe('tagger:save-edit', () => {
    const h = (): Handler => handlers.get(IpcChannels.TaggerSaveEdit)!

    it('rejects non-object payload', async () => {
      await expect(h()({}, 'oops')).rejects.toThrow(TypeError)
    })

    it('rejects filePath not under rootFolder (T-4-01)', async () => {
      await expect(
        h()({}, { filePath: '/etc/passwd', rating: 5 })
      ).rejects.toThrow(/not under rootFolder/i)
    })

    it('rejects extension not in AUDIO_EXTS (T-4-02)', async () => {
      await expect(h()({}, { filePath: '/Music/note.txt' })).rejects.toThrow(
        /AUDIO_EXTS/
      )
    })

    it('rejects rating=6 (T-4-04)', async () => {
      await expect(
        h()({}, { filePath: '/Music/a.mp3', rating: 6 })
      ).rejects.toThrow(/rating/)
    })

    it('rejects rating=0 (T-4-04)', async () => {
      await expect(
        h()({}, { filePath: '/Music/a.mp3', rating: 0 })
      ).rejects.toThrow(/rating/)
    })

    it('rejects bpm=500 (T-4-05)', async () => {
      await expect(
        h()({}, { filePath: '/Music/a.mp3', bpm: 500 })
      ).rejects.toThrow(/bpm/)
    })

    it('rejects bpm non-integer (T-4-05)', async () => {
      await expect(
        h()({}, { filePath: '/Music/a.mp3', bpm: 128.5 })
      ).rejects.toThrow(/bpm/)
    })

    it('rejects genre longer than 500 chars (T-4-03)', async () => {
      await expect(
        h()({}, { filePath: '/Music/a.mp3', genre: 'a'.repeat(501) })
      ).rejects.toThrow(/genre/)
    })

    it('valid payload calls upsertEdit with normalised values', async () => {
      await h()({}, { filePath: '/Music/a.mp3', genre: 'House', bpm: 128, rating: 4 })
      expect(taggerRepo.upsertEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/Music/a.mp3',
          genre: 'House',
          bpm: 128,
          rating: 4
        }),
        NOW
      )
    })
  })

  describe('tagger:delete-edit', () => {
    const h = (): Handler => handlers.get(IpcChannels.TaggerDeleteEdit)!

    it('rejects filePath not under rootFolder', async () => {
      await expect(h()({}, '/etc/passwd')).rejects.toThrow(/not under rootFolder/i)
    })

    it('calls taggerRepo.deleteEdit on a valid path', async () => {
      await h()({}, '/Music/a.mp3')
      expect(taggerRepo.deleteEdit).toHaveBeenCalledWith('/Music/a.mp3')
    })
  })

  describe('tagger:get-session', () => {
    it('returns taggerRepo.getSession() result', async () => {
      const session = {
        rootFolder: '/Music',
        currentFilePath: null,
        scanId: null,
        updatedAt: 1
      }
      taggerRepo.getSession = vi.fn(() => session)
      const r = await handlers.get(IpcChannels.TaggerGetSession)!({})
      expect(r).toEqual(session)
    })
  })

  describe('tagger:set-session', () => {
    const h = (): Handler => handlers.get(IpcChannels.TaggerSetSession)!

    it('accepts null currentFilePath (clearing)', async () => {
      await h()({}, { currentFilePath: null, scanId: null })
      expect(taggerRepo.setSession).toHaveBeenCalledWith(
        {
          rootFolder: '/Music',
          currentFilePath: null,
          scanId: null
        },
        NOW
      )
    })

    it('rejects non-null currentFilePath outside rootFolder', async () => {
      await expect(
        h()({}, { currentFilePath: '/etc/passwd', scanId: null })
      ).rejects.toThrow(/not under rootFolder/i)
    })

    it('writes session with rootFolder + values', async () => {
      await h()({}, { currentFilePath: '/Music/a.mp3', scanId: 's1' })
      expect(taggerRepo.setSession).toHaveBeenCalledWith(
        {
          rootFolder: '/Music',
          currentFilePath: '/Music/a.mp3',
          scanId: 's1'
        },
        NOW
      )
    })
  })

  describe('tagger:get-genre-presets', () => {
    const h = (): Handler => handlers.get(IpcChannels.TaggerGetGenrePresets)!

    it('returns source=defaults when topGenres is empty', async () => {
      taggerRepo.topGenres = vi.fn(() => [])
      const r = (await h()({})) as {
        source: string
        presets: string[]
      }
      expect(r.source).toBe('defaults')
      expect(r.presets).toHaveLength(9)
    })

    it('returns source=mixed when topGenres has fewer than 9', async () => {
      taggerRepo.topGenres = vi.fn(() => [
        { genre: 'Disco', count: 3 },
        { genre: 'Soul', count: 2 },
        { genre: 'Reggae', count: 1 }
      ])
      const r = (await h()({})) as { source: string; presets: string[] }
      expect(r.source).toBe('mixed')
      expect(r.presets).toHaveLength(9)
      expect(r.presets.slice(0, 3)).toEqual(['Disco', 'Soul', 'Reggae'])
    })

    it('returns source=library when topGenres has 9+', async () => {
      taggerRepo.topGenres = vi.fn(() =>
        ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'].map((g) => ({
          genre: g,
          count: 1
        }))
      )
      const r = (await h()({})) as { source: string; presets: string[] }
      expect(r.source).toBe('library')
      expect(r.presets).toHaveLength(9)
    })
  })
})
