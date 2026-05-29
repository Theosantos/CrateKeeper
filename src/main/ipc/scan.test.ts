import { describe, it, expect, vi } from 'vitest'
import {
  scanStartHandler,
  scanCancelHandler,
  scanExportCsvHandler,
  defaultCsvFilename,
  registerScanHandlers,
  type ScanHandlerDeps,
  type ScanExportCsvDeps
} from './scan'
import { IpcChannels } from '../../shared/ipc-types'
import type { ScanController } from '../scan/controller'
import type { SettingsRepo } from '../db/settingsRepo'
import type { ScanRepo, ScanRow } from '../scan/scanRepo'

function makeDeps(overrides: Partial<ScanHandlerDeps> = {}): ScanHandlerDeps {
  return {
    controller: {
      start: vi.fn(async () => 'scan-uuid'),
      cancel: vi.fn(async () => undefined)
    } as unknown as ScanController,
    settingsRepo: {
      get: vi.fn(() => '/Music'),
      set: vi.fn()
    } as unknown as SettingsRepo,
    ...overrides
  }
}

function makeScanRow(id = 'scan-1'): ScanRow {
  return {
    id,
    rootFolder: '/Music',
    startedAt: 1_700_000_000_000,
    endedAt: 1_700_000_001_000,
    totalFiles: 3,
    status: 'done'
  }
}

interface ExportDepsOverrides {
  scanRow?: ScanRow | null
  cancelled?: boolean
  pickedFilePath?: string
  now?: Date
  downloadsPath?: string
}

function makeExportDeps(o: ExportDepsOverrides = {}): {
  deps: ScanExportCsvDeps
  showSaveDialog: ReturnType<typeof vi.fn>
  streamCsvFn: ReturnType<typeof vi.fn>
  iterateFiles: ReturnType<typeof vi.fn>
} {
  const scanRow = o.scanRow === undefined ? makeScanRow() : o.scanRow
  const iterateFiles = vi.fn(() => (function* () {})())
  const repo = {
    getScan: vi.fn(() => scanRow),
    iterateFiles
  } as unknown as ScanRepo
  const showSaveDialog = vi.fn(async () => ({
    canceled: o.cancelled ?? false,
    filePath: o.pickedFilePath ?? '/tmp/dj-utils-scan.csv'
  }))
  const streamCsvFn = vi.fn(async () => undefined)
  const deps: ScanExportCsvDeps = {
    repo,
    dialogApi: { showSaveDialog },
    streamCsvFn,
    downloadsPath: o.downloadsPath ?? '/Users/test/Downloads',
    now: () => o.now ?? new Date('2026-05-29T14:32:00Z')
  }
  return { deps, showSaveDialog, streamCsvFn, iterateFiles }
}

describe('scan IPC handlers', () => {
  describe('scanStartHandler', () => {
    it('rejects when folder is not a string (V5 input validation)', async () => {
      const deps = makeDeps()
      await expect(scanStartHandler(deps, 42)).rejects.toThrow(TypeError)
      expect(deps.controller.start).not.toHaveBeenCalled()
    })

    it('rejects when folder !== settings.rootFolder (Pitfall 8 mitigation)', async () => {
      const deps = makeDeps()
      await expect(scanStartHandler(deps, '/etc/passwd')).rejects.toThrow(/rootFolder/)
      expect(deps.controller.start).not.toHaveBeenCalled()
    })

    it('rejects when no rootFolder is persisted', async () => {
      const deps = makeDeps({
        settingsRepo: { get: vi.fn(() => null), set: vi.fn() } as unknown as SettingsRepo
      })
      await expect(scanStartHandler(deps, '/Music')).rejects.toThrow()
      expect(deps.controller.start).not.toHaveBeenCalled()
    })

    it('calls controller.start when folder === persisted rootFolder', async () => {
      const deps = makeDeps()
      const id = await scanStartHandler(deps, '/Music')
      expect(deps.controller.start).toHaveBeenCalledWith('/Music')
      expect(id).toBe('scan-uuid')
    })
  })

  describe('scanCancelHandler', () => {
    it('rejects when scanId is not a string', async () => {
      const deps = makeDeps()
      await expect(scanCancelHandler(deps, 42)).rejects.toThrow(TypeError)
      expect(deps.controller.cancel).not.toHaveBeenCalled()
    })

    it('calls controller.cancel with a string scanId', async () => {
      const deps = makeDeps()
      await scanCancelHandler(deps, 'scan-1')
      expect(deps.controller.cancel).toHaveBeenCalledWith('scan-1')
    })
  })

  describe('defaultCsvFilename', () => {
    it('formats as dj-utils-scan-YYYYMMDD-HHmm.csv with zero-padding', () => {
      const fn = defaultCsvFilename(new Date('2026-05-29T14:32:00Z'))
      expect(fn).toMatch(/^dj-utils-scan-\d{8}-\d{4}\.csv$/)
    })

    it('zero-pads single-digit months/days/hours/minutes', () => {
      // Use UTC to avoid local-tz drift in CI
      const fn = defaultCsvFilename(new Date(Date.UTC(2026, 0, 3, 4, 5, 0)))
      // 2026-01-03 04:05 → 20260103-0405
      expect(fn).toBe('dj-utils-scan-20260103-0405.csv')
    })

    it('is pure (same Date in → same name out)', () => {
      const d = new Date('2026-05-29T14:32:00Z')
      expect(defaultCsvFilename(d)).toBe(defaultCsvFilename(d))
    })
  })

  describe('scanExportCsvHandler', () => {
    it('rejects when scanId is not a string (V5)', async () => {
      const { deps } = makeExportDeps()
      await expect(scanExportCsvHandler(deps, 42)).rejects.toThrow(TypeError)
    })

    it('rejects fast when scanId references a non-existent scan (no dialog opened)', async () => {
      const { deps, showSaveDialog } = makeExportDeps({ scanRow: null })
      await expect(scanExportCsvHandler(deps, 'ghost-scan')).rejects.toThrow()
      expect(showSaveDialog).not.toHaveBeenCalled()
    })

    it('calls showSaveDialog with downloads-derived defaultPath + csv filter', async () => {
      const { deps, showSaveDialog } = makeExportDeps({
        downloadsPath: '/Users/test/Downloads',
        now: new Date(Date.UTC(2026, 4, 29, 14, 32, 0))
      })
      await scanExportCsvHandler(deps, 'scan-1')
      expect(showSaveDialog).toHaveBeenCalledTimes(1)
      const opts = showSaveDialog.mock.calls[0][0]
      expect(opts.defaultPath).toBe('/Users/test/Downloads/dj-utils-scan-20260529-1432.csv')
      expect(opts.filters).toEqual([{ name: 'CSV', extensions: ['csv'] }])
    })

    it('returns null and does NOT invoke streamCsvFn when the user cancels', async () => {
      const { deps, streamCsvFn } = makeExportDeps({ cancelled: true })
      const result = await scanExportCsvHandler(deps, 'scan-1')
      expect(result).toBeNull()
      expect(streamCsvFn).not.toHaveBeenCalled()
    })

    it('streams to the dialog-chosen path and returns it on success', async () => {
      const { deps, streamCsvFn, iterateFiles } = makeExportDeps({
        pickedFilePath: '/tmp/my-export.csv'
      })
      const result = await scanExportCsvHandler(deps, 'scan-1')
      expect(result).toBe('/tmp/my-export.csv')
      expect(iterateFiles).toHaveBeenCalledWith('scan-1')
      expect(streamCsvFn).toHaveBeenCalledTimes(1)
      const [iterArg, pathArg] = streamCsvFn.mock.calls[0]
      expect(pathArg).toBe('/tmp/my-export.csv')
      // iterArg is the iterator returned by repo.iterateFiles('scan-1')
      expect(iterArg).toBeDefined()
    })

    it('renderer-supplied scanId never participates in path construction (T-2-01)', async () => {
      const malicious = '../../../etc/passwd'
      const { deps, showSaveDialog } = makeExportDeps({
        downloadsPath: '/Users/test/Downloads',
        now: new Date(Date.UTC(2026, 4, 29, 14, 32, 0)),
        scanRow: { ...makeScanRow(), id: malicious }
      })
      // repo.getScan returns a row for the malicious id, but the save path must
      // not contain the id — it's composed solely from downloads + timestamp.
      await scanExportCsvHandler(deps, malicious)
      const opts = showSaveDialog.mock.calls[0][0]
      expect(opts.defaultPath).not.toContain('passwd')
      expect(opts.defaultPath).not.toContain('..')
      expect(opts.defaultPath).toBe('/Users/test/Downloads/dj-utils-scan-20260529-1432.csv')
    })
  })

  describe('registerScanHandlers', () => {
    it('registers the three invoke channels on ipcMain.handle', () => {
      const handleCalls: Array<{ channel: string; fn: unknown }> = []
      const fakeIpcMain = {
        handle: vi.fn((channel: string, fn: unknown) => {
          handleCalls.push({ channel, fn })
        })
      }
      registerScanHandlers({
        ipcMain: fakeIpcMain as unknown as Electron.IpcMain,
        controller: makeDeps().controller,
        settingsRepo: makeDeps().settingsRepo,
        scanRepo: makeExportDeps().deps.repo,
        downloadsPath: '/Users/test/Downloads',
        getSender: () => null
      })
      const channels = handleCalls.map((c) => c.channel)
      expect(channels).toContain(IpcChannels.ScanStart)
      expect(channels).toContain(IpcChannels.ScanCancel)
      expect(channels).toContain(IpcChannels.ScanExportCsv)
      expect(channels).not.toContain(IpcChannels.ScanEvent) // push-only, never .handle'd
    })
  })
})
