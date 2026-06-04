import { create } from 'zustand'
import type { ScanEvent, ScannedFile } from '../../../shared/ipc-types'

/**
 * Scan lifecycle store.
 *
 * The renderer never imports node/electron directly (Plan 01-02 T-1-04 invariant
 * carried). All privileged calls route through `window.crateKeeper.scan`, exposed
 * by the preload contextBridge in Plan 02-01.
 *
 * Anti-pattern guards (RESEARCH 02 Pitfall 5 / Anti-Patterns):
 *  - The 'rows' handler does a SINGLE `set` per batch event. Main batches at
 *    the source; renderer appends once, never per-file.
 *  - Foreign scanId events (late deliveries from a cancelled scan) are dropped
 *    in `handleEvent` — defence in depth on top of the main-side controller.
 *  - cancel() does not transition status directly; only the 'cancelled' event
 *    from the worker drives it, keeping main as the single source of truth.
 */

export type ScanStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'

type ScanState = {
  scanId: string | null
  status: ScanStatus
  rows: ScannedFile[]
  totalFiles: number | null
  durationMs: number | null
  error: string | null
  /** True while a CSV export is in flight; guards re-entry (defence in depth). */
  exporting: boolean
  /** Last successfully-exported CSV path (renderer shows it as a toast). */
  lastExportPath: string | null
  /**
   * Plan 03-02: per-row selection bound to the conversion handoff.
   * Persists across view switches; resets on every new scan (LOCKED).
   * Always replaced with a NEW Set instance on mutation (TS immutability).
   */
  selectedFilePaths: Set<string>
  /** Private subscription handle — never read from components. */
  unsubscribe: (() => void) | null
  start: (folder: string) => Promise<void>
  cancel: () => Promise<void>
  exportCsv: () => Promise<string | null>
  toggleFile: (filePath: string) => void
  toggleAll: (filePaths: string[]) => void
  clearSelection: () => void
  reset: () => void
}

const INITIAL = {
  scanId: null,
  status: 'idle' as ScanStatus,
  rows: [] as ScannedFile[],
  totalFiles: null,
  durationMs: null,
  error: null,
  exporting: false,
  lastExportPath: null as string | null,
  selectedFilePaths: new Set<string>(),
  unsubscribe: null as (() => void) | null
}

export const useScanStore = create<ScanState>((set, get) => {
  function handleEvent(e: ScanEvent): void {
    // Foreign scanId guard — drop late events from a previous scan.
    if (e.scanId !== get().scanId) return

    switch (e.type) {
      case 'rows':
        // Single setState per batch. Pitfall 5 mitigation.
        set((s) => ({ rows: [...s.rows, ...e.rows] }))
        return
      case 'done': {
        const off = get().unsubscribe
        if (off) off()
        set({
          status: 'done',
          totalFiles: e.totalFiles,
          durationMs: e.durationMs,
          unsubscribe: null
        })
        return
      }
      case 'cancelled': {
        const off = get().unsubscribe
        if (off) off()
        set({ status: 'cancelled', unsubscribe: null })
        return
      }
      case 'error': {
        const off = get().unsubscribe
        if (off) off()
        set({ status: 'error', error: e.message, unsubscribe: null })
        return
      }
    }
  }

  return {
    ...INITIAL,

    start: async (folder: string): Promise<void> => {
      // Defence in depth: if a prior scan is somehow still subscribed,
      // detach it before starting a new one. The main-side controller also
      // enforces single-active-scan.
      const prior = get().unsubscribe
      if (prior) prior()

      // Optimistically reset state — actual scanId arrives below.
      // selectedFilePaths is also cleared: starting a new scan resets the
      // user's selection (Plan 03-02 LOCKED semantics).
      set({
        scanId: null,
        status: 'running',
        rows: [],
        totalFiles: null,
        durationMs: null,
        error: null,
        selectedFilePaths: new Set<string>(),
        unsubscribe: null
      })

      const scanId = await window.crateKeeper.scan.start(folder)
      const off = window.crateKeeper.scan.onEvent((e) => handleEvent(e))
      set({ scanId, unsubscribe: off })
    },

    cancel: async (): Promise<void> => {
      const id = get().scanId
      if (id === null) return
      await window.crateKeeper.scan.cancel(id)
      // Status transition is driven by the 'cancelled' event, not here.
    },

    exportCsv: async (): Promise<string | null> => {
      // Defence in depth: the button is also disabled, but the store guards too.
      const s = get()
      if (s.scanId === null || s.status !== 'done' || s.exporting) {
        return null
      }
      set({ exporting: true })
      try {
        const exportedPath = await window.crateKeeper.scan.exportCsv(s.scanId)
        if (exportedPath !== null) {
          set({ lastExportPath: exportedPath })
        }
        return exportedPath
      } finally {
        set({ exporting: false })
      }
    },

    toggleFile: (filePath: string): void => {
      set((s) => {
        const next = new Set(s.selectedFilePaths)
        if (next.has(filePath)) {
          next.delete(filePath)
        } else {
          next.add(filePath)
        }
        return { selectedFilePaths: next }
      })
    },

    toggleAll: (filePaths: string[]): void => {
      set((s) => {
        const allSelected =
          filePaths.length > 0 && filePaths.every((p) => s.selectedFilePaths.has(p))
        const next = new Set(s.selectedFilePaths)
        if (allSelected) {
          for (const p of filePaths) next.delete(p)
        } else {
          for (const p of filePaths) next.add(p)
        }
        return { selectedFilePaths: next }
      })
    },

    clearSelection: (): void => {
      set({ selectedFilePaths: new Set<string>() })
    },

    reset: (): void => {
      const off = get().unsubscribe
      if (off) off()
      set({ ...INITIAL, selectedFilePaths: new Set<string>() })
    }
  }
})
