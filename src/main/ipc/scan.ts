import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import { IpcChannels, type ScanEvent } from '../../shared/ipc-types'
import type { ScanController } from '../scan/controller'
import type { SettingsRepo } from '../db/settingsRepo'

const ROOT_FOLDER_KEY = 'rootFolder'

export interface ScanHandlerDeps {
  controller: ScanController
  settingsRepo: SettingsRepo
}

/**
 * scan:start handler.
 *
 * - Type-checks the renderer-supplied folder (V5).
 * - Asserts folder === settings.rootFolder (RESEARCH Pitfall 8): without this
 *   a compromised renderer could read arbitrary disk locations.
 */
export async function scanStartHandler(deps: ScanHandlerDeps, folder: unknown): Promise<string> {
  if (typeof folder !== 'string') {
    throw new TypeError(`${IpcChannels.ScanStart}: folder must be a string`)
  }
  const persisted = deps.settingsRepo.get(ROOT_FOLDER_KEY)
  if (persisted === null) {
    throw new Error(`${IpcChannels.ScanStart}: no rootFolder configured`)
  }
  if (folder !== persisted) {
    throw new Error(
      `${IpcChannels.ScanStart}: folder must equal the persisted rootFolder`
    )
  }
  return deps.controller.start(folder)
}

/** scan:cancel handler — type-checks scanId then delegates to controller. */
export async function scanCancelHandler(deps: ScanHandlerDeps, scanId: unknown): Promise<void> {
  if (typeof scanId !== 'string') {
    throw new TypeError(`${IpcChannels.ScanCancel}: scanId must be a string`)
  }
  await deps.controller.cancel(scanId)
}

/**
 * scan:export-csv stub.
 * Plan 02-03 replaces this with the streaming CSV implementation.
 */
export async function scanExportCsvHandler(
  _deps: ScanHandlerDeps,
  _scanId: unknown
): Promise<string | null> {
  throw new Error('scan:export-csv not implemented yet — Plan 02-03')
}

export interface RegisterScanHandlersOpts extends ScanHandlerDeps {
  ipcMain: IpcMain
  getSender: () => WebContents | null
}

/**
 * Register the three scan invoke channels on ipcMain. The scan:event push
 * channel is forwarded by the controller's `send` dep wired at construction
 * time, NOT registered here — `ipcMain.handle` is for renderer→main calls.
 */
export function registerScanHandlers(opts: RegisterScanHandlersOpts): void {
  const deps: ScanHandlerDeps = { controller: opts.controller, settingsRepo: opts.settingsRepo }
  opts.ipcMain.handle(IpcChannels.ScanStart, (_e: IpcMainInvokeEvent, folder: unknown) =>
    scanStartHandler(deps, folder)
  )
  opts.ipcMain.handle(IpcChannels.ScanCancel, (_e: IpcMainInvokeEvent, scanId: unknown) =>
    scanCancelHandler(deps, scanId)
  )
  opts.ipcMain.handle(IpcChannels.ScanExportCsv, (_e: IpcMainInvokeEvent, scanId: unknown) =>
    scanExportCsvHandler(deps, scanId)
  )
}

/**
 * Build the controller `send` dep that forwards ScanEvent payloads to the
 * current webContents. If the window is gone, the event is dropped silently.
 */
export function makeRendererSender(getSender: () => WebContents | null) {
  return (channel: string, payload: ScanEvent): void => {
    const wc = getSender()
    if (!wc || wc.isDestroyed()) {
      return
    }
    wc.send(channel, payload)
  }
}
