/**
 * Shared IPC types for the contextBridge `window.crateKeeper` API.
 * Imported by main (handler registration), preload (bridge exposure),
 * and renderer (typed window.crateKeeper).
 */

/** Channel names — single source of truth so main + preload never drift. */
export const IpcChannels = {
  PickFolder: 'dialog:pick-folder',
  GetRootFolder: 'settings:get-folder',
  SetRootFolder: 'settings:set-folder',
  /**
   * Generic typed K/V settings access, allowlisted on the main side.
   * Added in Plan 03-02 to satisfy LOCKED persistence of conversion.lastPreset.
   * Only keys in SETTINGS_KEY_ALLOWLIST are accepted (T-1-02 mitigation).
   */
  GetSetting: 'settings:get',
  SetSetting: 'settings:set',
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
  ConversionDiscard: 'conversion:discard',
  /**
   * Independent-entry file picker. Opens an OS dialog rooted at the persisted
   * rootFolder and returns the multi-selected audio file paths after the same
   * folder-allowlist + AUDIO_EXTS gate as ConversionStart (T-3-01, T-3-08).
   * Used by the Convertir view when the user enters that tool directly
   * (without going through Analyser → checkbox flow).
   */
  ConversionPickFiles: 'conversion:pick-files',
  /** main → renderer push channel; not invoked from the renderer. */
  ConversionEvent: 'conversion:event',
  // Phase 4 — tagger namespace (LOCKED in 04-CONTEXT.md).
  TaggerLoadQueue: 'tagger:load-queue',
  TaggerSaveEdit: 'tagger:save-edit',
  TaggerDeleteEdit: 'tagger:delete-edit',
  TaggerGetSession: 'tagger:get-session',
  TaggerSetSession: 'tagger:set-session',
  TaggerGetGenrePresets: 'tagger:get-genre-presets',
  TaggerGetWaveform: 'tagger:get-waveform'
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

export interface CrateKeeperScanApi {
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

export interface CrateKeeperConversionApi {
  start(params: {
    rootFolder: string
    filePaths: string[]
    preset: Preset
  }): Promise<string>
  cancel(conversionId: string): Promise<void>
  listResumable(): Promise<ResumableBatch[]>
  resume(conversionId: string): Promise<void>
  /**
   * Drops a crashed batch row from the DB. CASCADE drops its conversion_files
   * rows. Idempotent — discarding a non-existent id is a no-op.
   */
  discard(conversionId: string): Promise<void>
  /**
   * Opens an OS file dialog for picking audio files directly from the
   * Convertir view. Returns the selected paths that pass the rootFolder
   * allowlist + AUDIO_EXTS gate (entries failing the gate are dropped).
   * Returns null when the user cancels the dialog.
   */
  pickFiles(): Promise<string[] | null>
  /** Subscribes to conversion:event pushes; returns an unsubscribe closure. */
  onEvent(cb: (e: ConversionEvent) => void): () => void
}

/**
 * Settings keys that may be read/written through the generic
 * settings:get / settings:set bridge. Anything outside this set is rejected
 * on the main side (T-1-02: untrusted IPC argument).
 *
 * `tagger.muteEnabled` added in Phase 4 Plan 01 — T-4-07 mitigation
 * (tagger mute toggle persistence without unbounded settings-key surface).
 */
export const SETTINGS_KEY_ALLOWLIST = [
  'conversion.lastPreset',
  'tagger.muteEnabled'
] as const
export type AllowedSettingKey = (typeof SETTINGS_KEY_ALLOWLIST)[number]

// ───────────────────────── Phase 4 — tagger ──────────────────────────────────

/** A pending edit row staged for Phase 5 file writes. PK = file_path. */
export interface PendingTagEdit {
  filePath: string
  genre: string | null
  bpm: number | null
  key: string | null
  artist: string | null
  title: string | null
  comment: string | null
  rating: number | null
  updatedAt: number
  appliedAt: number | null
}

/** Single-row tagger session for resume (LOCKED: identity = file path). */
export interface TaggerSession {
  rootFolder: string
  currentFilePath: string | null
  scanId: string | null
  updatedAt: number
}

/** Payload returned by `tagger:load-queue`. */
export interface TaggerQueueResult {
  scanId: string | null
  files: ScannedFile[]
  pendingEdits: Record<string, PendingTagEdit>
}

/** Payload returned by `tagger:get-genre-presets`. `presets.length === 9`. */
export interface GenrePresetsResult {
  source: 'library' | 'defaults' | 'mixed'
  presets: string[]
}

/**
 * Payload returned by `tagger:get-waveform`. `peaks` are normalized 0..1
 * amplitude bars decoded in the main process via ffmpeg — the renderer never
 * decodes audio (that caused native renderer crashes). `durationSec` is the
 * track length in seconds, or null when ffmpeg could not determine it.
 */
export interface WaveformResult {
  peaks: number[]
  durationSec: number | null
}

/** Payload accepted by `tagger:save-edit`. Undefined fields are coerced to null. */
export interface SaveTagEditInput {
  filePath: string
  genre?: string | null
  bpm?: number | null
  key?: string | null
  artist?: string | null
  title?: string | null
  comment?: string | null
  rating?: number | null
}

export interface CrateKeeperTaggerApi {
  loadQueue(): Promise<TaggerQueueResult>
  saveEdit(input: SaveTagEditInput): Promise<void>
  deleteEdit(filePath: string): Promise<void>
  getSession(): Promise<TaggerSession | null>
  setSession(input: {
    currentFilePath: string | null
    scanId: string | null
  }): Promise<void>
  getGenrePresets(): Promise<GenrePresetsResult>
  /** Decode a normalized waveform for `filePath` in the main process. */
  getWaveform(filePath: string, bars: number): Promise<WaveformResult>
}

export interface CrateKeeperApi {
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
  /** Generic K/V settings read; key must be in the allowlist. */
  getSetting(key: AllowedSettingKey): Promise<string | null>
  /** Generic K/V settings write; key must be in the allowlist. */
  setSetting(key: AllowedSettingKey, value: string): Promise<void>
  scan: CrateKeeperScanApi
  conversion: CrateKeeperConversionApi
  tagger: CrateKeeperTaggerApi
}

declare global {
  interface Window {
    crateKeeper: CrateKeeperApi
  }
}
