import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { DjUtilsApi, ScanEvent, ScannedFile } from '../../../shared/ipc-types'
import { useScanStore } from './useScanStore'

type ScanCallback = (e: ScanEvent) => void

type MockedScanApi = {
  start: ReturnType<typeof vi.fn<DjUtilsApi['scan']['start']>>
  cancel: ReturnType<typeof vi.fn<DjUtilsApi['scan']['cancel']>>
  exportCsv: ReturnType<typeof vi.fn<DjUtilsApi['scan']['exportCsv']>>
  onEvent: ReturnType<typeof vi.fn<DjUtilsApi['scan']['onEvent']>>
  /** captured callback registered by the store on subscribe */
  emit: (e: ScanEvent) => void
  /** vi.fn() returned as unsubscribe — test asserts on .mock.calls */
  unsubscribe: ReturnType<typeof vi.fn>
}

function installScanMock(scanId = 'scan-1'): MockedScanApi {
  let registered: ScanCallback | null = null
  const unsubscribe = vi.fn()
  const onEvent = vi.fn<DjUtilsApi['scan']['onEvent']>((cb) => {
    registered = cb
    return unsubscribe
  })
  const start = vi.fn<DjUtilsApi['scan']['start']>().mockResolvedValue(scanId)
  const cancel = vi.fn<DjUtilsApi['scan']['cancel']>().mockResolvedValue(undefined)
  const exportCsv = vi
    .fn<DjUtilsApi['scan']['exportCsv']>()
    .mockResolvedValue(null)

  const api = { start, cancel, exportCsv, onEvent }
  globalThis.window.djUtils = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue(null),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    scan: api as unknown as DjUtilsApi['scan'],
    conversion: {
      start: vi.fn().mockResolvedValue(''),
      cancel: vi.fn().mockResolvedValue(undefined),
      listResumable: vi.fn().mockResolvedValue([]),
      resume: vi.fn().mockResolvedValue(undefined),
      onEvent: vi.fn().mockReturnValue(() => {})
    } as unknown as DjUtilsApi['conversion']
  }

  return {
    start,
    cancel,
    exportCsv,
    onEvent,
    unsubscribe,
    emit: (e: ScanEvent): void => {
      if (registered === null) throw new Error('store did not subscribe before emit')
      registered(e)
    }
  }
}

function makeRow(i: number, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path: `/music/track-${i}.mp3`,
    format: 'mp3',
    bitrate: 320,
    sizeBytes: 1_000_000,
    sampleRate: 44_100,
    durationSeconds: 200,
    hasGenre: true,
    hasBpm: false,
    hasKey: true,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

describe('useScanStore', () => {
  beforeEach(() => {
    useScanStore.setState({
      scanId: null,
      status: 'idle',
      rows: [],
      totalFiles: null,
      durationMs: null,
      error: null,
      exporting: false,
      lastExportPath: null
    })
  })

  it('starts with idle state', () => {
    const s = useScanStore.getState()
    expect(s.scanId).toBeNull()
    expect(s.status).toBe('idle')
    expect(s.rows).toEqual([])
    expect(s.totalFiles).toBeNull()
    expect(s.durationMs).toBeNull()
    expect(s.error).toBeNull()
  })

  it('start(folder) calls scan.start, subscribes, sets running + scanId', async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    expect(api.start).toHaveBeenCalledWith('/music')
    expect(api.onEvent).toHaveBeenCalledTimes(1)
    const s = useScanStore.getState()
    expect(s.scanId).toBe('scan-A')
    expect(s.status).toBe('running')
    expect(s.rows).toEqual([])
  })

  it("'rows' events APPEND (single setState per batch, not per file)", async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    api.emit({ type: 'rows', scanId: 'scan-A', rows: [makeRow(1), makeRow(2), makeRow(3)] })
    expect(useScanStore.getState().rows.length).toBe(3)

    api.emit({ type: 'rows', scanId: 'scan-A', rows: [makeRow(4), makeRow(5)] })
    expect(useScanStore.getState().rows.length).toBe(5)
  })

  it("'rows' handler is a SINGLE setState per batch (Pitfall 5)", async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    let setStateCount = 0
    const unsub = useScanStore.subscribe(() => {
      setStateCount += 1
    })
    api.emit({ type: 'rows', scanId: 'scan-A', rows: [makeRow(1), makeRow(2), makeRow(3)] })
    expect(setStateCount).toBe(1)
    unsub()
  })

  it("'done' event sets status=done, totalFiles, durationMs, and unsubscribes", async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    api.emit({ type: 'done', scanId: 'scan-A', totalFiles: 42, durationMs: 1234 })

    const s = useScanStore.getState()
    expect(s.status).toBe('done')
    expect(s.totalFiles).toBe(42)
    expect(s.durationMs).toBe(1234)
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("'cancelled' event sets status=cancelled and unsubscribes", async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    api.emit({ type: 'cancelled', scanId: 'scan-A' })

    expect(useScanStore.getState().status).toBe('cancelled')
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it("'error' event sets status=error, error message, unsubscribes", async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    api.emit({ type: 'error', scanId: 'scan-A', message: 'EACCES /music' })

    const s = useScanStore.getState()
    expect(s.status).toBe('error')
    expect(s.error).toBe('EACCES /music')
    expect(api.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('cancel() invokes scan.cancel but does NOT set status — the cancelled event does', async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    await useScanStore.getState().cancel()
    expect(api.cancel).toHaveBeenCalledWith('scan-A')
    expect(useScanStore.getState().status).toBe('running')

    api.emit({ type: 'cancelled', scanId: 'scan-A' })
    expect(useScanStore.getState().status).toBe('cancelled')
  })

  it('starting while running unsubscribes the prior listener first', async () => {
    const firstApi = installScanMock('scan-A')
    await useScanStore.getState().start('/music')
    expect(useScanStore.getState().status).toBe('running')

    // Replace mock; subsequent start() should see the new bridge
    const secondApi = installScanMock('scan-B')
    await useScanStore.getState().start('/music')

    // Prior unsubscribe was called as part of the restart
    expect(firstApi.unsubscribe).toHaveBeenCalledTimes(1)
    expect(secondApi.start).toHaveBeenCalledWith('/music')
    expect(useScanStore.getState().scanId).toBe('scan-B')
    expect(useScanStore.getState().rows).toEqual([])
  })

  describe('exportCsv', () => {
    it('returns null when scanId is null (no bridge call)', async () => {
      const api = installScanMock('scan-A')
      // store is reset to idle in beforeEach — no scanId
      const result = await useScanStore.getState().exportCsv()
      expect(result).toBeNull()
      expect(api.exportCsv).not.toHaveBeenCalled()
    })

    it('returns null when status !== "done" (defence in depth)', async () => {
      const api = installScanMock('scan-A')
      await useScanStore.getState().start('/music')
      // status === 'running'
      const result = await useScanStore.getState().exportCsv()
      expect(result).toBeNull()
      expect(api.exportCsv).not.toHaveBeenCalled()
    })

    it('calls window.djUtils.scan.exportCsv(scanId) and returns the path on success', async () => {
      const api = installScanMock('scan-A')
      api.exportCsv.mockResolvedValue('/tmp/dj-utils.csv')
      await useScanStore.getState().start('/music')
      api.emit({ type: 'done', scanId: 'scan-A', totalFiles: 3, durationMs: 100 })

      const result = await useScanStore.getState().exportCsv()
      expect(api.exportCsv).toHaveBeenCalledWith('scan-A')
      expect(result).toBe('/tmp/dj-utils.csv')
      expect(useScanStore.getState().lastExportPath).toBe('/tmp/dj-utils.csv')
      // exporting flag must be cleared after the promise resolves
      expect(useScanStore.getState().exporting).toBe(false)
    })

    it('returns null and does not double-fire while another export is in flight', async () => {
      const api = installScanMock('scan-A')
      let resolveFirst!: (v: string | null) => void
      api.exportCsv.mockImplementationOnce(
        () =>
          new Promise<string | null>((res) => {
            resolveFirst = res
          })
      )
      await useScanStore.getState().start('/music')
      api.emit({ type: 'done', scanId: 'scan-A', totalFiles: 3, durationMs: 100 })

      const first = useScanStore.getState().exportCsv()
      // While the first is in-flight, exporting=true and a second call must no-op
      expect(useScanStore.getState().exporting).toBe(true)
      const second = await useScanStore.getState().exportCsv()
      expect(second).toBeNull()
      expect(api.exportCsv).toHaveBeenCalledTimes(1)

      resolveFirst('/tmp/x.csv')
      const firstResult = await first
      expect(firstResult).toBe('/tmp/x.csv')
      expect(useScanStore.getState().exporting).toBe(false)
    })
  })

  it('ignores rows events from a foreign scanId', async () => {
    const api = installScanMock('scan-A')
    await useScanStore.getState().start('/music')

    api.emit({ type: 'rows', scanId: 'scan-A', rows: [makeRow(1)] })
    expect(useScanStore.getState().rows.length).toBe(1)

    api.emit({ type: 'rows', scanId: 'scan-OTHER', rows: [makeRow(2), makeRow(3)] })
    expect(useScanStore.getState().rows.length).toBe(1)
  })
})
