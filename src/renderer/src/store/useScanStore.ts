import { create } from 'zustand'
import type { ScanEvent, ScannedFile } from '../../../shared/ipc-types'

/**
 * Scan lifecycle store.
 *
 * The renderer never imports node/electron directly (Plan 01-02 T-1-04 invariant
 * carried). All privileged calls route through `window.djUtils.scan`, exposed
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
  /** Private subscription handle — never read from components. */
  unsubscribe: (() => void) | null
  start: (folder: string) => Promise<void>
  cancel: () => Promise<void>
  reset: () => void
}

const INITIAL = {
  scanId: null,
  status: 'idle' as ScanStatus,
  rows: [] as ScannedFile[],
  totalFiles: null,
  durationMs: null,
  error: null,
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
      set({
        scanId: null,
        status: 'running',
        rows: [],
        totalFiles: null,
        durationMs: null,
        error: null,
        unsubscribe: null
      })

      const scanId = await window.djUtils.scan.start(folder)
      const off = window.djUtils.scan.onEvent((e) => handleEvent(e))
      set({ scanId, unsubscribe: off })
    },

    cancel: async (): Promise<void> => {
      const id = get().scanId
      if (id === null) return
      await window.djUtils.scan.cancel(id)
      // Status transition is driven by the 'cancelled' event, not here.
    },

    reset: (): void => {
      const off = get().unsubscribe
      if (off) off()
      set({ ...INITIAL })
    }
  }
})
