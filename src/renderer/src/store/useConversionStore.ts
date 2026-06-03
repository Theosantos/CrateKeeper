import { create } from 'zustand'
import type {
  ConversionEvent,
  ConversionFileStatus,
  Preset
} from '../../../shared/ipc-types'

/**
 * Conversion lifecycle store. Mirrors useScanStore's shape:
 *  - all privileged calls go through `window.djUtils.conversion.*`
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

  seedFilePaths: (paths: string[]) => void
  setPreset: (preset: Preset) => void
  updateCustom: (partial: Partial<Preset>) => void
  startBatch: (rootFolder: string) => Promise<void>
  cancelBatch: () => Promise<void>
  subscribeEvents: () => () => void
  reset: () => void
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
  error: null as string | null
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
        const id = await window.djUtils.conversion.start({
          rootFolder,
          filePaths: [...get().pendingFilePaths],
          preset
        })
        set({ conversionId: id })
        // LOCKED persistence: remember the last preset used for next launch.
        await window.djUtils.setSetting('conversion.lastPreset', JSON.stringify(preset))
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
      await window.djUtils.conversion.cancel(id)
      // Status transition is driven by the 'cancelled' event from main —
      // not flipped here, to keep main as the single source of truth.
    },

    subscribeEvents: (): (() => void) => {
      return window.djUtils.conversion.onEvent((e) => handleEvent(e))
    },

    reset: (): void => {
      set({
        ...INITIAL,
        perFileProgress: new Map(),
        fileStatuses: new Map(),
        errors: [],
        pendingFilePaths: []
      })
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
