import { create } from 'zustand'
import type {
  ConversionEvent,
  ConversionFileStatus,
  Preset,
  ResumableBatch
} from '../../../shared/ipc-types'

/**
 * Conversion lifecycle store. Mirrors useScanStore's shape:
 *  - all privileged calls go through `window.crateKeeper.conversion.*`
 *  - all setters produce NEW Map / Array / Set instances (immutability)
 *  - the subscribeEvents lifecycle returns an unsubscribe closure to be
 *    invoked on view unmount
 *  - BatchAlreadyActive rejections from main are surfaced as a state.error
 *    without flipping status away from 'idle' (LOCKED)
 *
 * Default preset is MP3 320 kbps (CBR) — D-CONV-FORMAT (LOCKED).
 */

export type ConversionStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

interface PerFileProgress {
  percent: number
  phase: 'transcoding' | 'finalizing'
}

interface ConversionErrorEntry {
  filePath: string
  errorMessage: string
}

export type ConversionState = {
  status: ConversionStatus
  conversionId: string | null
  pendingFilePaths: string[]
  perFileProgress: Map<string, PerFileProgress>
  fileStatuses: Map<string, ConversionFileStatus>
  errors: ConversionErrorEntry[]
  selectedPreset: Preset
  customPreset: Preset | null
  error: string | null
  /**
   * Crashed batches eligible for resume — seeded by checkResumable() on
   * ConvertirView mount (LOCKED Pitfall 9: one-shot, not polling).
   */
  resumableBatches: ResumableBatch[]

  seedFilePaths: (paths: string[]) => void
  setPreset: (preset: Preset) => void
  updateCustom: (partial: Partial<Preset>) => void
  startBatch: (rootFolder: string) => Promise<void>
  cancelBatch: () => Promise<void>
  subscribeEvents: () => () => void
  reset: () => void
  /**
   * One-shot fetch of repo.findResumable() via the conversion IPC bridge.
   * Idempotent — replaces the array, never appends. Errors set state.error
   * and reset resumableBatches to [] (banner just doesn't appear).
   */
  checkResumable: () => Promise<void>
  /**
   * Resume a crashed batch. On success: removes the batch from
   * resumableBatches, flips status='running' + conversionId=id, and
   * re-subscribes the event stream so per-file progress updates flow into
   * the existing perFileProgress / fileStatuses Maps. Uses
   * reset() → seedFilePaths(remaining) → subscribeEvents() →
   * conversion.resume(id) order so the renderer Maps are empty when the
   * worker starts emitting events.
   * On BatchAlreadyActive: sets state.error to the French message; the
   * batch stays in resumableBatches so the user can retry once the active
   * one finishes.
   */
  resumeBatch: (conversionId: string) => Promise<void>
  /**
   * Discard a crashed batch — drops the conversions row + CASCADE drops
   * conversion_files via the discard IPC channel. Removes the batch from
   * resumableBatches immediately on success.
   */
  discardBatch: (conversionId: string) => Promise<void>
}

/** D-CONV-FORMAT default (LOCKED): mp3-320 selected on every fresh mount. */
const DEFAULT_PRESET: Preset = {
  slug: 'mp3-320',
  label: 'MP3 320 kbps (CBR)',
  codec: 'libmp3lame',
  bitrateKbps: 320,
  vbrQuality: null,
  sampleRate: null,
  extension: '.mp3'
}

const CUSTOM_SEED: Preset = {
  slug: 'custom',
  label: 'Personnalisé',
  codec: 'libmp3lame',
  bitrateKbps: 320,
  vbrQuality: null,
  sampleRate: null,
  extension: '.mp3'
}

const INITIAL = {
  status: 'idle' as ConversionStatus,
  conversionId: null as string | null,
  pendingFilePaths: [] as string[],
  perFileProgress: new Map<string, PerFileProgress>(),
  fileStatuses: new Map<string, ConversionFileStatus>(),
  errors: [] as ConversionErrorEntry[],
  selectedPreset: DEFAULT_PRESET,
  customPreset: null as Preset | null,
  error: null as string | null,
  resumableBatches: [] as ResumableBatch[]
}

function isBatchAlreadyActive(err: unknown): boolean {
  if (err instanceof Error) {
    return err.name === 'BatchAlreadyActive' || /BatchAlreadyActive/.test(err.message)
  }
  return false
}

export const useConversionStore = create<ConversionState>((set, get) => {
  function handleEvent(e: ConversionEvent): void {
    switch (e.type) {
      case 'progress': {
        set((s) => {
          const next = new Map(s.perFileProgress)
          next.set(e.filePath, { percent: e.percent, phase: e.phase })
          return { perFileProgress: next }
        })
        return
      }
      case 'fileDone': {
        set((s) => {
          const nextStatuses = new Map(s.fileStatuses)
          nextStatuses.set(e.filePath, e.status)
          const nextErrors =
            e.status === 'error' && e.errorMessage !== null
              ? [...s.errors, { filePath: e.filePath, errorMessage: e.errorMessage }]
              : s.errors
          return { fileStatuses: nextStatuses, errors: nextErrors }
        })
        return
      }
      case 'done':
        set({ status: 'done' })
        return
      case 'cancelled':
        set({ status: 'cancelled' })
        return
      case 'error':
        set({ status: 'error', error: e.message })
        return
    }
  }

  return {
    ...INITIAL,

    seedFilePaths: (paths: string[]): void => {
      set({ pendingFilePaths: [...paths] })
    },

    setPreset: (preset: Preset): void => {
      // Initialise customPreset on first switch to custom — gives the form a seed.
      if (preset.slug === 'custom') {
        set((s) => ({
          selectedPreset: preset,
          customPreset: s.customPreset ?? { ...CUSTOM_SEED }
        }))
        return
      }
      set({ selectedPreset: preset })
    },

    updateCustom: (partial: Partial<Preset>): void => {
      set((s) => {
        const base = s.customPreset ?? { ...CUSTOM_SEED }
        const merged: Preset = { ...base, ...partial, slug: 'custom' }
        return { customPreset: merged }
      })
    },

    startBatch: async (rootFolder: string): Promise<void> => {
      const preset =
        get().selectedPreset.slug === 'custom'
          ? get().customPreset ?? { ...CUSTOM_SEED }
          : get().selectedPreset

      // Optimistic reset of per-batch state.
      set({
        status: 'running',
        error: null,
        conversionId: null,
        perFileProgress: new Map(),
        fileStatuses: new Map(),
        errors: []
      })

      try {
        const id = await window.crateKeeper.conversion.start({
          rootFolder,
          filePaths: [...get().pendingFilePaths],
          preset
        })
        set({ conversionId: id })
        // LOCKED persistence: remember the last preset used for next launch.
        await window.crateKeeper.setSetting('conversion.lastPreset', JSON.stringify(preset))
      } catch (err: unknown) {
        if (isBatchAlreadyActive(err)) {
          set({
            status: 'idle',
            error: 'Une conversion est déjà en cours. Annule-la avant d’en relancer une.'
          })
          return
        }
        const message = err instanceof Error ? err.message : 'Erreur inconnue'
        set({ status: 'error', error: message })
      }
    },

    cancelBatch: async (): Promise<void> => {
      const id = get().conversionId
      if (id === null) return
      await window.crateKeeper.conversion.cancel(id)
      // Status transition is driven by the 'cancelled' event from main —
      // not flipped here, to keep main as the single source of truth.
    },

    subscribeEvents: (): (() => void) => {
      return window.crateKeeper.conversion.onEvent((e) => handleEvent(e))
    },

    reset: (): void => {
      set({
        ...INITIAL,
        perFileProgress: new Map(),
        fileStatuses: new Map(),
        errors: [],
        pendingFilePaths: [],
        resumableBatches: []
      })
    },

    checkResumable: async (): Promise<void> => {
      try {
        const batches = await window.crateKeeper.conversion.listResumable()
        set({ resumableBatches: batches })
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to load resumable batches'
        set({ resumableBatches: [], error: message })
      }
    },

    resumeBatch: async (conversionId: string): Promise<void> => {
      const preResumable = get().resumableBatches
      const batch = preResumable.find((b) => b.conversionId === conversionId)
      try {
        // Order matters: reset → subscribe → resume.
        // reset() nukes the per-file Maps so leftover state from a prior
        // batch doesn't leak into the resumed UI; subscribeEvents must be
        // wired BEFORE conversion.resume so the first 'progress' event
        // from the worker is captured. We restore resumableBatches (minus
        // the one being resumed) AFTER the reset so other crashed batches
        // stay visible in the banner if the resume rejects.
        // pendingFilePaths stays [] because the ResumableBatch surface
        // only exposes pendingCount, not the file list — per-file rows
        // will appear as fileDone events arrive (plan-checker discretion:
        // already-done files NOT displayed).
        get().reset()
        set({
          resumableBatches: preResumable.filter(
            (b) => b.conversionId !== conversionId
          ),
          // Restore the original preset so it shows in the UI (LOCKED:
          // resume re-uses the original preset; user does NOT re-pick).
          selectedPreset: batch?.preset ?? DEFAULT_PRESET
        })
        get().subscribeEvents()
        await window.crateKeeper.conversion.resume(conversionId)
        set({
          status: 'running',
          conversionId,
          error: null
        })
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue'
        // Batch stays in resumableBatches so the user can retry — but
        // we already filtered it out above. Re-insert it.
        set((s) => ({
          error: message,
          resumableBatches:
            batch !== undefined &&
            !s.resumableBatches.some((b) => b.conversionId === conversionId)
              ? [...s.resumableBatches, batch]
              : s.resumableBatches
        }))
      }
    },

    discardBatch: async (conversionId: string): Promise<void> => {
      try {
        await window.crateKeeper.conversion.discard(conversionId)
        set((s) => ({
          resumableBatches: s.resumableBatches.filter(
            (b) => b.conversionId !== conversionId
          )
        }))
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Erreur inconnue'
        set({ error: message })
      }
    }
  }
})

export function selectGlobalProgress(s: ConversionState): number {
  const total = s.pendingFilePaths.length
  if (total === 0) return 0
  let done = 0
  for (const status of s.fileStatuses.values()) {
    if (status === 'done' || status === 'skipped') done += 1
  }
  return Math.round((done / total) * 100)
}

export function selectSummaryCounts(s: ConversionState): {
  done: number
  error: number
  skipped: number
  cancelled: number
} {
  let done = 0
  let error = 0
  let skipped = 0
  let cancelled = 0
  for (const status of s.fileStatuses.values()) {
    if (status === 'done') done += 1
    else if (status === 'error') error += 1
    else if (status === 'skipped') skipped += 1
    else if (status === 'cancelled') cancelled += 1
  }
  return { done, error, skipped, cancelled }
}
