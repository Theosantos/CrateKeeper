import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  conversionStartHandler,
  conversionCancelHandler,
  conversionListResumableHandler,
  conversionResumeHandler,
  registerConversionHandlers,
  type ConversionStartHandlerDeps
} from './conversion'
import { BatchAlreadyActive, type ConversionController } from '../conversion/controller'
import { PRESETS } from '../conversion/presets'
import type { SettingsRepo } from '../db/settingsRepo'
import { IpcChannels } from '../../shared/ipc-types'

const MP3_320 = PRESETS[0]

function makeController(): ConversionController {
  return {
    start: vi.fn(async () => 'conv-1'),
    cancel: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    listResumable: vi.fn(() => [])
  } as unknown as ConversionController
}

function makeSettingsRepo(rootFolder: string | null = '/Music'): SettingsRepo {
  return {
    get: vi.fn((_k: string) => rootFolder),
    set: vi.fn(),
    has: vi.fn()
  } as unknown as SettingsRepo
}

describe('conversionStartHandler', () => {
  let controller: ConversionController
  let settingsRepo: SettingsRepo
  let deps: ConversionStartHandlerDeps

  beforeEach(() => {
    controller = makeController()
    settingsRepo = makeSettingsRepo('/Music')
    deps = { controller, settingsRepo }
  })

  it('rejects non-object payload (V5)', async () => {
    await expect(conversionStartHandler(deps, 'oops')).rejects.toThrow(/object/i)
    expect(controller.start).not.toHaveBeenCalled()
  })

  it('rejects when rootFolder does not match settings', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Other',
        filePaths: ['/Other/a.mp3'],
        preset: MP3_320
      })
    ).rejects.toThrow(/rootFolder/)
    expect(controller.start).not.toHaveBeenCalled()
  })

  it('rejects when no rootFolder is configured', async () => {
    deps = { controller, settingsRepo: makeSettingsRepo(null) }
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: MP3_320
      })
    ).rejects.toThrow(/no rootFolder/)
  })

  it('rejects an empty filePaths array', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: [],
        preset: MP3_320
      })
    ).rejects.toThrow(/non-empty/)
  })

  it('rejects a filePath OUTSIDE rootFolder (allowlist gate, T-3-01)', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/etc/passwd'],
        preset: MP3_320
      })
    ).rejects.toThrow(/does not resolve under rootFolder/)
    expect(controller.start).not.toHaveBeenCalled()
  })

  it('rejects path-traversal via `..` (path.resolve collapses, startsWith catches)', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/../etc/passwd'],
        preset: MP3_320
      })
    ).rejects.toThrow(/does not resolve under rootFolder/)
    expect(controller.start).not.toHaveBeenCalled()
  })

  it('rejects files with unsupported extensions (AUDIO_EXTS server-side filter, plan-checker SUGGESTION 1)', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/notes.txt'],
        preset: MP3_320
      })
    ).rejects.toThrow(/unsupported extension/)
    expect(controller.start).not.toHaveBeenCalled()
  })

  it('rejects an unknown preset slug (T-3-04)', async () => {
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: { ...MP3_320, slug: 'bogus' }
      })
    ).rejects.toThrow(/unknown preset/)
  })

  it("accepts 'custom' preset with allow-listed codec", async () => {
    const customPreset = {
      slug: 'custom',
      label: 'Custom',
      codec: 'aac',
      bitrateKbps: 192,
      vbrQuality: null,
      sampleRate: null,
      extension: '.aac'
    }
    const id = await conversionStartHandler(deps, {
      rootFolder: '/Music',
      filePaths: ['/Music/a.mp3'],
      preset: customPreset
    })
    expect(id).toBe('conv-1')
    expect(controller.start).toHaveBeenCalled()
  })

  it("rejects 'custom' preset with off-list codec (T-3-08)", async () => {
    const evilPreset = {
      slug: 'custom',
      label: 'Custom',
      codec: '/bin/sh',
      bitrateKbps: 192,
      vbrQuality: null,
      sampleRate: null,
      extension: '.aac'
    }
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: evilPreset
      })
    ).rejects.toThrow(/custom\.codec must be one of/)
  })

  it("rejects 'custom' preset with bitrate > 1024 (T-3-08)", async () => {
    const bigBitrate = {
      slug: 'custom',
      label: 'Custom',
      codec: 'aac',
      bitrateKbps: 9999,
      vbrQuality: null,
      sampleRate: null,
      extension: '.aac'
    }
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: bigBitrate
      })
    ).rejects.toThrow(/bitrateKbps must be null or a positive integer/)
  })

  it('happy path: forwards to controller.start and returns conversionId', async () => {
    const id = await conversionStartHandler(deps, {
      rootFolder: '/Music',
      filePaths: ['/Music/a.mp3', '/Music/sub/b.flac'],
      preset: MP3_320
    })
    expect(id).toBe('conv-1')
    expect(controller.start).toHaveBeenCalledWith({
      rootFolder: '/Music',
      filePaths: ['/Music/a.mp3', '/Music/sub/b.flac'],
      preset: MP3_320
    })
  })

  it('maps BatchAlreadyActive to "Une conversion est déjà en cours"', async () => {
    ;(controller.start as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BatchAlreadyActive()
    )
    await expect(
      conversionStartHandler(deps, {
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: MP3_320
      })
    ).rejects.toThrow('Une conversion est déjà en cours')
  })
})

describe('conversionCancelHandler', () => {
  it('rejects a non-string id (V5)', async () => {
    const controller = makeController()
    await expect(conversionCancelHandler({ controller }, 42)).rejects.toThrow(/string/)
  })

  it('forwards to controller.cancel', async () => {
    const controller = makeController()
    await conversionCancelHandler({ controller }, 'conv-1')
    expect(controller.cancel).toHaveBeenCalledWith('conv-1')
  })
})

describe('conversionListResumableHandler — stub for Plan 03-03', () => {
  it('returns [] (stub)', async () => {
    expect(await conversionListResumableHandler()).toEqual([])
  })
})

describe('conversionResumeHandler — stub for Plan 03-03', () => {
  it('throws "not implemented"', async () => {
    await expect(conversionResumeHandler('any')).rejects.toThrow(/not implemented/)
  })
})

describe('registerConversionHandlers', () => {
  it('registers exactly 4 ipcMain.handle channels for the conversion namespace', () => {
    const handle = vi.fn()
    const ipcMain = { handle } as unknown as Parameters<typeof registerConversionHandlers>[0]['ipcMain']
    const controller = makeController()
    const settingsRepo = makeSettingsRepo()
    registerConversionHandlers({
      ipcMain,
      controller,
      settingsRepo,
      getSender: () => null
    })
    const channels = handle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IpcChannels.ConversionStart)
    expect(channels).toContain(IpcChannels.ConversionCancel)
    expect(channels).toContain(IpcChannels.ConversionListResumable)
    expect(channels).toContain(IpcChannels.ConversionResume)
    expect(handle).toHaveBeenCalledTimes(4)
  })
})
