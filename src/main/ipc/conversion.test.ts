import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  conversionStartHandler,
  conversionCancelHandler,
  conversionListResumableHandler,
  conversionResumeHandler,
  conversionDiscardHandler,
  registerConversionHandlers,
  type ConversionStartHandlerDeps
} from './conversion'
import { BatchAlreadyActive, type ConversionController } from '../conversion/controller'
import type { ConversionRepo } from '../conversion/conversionRepo'
import { PRESETS } from '../conversion/presets'
import type { SettingsRepo } from '../db/settingsRepo'
import { IpcChannels, type ResumableBatch } from '../../shared/ipc-types'

const MP3_320 = PRESETS[0]

function makeController(): ConversionController {
  return {
    start: vi.fn(async () => 'conv-1'),
    cancel: vi.fn(async () => {}),
    resume: vi.fn(async () => {}),
    listResumable: vi.fn(() => []),
    markStaleAsCrashed: vi.fn(() => 0)
  } as unknown as ConversionController
}

function makeRepo(): ConversionRepo {
  return {
    createConversion: vi.fn(),
    insertFileBatch: vi.fn(),
    updateFile: vi.fn(),
    bumpHeartbeat: vi.fn(),
    complete: vi.fn(),
    findResumable: vi.fn(() => []),
    markStaleAsCrashed: vi.fn(() => 0),
    getResumablePending: vi.fn(() => []),
    listFiles: vi.fn(() => []),
    deleteConversion: vi.fn(),
    getConversion: vi.fn(() => null),
    updateConversionStatus: vi.fn()
  } as unknown as ConversionRepo
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

describe('conversionListResumableHandler — Plan 03-03', () => {
  it('returns repo.findResumable() (not the stubbed [])', async () => {
    const repo = makeRepo()
    const batches: ResumableBatch[] = [
      {
        conversionId: 'c-1',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        pendingCount: 5,
        doneCount: 2,
        errorCount: 1,
        startedAt: 1_000
      }
    ]
    ;(repo.findResumable as ReturnType<typeof vi.fn>).mockReturnValueOnce(batches)
    const result = await conversionListResumableHandler({ repo })
    expect(result).toEqual(batches)
    expect(repo.findResumable).toHaveBeenCalledTimes(1)
  })
})

describe('conversionResumeHandler — Plan 03-03', () => {
  it('rejects a non-string id (V5, T-3-13)', async () => {
    const controller = makeController()
    await expect(conversionResumeHandler({ controller }, 42)).rejects.toThrow(
      /string/
    )
    expect(controller.resume).not.toHaveBeenCalled()
  })

  it('forwards to controller.resume on the happy path', async () => {
    const controller = makeController()
    await conversionResumeHandler({ controller }, 'conv-7')
    expect(controller.resume).toHaveBeenCalledWith('conv-7')
  })

  it('maps BatchAlreadyActive → "Une conversion est déjà en cours"', async () => {
    const controller = makeController()
    ;(controller.resume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new BatchAlreadyActive()
    )
    await expect(conversionResumeHandler({ controller }, 'conv-1')).rejects.toThrow(
      'Une conversion est déjà en cours'
    )
  })

  it('maps "Batch not resumable" → "Cette conversion ne peut pas être reprise"', async () => {
    const controller = makeController()
    ;(controller.resume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('Batch not resumable')
    )
    await expect(conversionResumeHandler({ controller }, 'conv-1')).rejects.toThrow(
      'Cette conversion ne peut pas être reprise'
    )
  })

  it('lets unknown errors propagate untouched', async () => {
    const controller = makeController()
    ;(controller.resume as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('disk full')
    )
    await expect(conversionResumeHandler({ controller }, 'conv-1')).rejects.toThrow(
      'disk full'
    )
  })
})

describe('conversionDiscardHandler — Plan 03-03', () => {
  it('rejects a non-string id (V5, T-3-14)', async () => {
    const repo = makeRepo()
    await expect(conversionDiscardHandler({ repo }, 99)).rejects.toThrow(/string/)
    expect(repo.deleteConversion).not.toHaveBeenCalled()
  })

  it('delegates to repo.deleteConversion (CASCADE drops conversion_files)', async () => {
    const repo = makeRepo()
    await conversionDiscardHandler({ repo }, 'conv-9')
    expect(repo.deleteConversion).toHaveBeenCalledWith('conv-9')
  })
})

describe('registerConversionHandlers', () => {
  it('registers exactly 5 ipcMain.handle channels (Plan 03-03 adds Discard)', () => {
    const handle = vi.fn()
    const ipcMain = { handle } as unknown as Parameters<typeof registerConversionHandlers>[0]['ipcMain']
    const controller = makeController()
    const settingsRepo = makeSettingsRepo()
    const repo = makeRepo()
    registerConversionHandlers({
      ipcMain,
      controller,
      repo,
      settingsRepo,
      getSender: () => null
    })
    const channels = handle.mock.calls.map((c) => c[0])
    expect(channels).toContain(IpcChannels.ConversionStart)
    expect(channels).toContain(IpcChannels.ConversionCancel)
    expect(channels).toContain(IpcChannels.ConversionListResumable)
    expect(channels).toContain(IpcChannels.ConversionResume)
    expect(channels).toContain(IpcChannels.ConversionDiscard)
    expect(handle).toHaveBeenCalledTimes(5)
  })
})

describe('main.index.ts boot-sweep ordering (Pitfall 9 — architectural invariant)', () => {
  it('calls markStaleAsCrashed BEFORE createWindow() in source order', () => {
    const indexPath = path.resolve(__dirname, '..', 'index.ts')
    const src = fs.readFileSync(indexPath, 'utf8')
    const lines = src.split('\n')
    const sweepLine = lines.findIndex((l) =>
      /controller\.markStaleAsCrashed\s*\(/.test(l) ||
      /conversionController\.markStaleAsCrashed\s*\(/.test(l)
    )
    // Match the CALL site (assignment), not the function declaration.
    const createWindowLine = lines.findIndex((l) =>
      /=\s*createWindow\s*\(\s*\)/.test(l)
    )
    expect(sweepLine).toBeGreaterThanOrEqual(0)
    expect(createWindowLine).toBeGreaterThanOrEqual(0)
    expect(sweepLine).toBeLessThan(createWindowLine)
  })
})
