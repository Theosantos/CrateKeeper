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
  ScanEvent: 'scan:event',
  // Phase 3 — conversion namespace.
  ConversionStart: 'conversion:start',
  ConversionCancel: 'conversion:cancel',
  ConversionListResumable: 'conversion:list-resumable',
  ConversionResume: 'conversion:resume',
  /** main → renderer push channel; not invoked from the renderer. */
  ConversionEvent: 'conversion:event'
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

// ───────────────────────── Phase 3 — conversion ──────────────────────────────

/** A conversion target spec (one of the 5 hardcoded presets OR a Custom form output). */
export interface Preset {
  /** 'mp3-320' | 'mp3-v0' | 'aac-256' | 'flac' | 'wav' | 'custom' */
  slug: string
  /** User-facing French label. */
  label: string
  /** ffmpeg codec name (libmp3lame, aac, flac, pcm_s16le, libopus). */
  codec: string
  /** CBR bitrate in kbps; null for VBR/lossless. */
  bitrateKbps: number | null
  /** libmp3lame VBR quality 0-9; null for CBR/lossless. */
  vbrQuality: number | null
  /** Output sample rate; null = preserve source. */
  sampleRate: number | null
  /** Output file extension including the dot (e.g. '.mp3'). */
  extension: string
}

export type ConversionFileStatus =
  | 'pending'
  | 'running'
  | 'done'
  | 'error'
  | 'skipped'
  | 'cancelled'

/**
 * Public conversion event surface (main → renderer).
 *
 * Intentionally OMITS the worker-internal `fileStart` event — that lives in
 * src/main/workers/conversionWorker.ts → controller as an internal hook for
 * flipping conversion_files.status to 'running'. Plan 03-02 consumers only
 * see the five members below. (Plan-checker SUGGESTION 2: explicit placement.)
 */
export type ConversionEvent =
  | {
      type: 'progress'
      conversionId: string
      filePath: string
      percent: number
      phase: 'transcoding' | 'finalizing'
    }
  | {
      type: 'fileDone'
      conversionId: string
      filePath: string
      status: ConversionFileStatus
      outputPath: string | null
      errorMessage: string | null
    }
  | { type: 'done'; conversionId: string }
  | { type: 'cancelled'; conversionId: string }
  | { type: 'error'; conversionId: string; message: string }

/** Crashed batch surfaced via conversion:list-resumable (Plan 03-03 wires it). */
export interface ResumableBatch {
  conversionId: string
  rootFolder: string
  preset: Preset
  outputDir: string
  pendingCount: number
  doneCount: number
  errorCount: number
  startedAt: number
}

export interface DjUtilsConversionApi {
  start(params: {
    rootFolder: string
    filePaths: string[]
    preset: Preset
  }): Promise<string>
  cancel(conversionId: string): Promise<void>
  listResumable(): Promise<ResumableBatch[]>
  resume(conversionId: string): Promise<void>
  /** Subscribes to conversion:event pushes; returns an unsubscribe closure. */
  onEvent(cb: (e: ConversionEvent) => void): () => void
}

export interface DjUtilsApi {
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
  scan: DjUtilsScanApi
  conversion: DjUtilsConversionApi
}

declare global {
  interface Window {
    djUtils: DjUtilsApi
  }
}
