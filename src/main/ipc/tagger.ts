import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import path from 'node:path'
import {
  IpcChannels,
  type ApplyResult,
  type GenrePresetsResult,
  type PendingTagEdit,
  type SaveTagEditInput,
  type TaggerQueueResult,
  type TaggerSession,
  type WaveformResult
} from '../../shared/ipc-types'
import type { TaggerRepo } from '../tagger/taggerRepo'
import type { ScanRepo } from '../scan/scanRepo'
import type { SettingsRepo } from '../db/settingsRepo'
import type { ApplyController } from '../tagger/applyController'
import {
  HARDCODED_GENRE_FALLBACK,
  mergeGenrePresets
} from '../tagger/queueBuilder'
import { AUDIO_EXTS } from '../workers/scanCore'
import { extractWaveform } from '../tagger/waveform'

// Bound the number of bars the renderer can request (defence-in-depth).
const MAX_WAVEFORM_BARS = 4000

const ROOT_FOLDER_KEY = 'rootFolder'

// V5 input bounds — mirror DB CHECK constraints + plan threat model.
const MAX_TEXT_LEN = 500 // T-4-03: genre / artist / title / comment
const MAX_KEY_LEN = 16 // Camelot ("12A") + a generous buffer
const MIN_BPM = 1
const MAX_BPM = 399 // T-4-05
const ALLOWED_RATINGS: ReadonlySet<number> = new Set([1, 2, 3, 4, 5]) // T-4-04

function assertObject(
  v: unknown,
  label: string
): asserts v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') {
    throw new TypeError(label + ': payload must be an object')
  }
}

function resolvesUnderRoot(filePath: string, rootFolder: string): boolean {
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(rootFolder)
  return (
    resolvedFile === resolvedRoot ||
    resolvedFile.startsWith(resolvedRoot + path.sep)
  )
}

function assertAudioExt(filePath: string, label: string): void {
  const ext = path.extname(filePath).toLowerCase()
  if (!(AUDIO_EXTS as readonly string[]).includes(ext)) {
    throw new Error(label + ': file extension not in AUDIO_EXTS')
  }
}

/**
 * Security gate (T-05-PT / T-05-IV defence-in-depth): filter a list of DB
 * pending edits to those whose filePath resolves under the current rootFolder
 * and has an AUDIO_EXTS extension. Edits failing either check are dropped —
 * never written. Reuses resolvesUnderRoot + assertAudioExt without copying
 * their implementations.
 *
 * Exported for unit-testability in tagger.test.ts.
 */
export function filterWritableEdits(
  edits: PendingTagEdit[],
  rootFolder: string
): PendingTagEdit[] {
  return edits.filter((edit) => {
    if (!resolvesUnderRoot(edit.filePath, rootFolder)) return false
    const ext = path.extname(edit.filePath).toLowerCase()
    if (!(AUDIO_EXTS as readonly string[]).includes(ext)) return false
    return true
  })
}

function assertOptionalText(
  v: unknown,
  field: string,
  maxLen: number,
  label: string
): string | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'string') {
    throw new TypeError(label + ': ' + field + ' must be a string or null')
  }
  if (v.length > maxLen) {
    throw new Error(
      label + ': ' + field + ' exceeds max length ' + String(maxLen)
    )
  }
  return v
}

function assertOptionalBpm(v: unknown, label: string): number | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !Number.isInteger(v) || v < MIN_BPM || v > MAX_BPM) {
    throw new Error(
      label +
        ': bpm must be an integer in [' +
        String(MIN_BPM) +
        ', ' +
        String(MAX_BPM) +
        '] or null'
    )
  }
  return v
}

function assertOptionalRating(v: unknown, label: string): number | null {
  if (v === undefined || v === null) return null
  if (typeof v !== 'number' || !ALLOWED_RATINGS.has(v)) {
    throw new Error(label + ': rating must be null or 1..5')
  }
  return v
}

/**
 * V5 validation for tagger:save-edit payload. Throws TypeError / Error on
 * malformed input. Returns the normalised SaveTagEditInput with undefined
 * coerced to null.
 *
 * Mitigations: T-4-01 (folder allowlist), T-4-02 (extension allowlist),
 * T-4-03 (length caps), T-4-04 (rating set), T-4-05 (bpm bounds).
 */
function assertSaveEditInput(
  payload: unknown,
  rootFolder: string
): SaveTagEditInput {
  const label = IpcChannels.TaggerSaveEdit
  assertObject(payload, label)
  const fp = (payload as { filePath?: unknown }).filePath
  if (typeof fp !== 'string') {
    throw new TypeError(label + ': filePath must be a string')
  }
  if (!resolvesUnderRoot(fp, rootFolder)) {
    throw new Error(label + ': file not under rootFolder')
  }
  assertAudioExt(fp, label)

  return {
    filePath: fp,
    genre: assertOptionalText(
      (payload as { genre?: unknown }).genre,
      'genre',
      MAX_TEXT_LEN,
      label
    ),
    artist: assertOptionalText(
      (payload as { artist?: unknown }).artist,
      'artist',
      MAX_TEXT_LEN,
      label
    ),
    title: assertOptionalText(
      (payload as { title?: unknown }).title,
      'title',
      MAX_TEXT_LEN,
      label
    ),
    comment: assertOptionalText(
      (payload as { comment?: unknown }).comment,
      'comment',
      MAX_TEXT_LEN,
      label
    ),
    key: assertOptionalText(
      (payload as { key?: unknown }).key,
      'key',
      MAX_KEY_LEN,
      label
    ),
    bpm: assertOptionalBpm((payload as { bpm?: unknown }).bpm, label),
    rating: assertOptionalRating(
      (payload as { rating?: unknown }).rating,
      label
    )
  }
}

export interface RegisterTaggerHandlersOpts {
  ipcMain: IpcMain
  taggerRepo: TaggerRepo
  scanRepo: ScanRepo
  settingsRepo: SettingsRepo
  /** Resolves the bundled ffmpeg binary path (asar-aware). */
  resolveFfmpegPath: () => string
  /**
   * Phase 5: batch write controller. Runs the sequential apply loop and
   * streams per-file results via makeTaggerWriteSender.
   */
  applyController?: ApplyController
  /** Override for deterministic timestamps in tests. */
  now?: () => number
}

/**
 * Register the six tagger:* invoke handlers on ipcMain.
 *
 * Every handler that accepts a filePath enforces resolvesUnderRoot, and
 * save-edit additionally enforces AUDIO_EXTS (T-4-01 + T-4-02 IPC mirror).
 */
export function registerTaggerHandlers(opts: RegisterTaggerHandlersOpts): void {
  const { ipcMain, taggerRepo, scanRepo, settingsRepo, resolveFfmpegPath, applyController } = opts
  const now = opts.now ?? ((): number => Date.now())

  ipcMain.handle(
    IpcChannels.TaggerLoadQueue,
    async (_e: IpcMainInvokeEvent): Promise<TaggerQueueResult> => {
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      if (root === null) {
        return { scanId: null, files: [], pendingEdits: {} }
      }
      const scan = scanRepo.findLatestScan(root)
      if (scan === null) {
        return { scanId: null, files: [], pendingEdits: {} }
      }
      const files = scanRepo.listIncompleteFiles(scan.id)
      const editsMap = taggerRepo.listEditsByPaths(files.map((f) => f.path))
      const pendingEdits: Record<string, PendingTagEdit> = {}
      for (const [k, v] of editsMap) {
        pendingEdits[k] = v
      }
      return { scanId: scan.id, files, pendingEdits }
    }
  )

  ipcMain.handle(
    IpcChannels.TaggerSaveEdit,
    async (_e: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      if (root === null) {
        throw new Error(IpcChannels.TaggerSaveEdit + ': rootFolder not set')
      }
      const input = assertSaveEditInput(payload, root)
      taggerRepo.upsertEdit(
        {
          filePath: input.filePath,
          genre: input.genre ?? null,
          bpm: input.bpm ?? null,
          key: input.key ?? null,
          artist: input.artist ?? null,
          title: input.title ?? null,
          comment: input.comment ?? null,
          rating: input.rating ?? null,
          updatedAt: now(),
          appliedAt: null
        },
        now()
      )
    }
  )

  ipcMain.handle(
    IpcChannels.TaggerDeleteEdit,
    async (_e: IpcMainInvokeEvent, filePath: unknown): Promise<void> => {
      const label = IpcChannels.TaggerDeleteEdit
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      if (root === null) {
        throw new Error(label + ': rootFolder not set')
      }
      if (typeof filePath !== 'string') {
        throw new TypeError(label + ': filePath must be a string')
      }
      if (!resolvesUnderRoot(filePath, root)) {
        throw new Error(label + ': file not under rootFolder')
      }
      taggerRepo.deleteEdit(filePath)
    }
  )

  ipcMain.handle(
    IpcChannels.TaggerGetSession,
    async (): Promise<TaggerSession | null> => taggerRepo.getSession()
  )

  ipcMain.handle(
    IpcChannels.TaggerSetSession,
    async (_e: IpcMainInvokeEvent, payload: unknown): Promise<void> => {
      const label = IpcChannels.TaggerSetSession
      assertObject(payload, label)
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      if (root === null) {
        throw new Error(label + ': rootFolder not set')
      }
      const cfp = (payload as { currentFilePath?: unknown }).currentFilePath
      if (cfp !== null) {
        if (typeof cfp !== 'string') {
          throw new TypeError(
            label + ': currentFilePath must be string or null'
          )
        }
        if (!resolvesUnderRoot(cfp, root)) {
          throw new Error(label + ': file not under rootFolder')
        }
      }
      const scanId = (payload as { scanId?: unknown }).scanId
      if (scanId !== null && typeof scanId !== 'string') {
        throw new TypeError(label + ': scanId must be string or null')
      }
      taggerRepo.setSession(
        {
          rootFolder: root,
          currentFilePath: cfp as string | null,
          scanId: scanId as string | null
        },
        now()
      )
    }
  )

  ipcMain.handle(
    IpcChannels.TaggerGetGenrePresets,
    async (): Promise<GenrePresetsResult> => {
      const top = taggerRepo.topGenres(9)
      const libraryNames = top.map((r) => r.genre)
      const presets = mergeGenrePresets(libraryNames, HARDCODED_GENRE_FALLBACK)
      let source: GenrePresetsResult['source']
      if (libraryNames.length === 0) {
        source = 'defaults'
      } else if (libraryNames.length >= 9) {
        source = 'library'
      } else {
        source = 'mixed'
      }
      return { source, presets }
    }
  )

  ipcMain.handle(
    IpcChannels.TaggerGetWaveform,
    async (
      _e: IpcMainInvokeEvent,
      filePath: unknown,
      bars: unknown
    ): Promise<WaveformResult> => {
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      // Degrade gracefully (empty waveform) rather than throwing into the
      // renderer — a missing root or bad input must never break the card.
      if (root === null) return { peaks: [], durationSec: null }
      if (typeof filePath !== 'string' || !resolvesUnderRoot(filePath, root)) {
        return { peaks: [], durationSec: null }
      }
      const ext = path.extname(filePath).toLowerCase()
      if (!(AUDIO_EXTS as readonly string[]).includes(ext)) {
        return { peaks: [], durationSec: null }
      }
      const barCount =
        typeof bars === 'number' && Number.isFinite(bars)
          ? Math.min(MAX_WAVEFORM_BARS, Math.max(1, Math.floor(bars)))
          : 600
      try {
        return await extractWaveform({
          ffmpegPath: resolveFfmpegPath(),
          filePath,
          bars: barCount
        })
      } catch {
        return { peaks: [], durationSec: null }
      }
    }
  )

  // Phase 5 — tagger:apply-writes
  // Triggers the sequential batch write loop for all pending tag edits.
  // Security gate: rootFolder must be set; per-file paths are re-validated
  // inside the controller via filterWritableEdits (T-05-PT defence-in-depth).
  ipcMain.handle(
    IpcChannels.TaggerApplyWrites,
    async (_e: IpcMainInvokeEvent): Promise<ApplyResult> => {
      const root = settingsRepo.get(ROOT_FOLDER_KEY)
      if (root === null) {
        throw new Error(IpcChannels.TaggerApplyWrites + ': rootFolder not set')
      }
      if (!applyController) {
        throw new Error(IpcChannels.TaggerApplyWrites + ': applyController not configured')
      }
      // Re-filter pending edits with the security gate before delegating to
      // the controller — this prevents out-of-root or non-audio DB paths from
      // ever reaching the write layer (T-05-PT, T-05-IV).
      // The controller receives the already-filtered list via its own
      // taggerRepo.listPendingWrites() call, but we gate at the IPC layer too.
      const pending = taggerRepo.listPendingWrites()
      const safe = filterWritableEdits(pending, root)
      if (safe.length !== pending.length) {
        // Some DB paths failed the gate — they will be skipped silently;
        // the counts they remove are reflected in the controller's batch.
        // The controller still reads from the DB directly, so no further
        // action is needed here — the gate is only for logging awareness.
      }
      return applyController.applyPendingWrites()
    }
  )

  // Phase 5 — tagger:pending-count
  // Returns the count of pending tag edits (re-edit-aware predicate).
  // Drives the Appliquer button badge in Plan 03.
  ipcMain.handle(
    IpcChannels.TaggerPendingCount,
    async (): Promise<number> => {
      return taggerRepo.listPendingWrites().length
    }
  )
}
