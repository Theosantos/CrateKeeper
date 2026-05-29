import { describe, it, expect, vi } from 'vitest'
import {
  scanStartHandler,
  scanCancelHandler,
  scanExportCsvHandler,
  registerScanHandlers,
  type ScanHandlerDeps
} from './scan'
import { IpcChannels } from '../../shared/ipc-types'
import type { ScanController } from '../scan/controller'
import type { SettingsRepo } from '../db/settingsRepo'

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

  describe('scanExportCsvHandler', () => {
    it('throws "not implemented" stub (Plan 02-03 replaces this)', async () => {
      const deps = makeDeps()
      await expect(scanExportCsvHandler(deps, 'scan-1')).rejects.toThrow(/not implemented/)
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
