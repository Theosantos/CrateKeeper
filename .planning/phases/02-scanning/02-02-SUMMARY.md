---
phase: 02-scanning
plan: 02
subsystem: analyser-ui
tags: [renderer, zustand, react-virtual, tag-badges, scan-stream]
requires:
  - "Plan 02-01 typed window.djUtils.scan bridge (start/cancel/onEvent + ScanEvent union)"
  - "Plan 01-02 renderer foundation (useAppStore, three-tool nav, editorial dark-studio tokens)"
provides:
  - "useScanStore (Zustand) — scan lifecycle: idle | running | done | cancelled | error; append-per-batch on 'rows'"
  - "TagBadge — G/B/K filled-or-hollow pill + Erreur variant with hover-message"
  - "VirtualizedFileTable — @tanstack/react-virtual table; renders ScannedFile rows with cell formatting"
  - "ScanToolbar — Scanner / Stop + aria-live progress strip; gated on useAppStore.rootFolder"
  - "AnalyserView composes the slice end-to-end"
affects:
  - "Plan 02-03 will add CSV export wired into the same ScanToolbar / useScanStore surface"
  - "Phase 4 tagger will reuse the TagBadge + table pattern for the SCAN-03 unfilled-tag queue"
tech-stack:
  added:
    - "zustand subscriber pattern (single-setState-per-batch) extended to a second store"
  patterns:
    - "Composition root selects rows from store and passes them as a prop to the table (presentational/container split)"
    - "useVirtualizer mocked in jsdom tests; real virtualization validated at the human-verify checkpoint"
    - "main.css design tokens extended (badge palette + table surfaces) — never replaced"
key-files:
  created:
    - src/renderer/src/store/useScanStore.ts
    - src/renderer/src/store/useScanStore.test.ts
    - src/renderer/src/components/analyser/TagBadge.tsx
    - src/renderer/src/components/analyser/VirtualizedFileTable.tsx
    - src/renderer/src/components/analyser/VirtualizedFileTable.test.tsx
    - src/renderer/src/components/analyser/ScanToolbar.tsx
  modified:
    - src/renderer/src/views/AnalyserView.tsx
    - src/renderer/src/assets/main.css
decisions:
  - "Append per BATCH, not per file — useScanStore 'rows' handler does ONE set() per ScanEvent (Pitfall 5)"
  - "Foreign scanId guard — store drops late events whose scanId !== current scanId (defence-in-depth on top of single-active-scan)"
  - "cancel() does NOT mutate status directly — only the 'cancelled' event transitions it, keeping main as single source of truth"
  - "Table fixed-height via --table-height token (480px) so virtualization viewport is stable; no flex/grow layout"
  - "useVirtualizer mocked in unit tests (jsdom lacks ResizeObserver + layout); 5000-row DOM-count assertion still meaningful (< 200 nodes)"
  - "Tag badge palette: teal (G) / lime (B) / violet (K) / coral (Erreur) — disciplined chroma so they read as siblings to the sodium accent, not louder than it"
requirements: [SCAN-01, SCAN-02, SCAN-03, SCAN-05]
metrics:
  duration_minutes: 16
  completed: 2026-05-29
  tasks_completed: 3
  tasks_total: 4
  tests_added: 15
  tests_total: 70
---

# Phase 2 Plan 02: Analyser UI Summary

Renderer vertical slice for Phase 2 shipped: a `useScanStore` that subscribes to the typed `window.djUtils.scan.onEvent` push channel and accumulates rows once per batch, a `@tanstack/react-virtual` file table that holds 5000-row datasets to a bounded DOM, three-colour G/B/K tag badges + an Erreur variant for failed-parse rows, and a Scanner/Stop toolbar gated on the persisted root folder. The Analyser view now composes the full slice — Phase 2 ROADMAP success criteria 1, 2, 3 at the renderer layer.

Task 4 is a `checkpoint:human-verify` and remains pending — the human-in-the-loop must drive a real-folder scan and confirm the visual + behaviour invariants before the plan is closed.

## Commits

| Task | Hash      | Message                                                                    |
| ---- | --------- | -------------------------------------------------------------------------- |
| 1    | `11bafa9` | test(02-02): add failing useScanStore tests (RED)                          |
| 1    | `613282a` | feat(02-02): useScanStore — Zustand store driving scan lifecycle           |
| 2    | `e1ad7bb` | feat(02-02): Analyser view layer — toolbar + virtualized table + badges    |
| 3    | `d746fc0` | test(02-02): VirtualizedFileTable render tests                             |

## What's Built

### Task 1 — useScanStore (Zustand)

`src/renderer/src/store/useScanStore.ts` (121 LOC) exposes:

- State: `{ scanId, status, rows, totalFiles, durationMs, error }` + a private `unsubscribe` handle.
- `start(folder)`: detaches any prior subscription, optimistically resets to `running`, awaits `window.djUtils.scan.start(folder)`, then subscribes to `onEvent`.
- `cancel()`: calls `window.djUtils.scan.cancel(scanId)` — does NOT transition status; the worker-emitted `'cancelled'` event does that.
- `handleEvent(e)` (internal): foreign scanId guard → switch on `e.type` — `rows` appends in ONE setState, `done` / `cancelled` / `error` finalise status and unsubscribe.

**10/10 lifecycle tests** in `useScanStore.test.ts`: initial state, start/subscribe, rows append (single setState per batch counted via `store.subscribe`), done, cancelled, error, restart-while-running unsubscribes prior, foreign-scanId drop, cancel-does-not-transition.

### Task 2 — Analyser view layer

- **`TagBadge.tsx`** — `role="status" aria-label`-labelled pill. Filled when present, hollow outline when absent. Erreur variant always filled, `title=errorMessage` for hover.
- **`VirtualizedFileTable.tsx`** — `useVirtualizer({ count, getScrollElement: () => scrollRef.current, estimateSize: () => 36, overscan: 8 })`. Sticky header outside the scrollable virtual viewport. Cell formatters: basename + path tooltip, bitrate `kbps`, size `MB`, sampleRate `kHz`, duration `m:ss`. Failed-parse rows get `.row--errored` + an Erreur badge.
- **`ScanToolbar.tsx`** — Reads `rootFolder` from `useAppStore`. Scanner button disabled when no folder OR scan running. Stop button only when running. Live `<output aria-live="polite">` progress strip with per-status colour coding.
- **`AnalyserView.tsx`** — `<section aria-labelledby="view-analyser-heading">` composes the slice; selects `rows` from `useScanStore` and passes them down.
- **`main.css`** — Extends the Plan 01-02 dark-studio token set with `--color-badge-*` (teal/lime/violet/coral), `--color-table-row*`, `--table-height`. Animations limited to `opacity` / `transform` / `background` (compositor-friendly).

### Task 3 — VirtualizedFileTable render tests

5 behaviours: empty-state, 5000-row bounded DOM (`< 200` nodes), Erreur badge on parsedOk=false, partial G/B/K visibility via aria-label, null bitrate `—` + duration formatting.

`useVirtualizer` is mocked in jsdom — the real library hard-depends on `ResizeObserver` and DOM layout, neither of which jsdom provides. The mock returns a bounded 32-item window backed by the real `estimateSize`, which is enough to assert the cell-formatting + badge contracts. Real virtualization on a real scroll surface is the human checkpoint's job (Task 4).

### Task 4 — Checkpoint (pending)

`checkpoint:human-verify` blocking-gate awaits a real-folder scan to confirm: live row streaming, visible G/B/K badges + Erreur variant, nav remains responsive while scanning, Stop cancels cleanly, scroll stays smooth, no orphan worker process after quit/reopen.

## Verification

| Gate | Command | Result |
| ---- | ------- | ------ |
| Build | `npm run build` | ✅ exit 0 (typecheck:node + typecheck:web + electron-vite build) |
| Store tests | `npm run test -- --run src/renderer/src/store/useScanStore` | ✅ 10/10 |
| Table tests | `npm run test -- --run src/renderer/src/components/analyser/VirtualizedFileTable` | ✅ 5/5 |
| Full suite | `npm run test -- --run` | ✅ 70/70 across 10 files |
| T-1-04 invariant | `grep "window.djUtils" src/renderer/src/components/` | ✅ zero matches (only one prose comment hit, no code access) |
| @tanstack/react-virtual usage | `grep useVirtualizer src/renderer/src/components/` | ✅ matches in VirtualizedFileTable.tsx |
| ScanToolbar reads useAppStore (not djUtils directly) | manual read | ✅ confirmed in ScanToolbar.tsx |
| AnalyserView is `<section aria-labelledby>` | manual read | ✅ confirmed |
| Animation on layout-bound props (width/height/padding/etc.) | manual read | ✅ none — only opacity/transform/background |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] useVirtualizer needs ResizeObserver+layout that jsdom does not provide**

- **Found during:** Task 3
- **Issue:** Initial test attempt used the real `useVirtualizer` with shimmed `getBoundingClientRect` + a stub `ResizeObserver`, but the virtualizer still returned zero virtual items because its measurement loop did not converge synchronously in jsdom.
- **Fix:** Replaced the in-test shims with a `vi.mock('@tanstack/react-virtual')` that returns a bounded 32-item window backed by the real `estimateSize`. The mock is comment-documented as a jsdom workaround, and the real virtualization assertion is delegated to the human checkpoint (Task 4 already covers smooth scroll + nav responsiveness on a real library).
- **Files modified:** `src/renderer/src/components/analyser/VirtualizedFileTable.test.tsx`
- **Commit:** `d746fc0`
- **Plan-spec alignment:** The plan's Task 3 action block explicitly authorised this fallback: "Mock @tanstack/react-virtual's `useVirtualizer` ONLY if jsdom's lack of layout makes the test brittle". This is the authorised path, not an out-of-scope deviation.

No Rule 2/3/4 deviations. No auth gates. No CLAUDE.md-driven adjustments.

## Known Stubs

None. Every component is wired to its real data source (`useScanStore` → `window.djUtils.scan`), and the bridge itself was shipped end-to-end in Plan 02-01.

## Self-Check: PASSED

- ✅ FOUND: `src/renderer/src/store/useScanStore.ts`
- ✅ FOUND: `src/renderer/src/store/useScanStore.test.ts`
- ✅ FOUND: `src/renderer/src/components/analyser/TagBadge.tsx`
- ✅ FOUND: `src/renderer/src/components/analyser/VirtualizedFileTable.tsx`
- ✅ FOUND: `src/renderer/src/components/analyser/VirtualizedFileTable.test.tsx`
- ✅ FOUND: `src/renderer/src/components/analyser/ScanToolbar.tsx`
- ✅ FOUND (modified): `src/renderer/src/views/AnalyserView.tsx`
- ✅ FOUND (modified): `src/renderer/src/assets/main.css`
- ✅ FOUND commits: `11bafa9`, `613282a`, `e1ad7bb`, `d746fc0`
