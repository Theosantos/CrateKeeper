import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'node:path'
import { IpcChannels, type ScanEvent } from '../../shared/ipc-types'
import type { ScanController } from '../scan/controller'
import type { SettingsRepo } from '../db/settingsRepo'
import type { ScanRepo } from '../scan/scanRepo'
import { streamCsv } from '../scan/csvExport'

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
 * Pure: formats a Date as `dj-utils-scan-YYYYMMDD-HHmm.csv` using UTC components
 * so the output is deterministic across host timezones (and trivially testable).
 */
export function defaultCsvFilename(now: Date = new Date()): string {
  const pad = (n: number): string => n.toString().padStart(2, '0')
  const yyyy = now.getUTCFullYear().toString()
  const mm = pad(now.getUTCMonth() + 1)
  const dd = pad(now.getUTCDate())
  const hh = pad(now.getUTCHours())
  const mi = pad(now.getUTCMinutes())
  return `dj-utils-scan-${yyyy}${mm}${dd}-${hh}${mi}.csv`
}

/** Minimal subset of electron.dialog used by scanExportCsvHandler. */
export interface SaveDialogApi {
  showSaveDialog(options: {
    defaultPath: string
    filters: Array<{ name: string; extensions: string[] }>
  }): Promise<{ canceled: boolean; filePath?: string }>
}

export interface ScanExportCsvDeps {
  repo: ScanRepo
  dialogApi: SaveDialogApi
  streamCsvFn: typeof streamCsv
  downloadsPath: string
  now?: () => Date
}

/**
 * scan:export-csv handler.
 *
 * Flow: V5 input check → scan-existence fast-fail (no dialog if ghost id) →
 * showSaveDialog with a downloads-derived default path → on confirm, stream
 * scanRepo.iterateFiles(scanId) through streamCsv into the chosen path.
 *
 * Security (T-2-01): the save path is composed exclusively from the
 * dialog-derived `filePath` and (for the default suggestion) from
 * `downloadsPath` + `defaultCsvFilename(now)`. The renderer-supplied scanId
 * never participates in path construction.
 */
export async function scanExportCsvHandler(
  deps: ScanExportCsvDeps,
  scanId: unknown
): Promise<string | null> {
  if (typeof scanId !== 'string') {
    throw new TypeError(`${IpcChannels.ScanExportCsv}: scanId must be a string`)
  }
  const scan = deps.repo.getScan(scanId)
  if (scan === null) {
    throw new Error(`${IpcChannels.ScanExportCsv}: no scan found for id`)
  }
  const now = deps.now ? deps.now() : new Date()
  const defaultPath = path.join(deps.downloadsPath, defaultCsvFilename(now))
  const result = await deps.dialogApi.showSaveDialog({
    defaultPath,
    filters: [{ name: 'CSV', extensions: ['csv'] }]
  })
  if (result.canceled || !result.filePath) {
    return null
  }
  await deps.streamCsvFn(deps.repo.iterateFiles(scanId), result.filePath)
  return result.filePath
}

export interface RegisterScanHandlersOpts extends ScanHandlerDeps {
  ipcMain: IpcMain
  getSender: () => WebContents | null
  /** Required for the export-csv handler — the live ScanRepo (already wired in main). */
  scanRepo: ScanRepo
  /** Override-able for tests; defaults to app.getPath('downloads') in production. */
  downloadsPath?: string
  /** Override-able for tests; defaults to electron.dialog in production. */
  dialogApi?: SaveDialogApi
  /** Override-able for tests; defaults to the real streamCsv. */
  streamCsvFn?: typeof streamCsv
}

/**
 * Register the three scan invoke channels on ipcMain. The scan:event push
 * channel is forwarded by the controller's `send` dep wired at construction
 * time, NOT registered here — `ipcMain.handle` is for renderer→main calls.
 */
export function registerScanHandlers(opts: RegisterScanHandlersOpts): void {
  const deps: ScanHandlerDeps = { controller: opts.controller, settingsRepo: opts.settingsRepo }
  // Defer electron module access to registration time so unit tests can import
  // the pure handlers without pulling in the electron runtime binary.
  let resolvedDialog = opts.dialogApi
  let resolvedDownloads = opts.downloadsPath
  if (resolvedDialog === undefined || resolvedDownloads === undefined) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const electron = require('electron') as typeof import('electron')
    resolvedDialog = resolvedDialog ?? electron.dialog
    resolvedDownloads = resolvedDownloads ?? electron.app.getPath('downloads')
  }
  const exportDeps: ScanExportCsvDeps = {
    repo: opts.scanRepo,
    dialogApi: resolvedDialog,
    streamCsvFn: opts.streamCsvFn ?? streamCsv,
    downloadsPath: resolvedDownloads,
    now: () => new Date()
  }
  opts.ipcMain.handle(IpcChannels.ScanStart, (_e: IpcMainInvokeEvent, folder: unknown) =>
    scanStartHandler(deps, folder)
  )
  opts.ipcMain.handle(IpcChannels.ScanCancel, (_e: IpcMainInvokeEvent, scanId: unknown) =>
    scanCancelHandler(deps, scanId)
  )
  opts.ipcMain.handle(IpcChannels.ScanExportCsv, (_e: IpcMainInvokeEvent, scanId: unknown) =>
    scanExportCsvHandler(exportDeps, scanId)
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
