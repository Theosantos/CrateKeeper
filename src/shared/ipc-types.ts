/**
 * Shared IPC types for the contextBridge `window.djUtils` API.
 * Imported by main (handler registration), preload (bridge exposure),
 * and renderer (typed window.djUtils).
 */

/** Channel names — single source of truth so main + preload never drift. */
export const IpcChannels = {
  PickFolder: 'dialog:pick-folder',
  GetRootFolder: 'settings:get-folder',
  SetRootFolder: 'settings:set-folder',
  // Phase 2 — scan namespace.
  ScanStart: 'scan:start',
  ScanCancel: 'scan:cancel',
  ScanExportCsv: 'scan:export-csv',
  /** main → renderer push channel; not invoked from the renderer. */
  ScanEvent: 'scan:event'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

/** Single file row produced by the scan worker. */
export interface ScannedFile {
  path: string
  format: string
  bitrate: number | null
  sizeBytes: number
  sampleRate: number | null
  durationSeconds: number | null
  hasGenre: boolean
  hasBpm: boolean
  hasKey: boolean
  parsedOk: boolean
  errorMessage: string | null
}

/** Discriminated union pushed from main → renderer over IpcChannels.ScanEvent. */
export type ScanEvent =
  | { type: 'rows'; scanId: string; rows: ScannedFile[] }
  | { type: 'done'; scanId: string; totalFiles: number; durationMs: number }
  | { type: 'error'; scanId: string; message: string }
  | { type: 'cancelled'; scanId: string }

export interface DjUtilsScanApi {
  start(folder: string): Promise<string>
  cancel(scanId: string): Promise<void>
  exportCsv(scanId: string): Promise<string | null>
  /** Subscribes to scan:event pushes; returns an unsubscribe closure. */
  onEvent(cb: (e: ScanEvent) => void): () => void
}

export interface DjUtilsApi {
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
  scan: DjUtilsScanApi
}

declare global {
  interface Window {
    djUtils: DjUtilsApi
  }
}
