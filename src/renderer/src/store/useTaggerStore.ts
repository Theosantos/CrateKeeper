import { create } from 'zustand'
import type {
  ApplyResult,
  GenrePresetsResult,
  PendingTagEdit,
  SaveTagEditInput,
  ScannedFile
} from '../../../shared/ipc-types'

/**
 * Tagger lifecycle store. Mirrors useConversionStore's immutability discipline:
 *  - all privileged calls go through `window.crateKeeper.tagger.*` (Plan 04-01)
 *  - every Map / array mutation produces a NEW instance
 *  - dirtyEdits override pendingEdits when displaying / persisting
 *
 * Plan 04-02 covers: queue + dirty edits + presets + mute + Keep/Skip flow.
 * Plan 04-03 layers: 1-level Undo state machine (lastAction) + scanId tracking.
 * Session resume + debounced persistence lives in TaggerView (Plan 04-03 Task 2).
 */

export type TaggerStatus = 'loading' | 'ready' | 'empty'

export interface DirtyEdit {
  genre: string | null
  bpm: number | null
  key: string | null
  artist: string | null
  title: string | null
  comment: string | null
  rating: number | null
}

const EMPTY_DIRTY: DirtyEdit = {
  genre: null,
  bpm: null,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null
}

export interface KeepResult {
  filePath: string
  edit: SaveTagEditInput
  prior: PendingTagEdit | null
}

/**
 * One-level undo descriptor. LOCKED (04-CONTEXT.md):
 *  - type='keep' restores the prior pending row (or deletes if there was none)
 *  - type='skip' rewinds currentIndex by 1
 *  - cleared in the SAME set() that consumes it — no double-undo possible
 */
export interface LastAction {
  type: 'keep' | 'skip'
  filePath: string
  prior?: PendingTagEdit | null
  savedEdit?: SaveTagEditInput
}

export interface TaggerState {
  status: TaggerStatus
  queue: ScannedFile[]
  scanId: string | null
  currentIndex: number
  dirtyEdits: Map<string, DirtyEdit>
  pendingEdits: Map<string, PendingTagEdit>
  genrePresets: string[]
  genrePresetsSource: 'library' | 'defaults' | 'mixed' | null
  muteEnabled: boolean
  error: string | null
  lastAction: LastAction | null
  // Phase 5 — apply write state (Plan 05-03)
  isApplying: boolean
  applyResult: ApplyResult | null
  applyError: string | null
  writeResults: Map<string, { ok: boolean; error?: string }>
  pendingWriteCount: number

  loadQueue: () => Promise<void>
  loadGenrePresets: () => Promise<void>
  loadMuteSetting: () => Promise<void>
  loadPendingWriteCount: () => Promise<void>
  setDirtyEdit: <K extends keyof DirtyEdit>(field: K, value: DirtyEdit[K]) => void
  applyPreset: (slot: number) => void
  applySplit: (input: { artist: string; title: string }) => void
  setRating: (rating: number | null) => void
  setMute: (enabled: boolean) => Promise<void>
  toggleMute: () => Promise<void>
  keep: () => Promise<KeepResult | null>
  skip: () => { filePath: string } | null
  undo: () => Promise<void>
  applyWrites: () => Promise<void>
  reset: () => void
}

const INITIAL = {
  status: 'loading' as TaggerStatus,
  queue: [] as ScannedFile[],
  scanId: null as string | null,
  currentIndex: 0,
  dirtyEdits: new Map<string, DirtyEdit>(),
  pendingEdits: new Map<string, PendingTagEdit>(),
  genrePresets: [] as string[],
  genrePresetsSource: null as 'library' | 'defaults' | 'mixed' | null,
  muteEnabled: false,
  error: null as string | null,
  lastAction: null as LastAction | null,
  // Phase 5 apply state
  isApplying: false,
  applyResult: null as ApplyResult | null,
  applyError: null as string | null,
  writeResults: new Map<string, { ok: boolean; error?: string }>(),
  pendingWriteCount: 0
}

export const useTaggerStore = create<TaggerState>((set, get) => ({
  ...INITIAL,

  async loadQueue(): Promise<void> {
    set({ status: 'loading' })
    const r = await window.crateKeeper.tagger.loadQueue()
    const pending = new Map<string, PendingTagEdit>(
      Object.entries(r.pendingEdits ?? {})
    )
    set({
      queue: r.files,
      scanId: r.scanId,
      pendingEdits: pending,
      currentIndex: 0,
      status: r.files.length === 0 ? 'empty' : 'ready'
    })
  },

  async loadGenrePresets(): Promise<void> {
    const r: GenrePresetsResult = await window.crateKeeper.tagger.getGenrePresets()
    set({ genrePresets: r.presets, genrePresetsSource: r.source })
  },

  async loadMuteSetting(): Promise<void> {
    // The mute toggle was removed from the UI in favour of a Play/Pause
    // control, but the persisted `tagger.muteEnabled=true` from older
    // sessions would otherwise keep the audio silenced with no way to
    // unmute. Force the in-memory flag to false on load so the audio
    // always starts unmuted. We do not write back — the legacy setting
    // simply becomes a no-op.
    set({ muteEnabled: false })
  },

  async loadPendingWriteCount(): Promise<void> {
    // D-03: re-edit-aware count from the main process (not a derivation
    // from the in-memory pendingEdits map). Drives the Appliquer (N) badge.
    const n = await window.crateKeeper.tagger.getPendingCount()
    set({ pendingWriteCount: n })
  },

  async applyWrites(): Promise<void> {
    // Mirror useConversionStore.startBatch ordering: subscribe BEFORE invoke
    // so no fileDone events are missed. T-05-LEAK: unsub called on both
    // done and error paths.
    if (get().isApplying) return

    const unsub = window.crateKeeper.tagger.onWriteEvent((e) => {
      if (e.type === 'fileDone') {
        set((s) => {
          const next = new Map(s.writeResults)
          next.set(
            e.filePath,
            e.ok ? { ok: true } : { ok: false, error: e.error }
          )
          return { writeResults: next }
        })
        return
      }
      if (e.type === 'done') {
        set({
          isApplying: false,
          applyResult: { totalWritten: e.totalWritten, totalFailed: e.totalFailed }
        })
        // Refresh the badge: files that failed stay counted (D-05 retryable).
        void get().loadPendingWriteCount()
        unsub()
      }
    })

    set({ isApplying: true, applyError: null, applyResult: null, writeResults: new Map() })

    try {
      await window.crateKeeper.tagger.applyWrites()
    } catch (err) {
      unsub()
      const message = err instanceof Error ? err.message : 'Erreur inconnue'
      set({ isApplying: false, applyError: message })
    }
  },

  setDirtyEdit(field, value): void {
    const { queue, currentIndex, dirtyEdits } = get()
    const file = queue[currentIndex]
    if (file === undefined) return
    const next = new Map(dirtyEdits)
    const prior = next.get(file.path) ?? { ...EMPTY_DIRTY }
    // Empty strings clear the field (null = no override)
    const normalised =
      typeof value === 'string' && value === '' ? null : value
    next.set(file.path, { ...prior, [field]: normalised } as DirtyEdit)
    set({ dirtyEdits: next })
  },

  applyPreset(slot): void {
    if (slot < 1 || slot > 9) return
    const { genrePresets } = get()
    const g = genrePresets[slot - 1]
    if (typeof g !== 'string') return
    get().setDirtyEdit('genre', g)
  },

  applySplit({ artist, title }): void {
    const { queue, currentIndex, dirtyEdits } = get()
    const file = queue[currentIndex]
    if (file === undefined) return
    const next = new Map(dirtyEdits)
    const prior = next.get(file.path) ?? { ...EMPTY_DIRTY }
    next.set(file.path, { ...prior, artist, title })
    set({ dirtyEdits: next })
  },

  setRating(rating): void {
    const { queue, currentIndex, dirtyEdits, pendingEdits } = get()
    const file = queue[currentIndex]
    if (file === undefined) return
    const current =
      dirtyEdits.get(file.path)?.rating ??
      pendingEdits.get(file.path)?.rating ??
      null
    // Toggle: clicking the same rating clears it.
    const nextRating = rating !== null && current === rating ? null : rating
    get().setDirtyEdit('rating', nextRating)
  },

  async setMute(enabled): Promise<void> {
    set({ muteEnabled: enabled })
    await window.crateKeeper.setSetting(
      'tagger.muteEnabled',
      enabled ? 'true' : 'false'
    )
  },

  async toggleMute(): Promise<void> {
    await get().setMute(!get().muteEnabled)
  },

  async keep(): Promise<KeepResult | null> {
    const { queue, currentIndex, dirtyEdits, pendingEdits } = get()
    const file = queue[currentIndex]
    if (file === undefined) return null
    const dirty = dirtyEdits.get(file.path) ?? { ...EMPTY_DIRTY }
    const prior = pendingEdits.get(file.path) ?? null
    const merged: SaveTagEditInput = {
      filePath: file.path,
      genre: dirty.genre ?? prior?.genre ?? null,
      bpm: dirty.bpm ?? prior?.bpm ?? null,
      key: dirty.key ?? prior?.key ?? null,
      artist: dirty.artist ?? prior?.artist ?? null,
      title: dirty.title ?? prior?.title ?? null,
      comment: dirty.comment ?? prior?.comment ?? null,
      rating: dirty.rating ?? prior?.rating ?? null
    }
    await window.crateKeeper.tagger.saveEdit(merged)

    const nextPending = new Map(pendingEdits)
    const now = Date.now()
    nextPending.set(file.path, {
      filePath: file.path,
      genre: merged.genre ?? null,
      bpm: merged.bpm ?? null,
      key: merged.key ?? null,
      artist: merged.artist ?? null,
      title: merged.title ?? null,
      comment: merged.comment ?? null,
      rating: merged.rating ?? null,
      updatedAt: now,
      appliedAt: prior?.appliedAt ?? null
    })
    const nextDirty = new Map(dirtyEdits)
    nextDirty.delete(file.path)
    set({
      pendingEdits: nextPending,
      dirtyEdits: nextDirty,
      currentIndex: currentIndex + 1,
      lastAction: {
        type: 'keep',
        filePath: file.path,
        prior,
        savedEdit: merged
      }
    })
    return { filePath: file.path, edit: merged, prior }
  },

  skip(): { filePath: string } | null {
    const { queue, currentIndex, dirtyEdits } = get()
    const file = queue[currentIndex]
    if (file === undefined) return null
    const nextDirty = new Map(dirtyEdits)
    nextDirty.delete(file.path)
    set({
      dirtyEdits: nextDirty,
      currentIndex: currentIndex + 1,
      lastAction: { type: 'skip', filePath: file.path }
    })
    return { filePath: file.path }
  },

  async undo(): Promise<void> {
    const { lastAction, pendingEdits, currentIndex } = get()
    if (lastAction === null) return
    if (lastAction.type === 'skip') {
      set({
        currentIndex: Math.max(0, currentIndex - 1),
        lastAction: null
      })
      return
    }
    // type === 'keep'
    const filePath = lastAction.filePath
    const prior = lastAction.prior ?? null
    if (prior === null) {
      // Undoing a Keep where there was no prior pending row → delete.
      await window.crateKeeper.tagger.deleteEdit(filePath)
      const nextPending = new Map(pendingEdits)
      nextPending.delete(filePath)
      set({
        pendingEdits: nextPending,
        currentIndex: Math.max(0, currentIndex - 1),
        lastAction: null
      })
      return
    }
    // Restore prior.
    await window.crateKeeper.tagger.saveEdit({
      filePath,
      genre: prior.genre,
      bpm: prior.bpm,
      key: prior.key,
      artist: prior.artist,
      title: prior.title,
      comment: prior.comment,
      rating: prior.rating
    })
    const nextPending = new Map(pendingEdits)
    nextPending.set(filePath, prior)
    set({
      pendingEdits: nextPending,
      currentIndex: Math.max(0, currentIndex - 1),
      lastAction: null
    })
  },

  reset(): void {
    set({
      ...INITIAL,
      dirtyEdits: new Map(),
      pendingEdits: new Map(),
      writeResults: new Map(),
      queue: [],
      genrePresets: [],
      lastAction: null
    })
  }
}))

export const selectCurrentFile = (s: TaggerState): ScannedFile | null =>
  s.queue[s.currentIndex] ?? null
