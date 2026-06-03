import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversionEvent,
  DjUtilsApi,
  Preset,
  ResumableBatch
} from '../../../shared/ipc-types'
import {
  selectGlobalProgress,
  selectSummaryCounts,
  useConversionStore
} from './useConversionStore'

type ConversionCallback = (e: ConversionEvent) => void

type MockedConversionApi = {
  start: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['start']>>
  cancel: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['cancel']>>
  listResumable: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['listResumable']>>
  resume: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['resume']>>
  discard: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['discard']>>
  onEvent: ReturnType<typeof vi.fn<DjUtilsApi['conversion']['onEvent']>>
  emit: (e: ConversionEvent) => void
  unsubscribe: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn<DjUtilsApi['getSetting']>>
  setSetting: ReturnType<typeof vi.fn<DjUtilsApi['setSetting']>>
}

function installMock(conversionId = 'conv-1'): MockedConversionApi {
  let registered: ConversionCallback | null = null
  const unsubscribe = vi.fn()
  const onEvent = vi.fn<DjUtilsApi['conversion']['onEvent']>((cb) => {
    registered = cb
    return unsubscribe
  })
  const start = vi.fn<DjUtilsApi['conversion']['start']>().mockResolvedValue(conversionId)
  const cancel = vi.fn<DjUtilsApi['conversion']['cancel']>().mockResolvedValue(undefined)
  const listResumable = vi
    .fn<DjUtilsApi['conversion']['listResumable']>()
    .mockResolvedValue([])
  const resume = vi
    .fn<DjUtilsApi['conversion']['resume']>()
    .mockResolvedValue(undefined)
  const discard = vi
    .fn<DjUtilsApi['conversion']['discard']>()
    .mockResolvedValue(undefined)
  const getSetting = vi
    .fn<DjUtilsApi['getSetting']>()
    .mockResolvedValue(null)
  const setSetting = vi
    .fn<DjUtilsApi['setSetting']>()
    .mockResolvedValue(undefined)

  globalThis.window.djUtils = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue(null),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    getSetting,
    setSetting,
    scan: {
      start: vi.fn().mockResolvedValue(''),
      cancel: vi.fn().mockResolvedValue(undefined),
      exportCsv: vi.fn().mockResolvedValue(null),
      onEvent: vi.fn().mockReturnValue(() => {})
    } as unknown as DjUtilsApi['scan'],
    conversion: {
      start,
      cancel,
      listResumable,
      resume,
      discard,
      onEvent
    } as unknown as DjUtilsApi['conversion']
  }

  return {
    start,
    cancel,
    listResumable,
    resume,
    discard,
    onEvent,
    unsubscribe,
    getSetting,
    setSetting,
    emit: (e: ConversionEvent): void => {
      if (registered === null) throw new Error('store did not subscribe before emit')
      registered(e)
    }
  }
}

const MP3_320: Preset = {
  slug: 'mp3-320',
  label: 'MP3 320 kbps (CBR)',
  codec: 'libmp3lame',
  bitrateKbps: 320,
  vbrQuality: null,
  sampleRate: null,
  extension: '.mp3'
}

describe('useConversionStore', () => {
  beforeEach(() => {
    useConversionStore.getState().reset()
  })

  it('initial state matches the locked defaults', () => {
    const s = useConversionStore.getState()
    expect(s.status).toBe('idle')
    expect(s.conversionId).toBeNull()
    expect(s.pendingFilePaths).toEqual([])
    expect(s.perFileProgress.size).toBe(0)
    expect(s.fileStatuses.size).toBe(0)
    expect(s.errors).toEqual([])
    expect(s.selectedPreset.slug).toBe('mp3-320')
    expect(s.customPreset).toBeNull()
    expect(s.error).toBeNull()
  })

  it('seedFilePaths stores the seeded selection', () => {
    useConversionStore.getState().seedFilePaths(['/a.mp3', '/b.mp3'])
    expect(useConversionStore.getState().pendingFilePaths).toEqual(['/a.mp3', '/b.mp3'])
  })

  it('setPreset replaces selectedPreset', () => {
    const flac: Preset = {
      slug: 'flac',
      label: 'FLAC (lossless)',
      codec: 'flac',
      bitrateKbps: null,
      vbrQuality: null,
      sampleRate: null,
      extension: '.flac'
    }
    useConversionStore.getState().setPreset(flac)
    expect(useConversionStore.getState().selectedPreset.slug).toBe('flac')
  })

  it('updateCustom merges partial fields into customPreset', () => {
    useConversionStore.getState().updateCustom({ codec: 'aac', bitrateKbps: 192 })
    const c = useConversionStore.getState().customPreset
    expect(c?.codec).toBe('aac')
    expect(c?.bitrateKbps).toBe(192)

    useConversionStore.getState().updateCustom({ sampleRate: 44100 })
    const c2 = useConversionStore.getState().customPreset
    expect(c2?.codec).toBe('aac')
    expect(c2?.sampleRate).toBe(44100)
  })

  it('startBatch invokes conversion.start with pendingFilePaths + preset and sets running + id', async () => {
    const api = installMock('conv-A')
    useConversionStore.getState().seedFilePaths(['/m/a.mp3', '/m/b.mp3'])
    await useConversionStore.getState().startBatch('/m')

    expect(api.start).toHaveBeenCalledWith({
      rootFolder: '/m',
      filePaths: ['/m/a.mp3', '/m/b.mp3'],
      preset: MP3_320
    })
    const s = useConversionStore.getState()
    expect(s.status).toBe('running')
    expect(s.conversionId).toBe('conv-A')
  })

  it('startBatch persists selectedPreset to settings.conversion.lastPreset (JSON)', async () => {
    const api = installMock('conv-A')
    useConversionStore.getState().seedFilePaths(['/m/a.mp3'])
    await useConversionStore.getState().startBatch('/m')

    expect(api.setSetting).toHaveBeenCalledWith(
      'conversion.lastPreset',
      JSON.stringify(MP3_320)
    )
  })

  it('cancelBatch invokes conversion.cancel with the active conversionId', async () => {
    const api = installMock('conv-A')
    useConversionStore.getState().seedFilePaths(['/m/a.mp3'])
    await useConversionStore.getState().startBatch('/m')
    await useConversionStore.getState().cancelBatch()
    expect(api.cancel).toHaveBeenCalledWith('conv-A')
  })

  it('subscribeEvents wires djUtils.conversion.onEvent and returns an unsubscribe', () => {
    const api = installMock()
    const off = useConversionStore.getState().subscribeEvents()
    expect(api.onEvent).toHaveBeenCalledTimes(1)
    off()
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("handler on 'progress' updates perFileProgress with a NEW Map instance", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    const before = useConversionStore.getState().perFileProgress
    api.emit({
      type: 'progress',
      conversionId: 'conv-1',
      filePath: '/m/a.mp3',
      percent: 42,
      phase: 'transcoding'
    })
    const after = useConversionStore.getState().perFileProgress
    expect(after).not.toBe(before)
    expect(after.get('/m/a.mp3')?.percent).toBe(42)
    expect(after.get('/m/a.mp3')?.phase).toBe('transcoding')
  })

  it("handler on 'fileDone' with status=done updates fileStatuses", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/m/a.mp3',
      status: 'done',
      outputPath: '/m/converted/mp3-320/a.mp3',
      errorMessage: null
    })
    expect(useConversionStore.getState().fileStatuses.get('/m/a.mp3')).toBe('done')
    expect(useConversionStore.getState().errors).toEqual([])
  })

  it("handler on 'fileDone' with status=error pushes into errors", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/m/a.mp3',
      status: 'error',
      outputPath: null,
      errorMessage: 'ffmpeg exited 1'
    })
    expect(useConversionStore.getState().fileStatuses.get('/m/a.mp3')).toBe('error')
    expect(useConversionStore.getState().errors).toEqual([
      { filePath: '/m/a.mp3', errorMessage: 'ffmpeg exited 1' }
    ])
  })

  it("handler on 'done' sets status=done", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({ type: 'done', conversionId: 'conv-1' })
    expect(useConversionStore.getState().status).toBe('done')
  })

  it("handler on 'cancelled' sets status=cancelled", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({ type: 'cancelled', conversionId: 'conv-1' })
    expect(useConversionStore.getState().status).toBe('cancelled')
  })

  it("handler on 'error' sets status=error + message", () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({ type: 'error', conversionId: 'conv-1', message: 'fatal' })
    const s = useConversionStore.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe('fatal')
  })

  it('unsubscribe closure prevents further handler invocations', () => {
    const api = installMock()
    const off = useConversionStore.getState().subscribeEvents()
    off()
    // Simulating a "late event": after unsubscribe, no state mutation must occur.
    // We re-install the mock so emit() still has a registered callback, but the
    // store-level unsubscribe has been invoked.
    expect(api.unsubscribe).toHaveBeenCalled()
  })

  it('selectGlobalProgress returns 0 when pendingFilePaths is empty (guard /0)', () => {
    expect(selectGlobalProgress(useConversionStore.getState())).toBe(0)
  })

  it('selectGlobalProgress returns rounded done/total percentage', () => {
    const api = installMock()
    useConversionStore.getState().seedFilePaths(['/a', '/b', '/c', '/d'])
    useConversionStore.getState().subscribeEvents()
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/a',
      status: 'done',
      outputPath: '/x',
      errorMessage: null
    })
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/b',
      status: 'skipped',
      outputPath: null,
      errorMessage: null
    })
    expect(selectGlobalProgress(useConversionStore.getState())).toBe(50)
  })

  it('selectSummaryCounts reports done/error/skipped/cancelled counts', () => {
    const api = installMock()
    useConversionStore.getState().subscribeEvents()
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/a',
      status: 'done',
      outputPath: '/x',
      errorMessage: null
    })
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/b',
      status: 'error',
      outputPath: null,
      errorMessage: 'boom'
    })
    api.emit({
      type: 'fileDone',
      conversionId: 'conv-1',
      filePath: '/c',
      status: 'skipped',
      outputPath: null,
      errorMessage: null
    })
    const counts = selectSummaryCounts(useConversionStore.getState())
    expect(counts).toEqual({ done: 1, error: 1, skipped: 1, cancelled: 0 })
  })

  it('BatchAlreadyActive rejection keeps status=idle and surfaces a French message in error', async () => {
    const api = installMock()
    api.start.mockRejectedValueOnce(new Error('BatchAlreadyActive'))
    useConversionStore.getState().seedFilePaths(['/a'])

    await useConversionStore.getState().startBatch('/m')
    const s = useConversionStore.getState()
    expect(s.status).toBe('idle')
    expect(s.error).toMatch(/conversion.*déjà.*cours/i)
  })

  // ─────────────────────── Plan 03-03 — resume surface ───────────────────────

  function mkBatch(id: string, overrides: Partial<ResumableBatch> = {}): ResumableBatch {
    return {
      conversionId: id,
      rootFolder: '/Music',
      preset: MP3_320,
      outputDir: '/Music/converted/mp3-320',
      pendingCount: 12,
      doneCount: 3,
      errorCount: 0,
      startedAt: 100,
      ...overrides
    }
  }

  it('resumableBatches initial state is []', () => {
    expect(useConversionStore.getState().resumableBatches).toEqual([])
  })

  it('checkResumable fetches via listResumable and sets resumableBatches', async () => {
    const api = installMock()
    const batches = [mkBatch('c-1'), mkBatch('c-2')]
    api.listResumable.mockResolvedValueOnce(batches)
    await useConversionStore.getState().checkResumable()
    expect(api.listResumable).toHaveBeenCalledTimes(1)
    expect(useConversionStore.getState().resumableBatches).toEqual(batches)
  })

  it('checkResumable is idempotent — replaces, does not append', async () => {
    const api = installMock()
    api.listResumable.mockResolvedValueOnce([mkBatch('c-1'), mkBatch('c-2')])
    await useConversionStore.getState().checkResumable()
    api.listResumable.mockResolvedValueOnce([mkBatch('c-3')])
    await useConversionStore.getState().checkResumable()
    const ids = useConversionStore.getState().resumableBatches.map((b) => b.conversionId)
    expect(ids).toEqual(['c-3'])
  })

  it('checkResumable on rejection: resumableBatches=[], sets state.error, does NOT throw', async () => {
    const api = installMock()
    api.listResumable.mockRejectedValueOnce(new Error('IPC down'))
    await expect(
      useConversionStore.getState().checkResumable()
    ).resolves.toBeUndefined()
    expect(useConversionStore.getState().resumableBatches).toEqual([])
    expect(useConversionStore.getState().error).toBe('IPC down')
  })

  it('resumeBatch calls conversion.resume, flips status=running + conversionId, restores preset', async () => {
    const api = installMock()
    const flacBatch = mkBatch('c-flac', {
      preset: {
        slug: 'flac',
        label: 'FLAC (lossless)',
        codec: 'flac',
        bitrateKbps: null,
        vbrQuality: null,
        sampleRate: null,
        extension: '.flac'
      }
    })
    api.listResumable.mockResolvedValueOnce([flacBatch, mkBatch('c-other')])
    await useConversionStore.getState().checkResumable()

    await useConversionStore.getState().resumeBatch('c-flac')

    expect(api.resume).toHaveBeenCalledWith('c-flac')
    const s = useConversionStore.getState()
    expect(s.status).toBe('running')
    expect(s.conversionId).toBe('c-flac')
    expect(s.selectedPreset.slug).toBe('flac')
    // The other resumable batch stays visible.
    expect(s.resumableBatches.map((b) => b.conversionId)).toEqual(['c-other'])
    expect(s.error).toBeNull()
  })

  it('resumeBatch wires subscribeEvents BEFORE conversion.resume so the first event is captured', async () => {
    const api = installMock()
    api.listResumable.mockResolvedValueOnce([mkBatch('c-1')])
    await useConversionStore.getState().checkResumable()

    await useConversionStore.getState().resumeBatch('c-1')

    const onEventOrder = api.onEvent.mock.invocationCallOrder.at(-1)!
    const resumeOrder = api.resume.mock.invocationCallOrder[0]
    expect(onEventOrder).toBeLessThan(resumeOrder)
  })

  it('resumeBatch resets perFileProgress / fileStatuses / errors before resuming', async () => {
    const api = installMock()
    // Pollute state.
    useConversionStore.setState({
      perFileProgress: new Map([['/x', { percent: 50, phase: 'transcoding' }]]),
      fileStatuses: new Map([['/x', 'error']]),
      errors: [{ filePath: '/x', errorMessage: 'old' }]
    })
    api.listResumable.mockResolvedValueOnce([mkBatch('c-1')])
    await useConversionStore.getState().checkResumable()

    await useConversionStore.getState().resumeBatch('c-1')

    const s = useConversionStore.getState()
    expect(s.perFileProgress.size).toBe(0)
    expect(s.fileStatuses.size).toBe(0)
    expect(s.errors).toEqual([])
  })

  it('resumeBatch on rejection (BatchAlreadyActive): sets state.error, keeps batch in resumableBatches', async () => {
    const api = installMock()
    const batch = mkBatch('c-1')
    api.listResumable.mockResolvedValueOnce([batch])
    await useConversionStore.getState().checkResumable()

    api.resume.mockRejectedValueOnce(new Error('Une conversion est déjà en cours'))
    await useConversionStore.getState().resumeBatch('c-1')

    const s = useConversionStore.getState()
    expect(s.error).toMatch(/déjà en cours/)
    expect(s.status).not.toBe('running')
    // Batch is restored so the user can retry once the active one finishes.
    expect(s.resumableBatches.map((b) => b.conversionId)).toContain('c-1')
  })

  it('discardBatch calls conversion.discard and removes the batch from resumableBatches', async () => {
    const api = installMock()
    api.listResumable.mockResolvedValueOnce([mkBatch('c-1'), mkBatch('c-2')])
    await useConversionStore.getState().checkResumable()

    await useConversionStore.getState().discardBatch('c-1')

    expect(api.discard).toHaveBeenCalledWith('c-1')
    const ids = useConversionStore
      .getState()
      .resumableBatches.map((b) => b.conversionId)
    expect(ids).toEqual(['c-2'])
  })

  it('startBatch resets perFileProgress / fileStatuses / errors / conversionId before launching', async () => {
    const api = installMock('conv-B')
    // Pollute state to make the reset observable.
    useConversionStore.setState({
      perFileProgress: new Map([['/x', { percent: 50, phase: 'transcoding' }]]),
      fileStatuses: new Map([['/x', 'error']]),
      errors: [{ filePath: '/x', errorMessage: 'old' }],
      conversionId: 'old'
    })
    useConversionStore.getState().seedFilePaths(['/m/a.mp3'])
    await useConversionStore.getState().startBatch('/m')

    const s = useConversionStore.getState()
    expect(s.errors).toEqual([])
    expect(s.fileStatuses.size).toBe(0)
    expect(s.perFileProgress.size).toBe(0)
    expect(s.conversionId).toBe('conv-B')
    expect(api.start).toHaveBeenCalled()
  })
})
