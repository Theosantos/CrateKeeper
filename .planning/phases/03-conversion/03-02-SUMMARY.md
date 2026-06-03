---
phase: 03-conversion
plan: 02
subsystem: renderer-ui
tags: [convertir, ui, zustand, react-virtual, ipc, settings]
requires:
  - 03-01 (conversion bridge + controller + worker)
  - 02-02 (VirtualizedFileTable + useScanStore base)
provides:
  - selectedFilePaths selection mechanic in Analyser (Set<string>, immutable mutations)
  - generic settings IPC channel (settings:get / settings:set, allowlisted key)
  - useConversionStore (status/progress/errors/preset persistence + onEvent subscription)
  - Convertir UI (PresetSelector + CustomPresetForm + ConversionProgress + ConvertirView)
affects:
  - Analyser view file table grid (8 columns now; leftmost is 32px select)
  - ScanToolbar (new primary "Convertir N fichiers" action)
  - useScanStore API surface (additive: toggleFile / toggleAll / clearSelection)
tech-stack:
  added: []
  patterns:
    - "Zustand store mirroring useScanStore shape (status + IPC subscription lifecycle)"
    - "@tanstack/react-virtual for per-file progress list (T-3-11 DoS mitigation)"
    - "Renderer-side mirror of D-CONV-FORMAT registry (presets.ts) to avoid pulling main imports"
    - "Allowlisted generic K/V settings bridge for typed string keys"
key-files:
  created:
    - src/renderer/src/store/useConversionStore.ts
    - src/renderer/src/store/useConversionStore.test.ts
    - src/renderer/src/components/convertir/ConvertirView.tsx
    - src/renderer/src/components/convertir/PresetSelector.tsx
    - src/renderer/src/components/convertir/CustomPresetForm.tsx
    - src/renderer/src/components/convertir/ConversionProgress.tsx
    - src/renderer/src/components/convertir/convertir.css
    - src/renderer/src/components/convertir/presets.ts
    - src/renderer/src/components/convertir/ConvertirView.test.tsx
    - src/renderer/src/components/analyser/ScanToolbar.test.tsx
  modified:
    - src/renderer/src/store/useScanStore.ts
    - src/renderer/src/store/useScanStore.test.ts
    - src/renderer/src/components/analyser/VirtualizedFileTable.tsx
    - src/renderer/src/components/analyser/VirtualizedFileTable.test.tsx
    - src/renderer/src/components/analyser/ScanToolbar.tsx
    - src/renderer/src/views/ConvertirView.tsx
    - src/renderer/src/assets/main.css
    - src/renderer/src/main.tsx
    - src/renderer/src/App.test.tsx
    - src/shared/ipc-types.ts
    - src/preload/index.ts
    - src/main/ipc/settings.ts
decisions:
  - "Routed conversion.lastPreset persistence through a NEW generic settings:get/set IPC channel rather than adding a one-off conversion:get-last-preset handler. The new channel is gated by SETTINGS_KEY_ALLOWLIST (currently only 'conversion.lastPreset') so it cannot become a general-purpose untrusted K/V dump from the renderer."
  - "Mirrored the PRESETS registry into a renderer-side module (components/convertir/presets.ts) instead of importing src/main/conversion/presets.ts. Keeps the main-renderer boundary clean; main re-validates every payload via assertPreset (Plan 03-01)."
  - "selectSummaryCounts / selectGlobalProgress are pure functions but the component computes them locally rather than passing them as Zustand selectors — useSyncExternalStore loops infinitely if the selector returns a new object identity each call."
metrics:
  duration_minutes: 22
  completed_at: 2026-06-03T22:21:55Z
  tasks_completed: 4
  files_created: 10
  files_modified: 12
---

# Phase 3 Plan 02: Convertir UI — Vertical Slice Summary

End-to-end Convertir UI on top of the Plan 03-01 backbone. The user can now pick files in Analyser, click `Convertir N fichiers`, choose a preset (or build a custom one), launch a batch, and watch live per-file + global progress with a French summary line at the end. Preset choice persists across app restarts.

## What Shipped

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | useScanStore selection (selectedFilePaths + toggle/toggleAll/clear) | `ee3c623` | `useScanStore.ts`, `useScanStore.test.ts` |
| 3 | useConversionStore + generic settings IPC bridge | `7cf5608` | `useConversionStore.ts(.test)`, `ipc-types.ts`, `preload/index.ts`, `main/ipc/settings.ts`, `App.test.tsx`, `useScanStore.test.ts` |
| 2 | Checkbox column in file table + Convertir N action in toolbar | `dc0453f` | `VirtualizedFileTable.tsx(.test)`, `ScanToolbar.tsx(.test)`, `main.css` |
| 4 | ConvertirView + PresetSelector + CustomPresetForm + ConversionProgress | `276384d` | `components/convertir/*` (6 files) + `views/ConvertirView.tsx`, `main.tsx` |

Tasks 3 and 2 were executed in swapped order because Task 2's `ScanToolbar` wiring needs `useConversionStore.seedFilePaths` from Task 3 to exist. The plan's task numbering is preserved in commit messages for traceability.

## Test Results

- `npm test`: **242 passed (21 files)** — 0 failures
- `npm run build`: green (tsc node + tsc web + electron-vite all three environments)
- `npm run typecheck`: green
- No new `--color-*` declarations in `convertir.css` — verified via `grep -E '^\s*--color-' convertir.css` returning empty
- All user-visible copy French — verified via inspection of the four .tsx files (English appears only in internal identifiers: CSS class names, status enum values, test descriptions)
- `@tanstack/react-virtual` confirmed used in `ConversionProgress.tsx` for the per-file row list (DoS mitigation T-3-11)

## Key Decisions

### Generic settings IPC bridge (added in this plan)
The LOCKED rule "selectedPreset persists to settings.conversion.lastPreset via existing settings repo" had no transport before this plan: only `settings:get-folder` / `settings:set-folder` existed. Rather than add a one-off `conversion:get-last-preset` channel, the plan added a typed generic K/V bridge:

- New IPC channels `settings:get` / `settings:set`
- New API methods `window.djUtils.getSetting(key)` / `setSetting(key, value)`
- Allowlist `SETTINGS_KEY_ALLOWLIST = ['conversion.lastPreset']` on the main side; any unknown key is rejected before touching the repo (T-1-02 mitigation)
- Value size capped at 8 KiB

Future plans can add new keys to the allowlist; the renderer surface is type-narrowed to those keys via `AllowedSettingKey`.

### PRESETS mirror in renderer
The renderer-side `components/convertir/presets.ts` re-declares the 5-preset locked registry verbatim. This keeps `src/main/conversion/presets.ts` from being imported by renderer code (clean main-renderer boundary; main can use Node APIs that the renderer cannot bundle). Drift risk is mitigated by the fact that the **renderer's preset object is sent over IPC unchanged**, and **main re-validates every payload** via the Phase 3 `assertPreset` allowlist. If the renderer mirror drifts, main will reject the payload — a loud, observable failure mode.

### Local selector computation in ConversionProgress
`selectSummaryCounts` returns a fresh `{done, error, skipped, cancelled}` object every call. Passing it as a Zustand selector via `useConversionStore(selectSummaryCounts)` triggers `useSyncExternalStore`'s "snapshot identity changed" detection on every render — infinite loop. The component instead subscribes to `s.fileStatuses` (a Map that only changes when the store mutates) and calls the pure helper inline. `selectGlobalProgress` returns a primitive `number` and is safe either way.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing Critical Functionality] Added generic settings IPC bridge**
- **Found during:** Task 3
- **Issue:** The plan's must_haves required persisting `selectedPreset` to `settings.conversion.lastPreset`, but no IPC channel existed for arbitrary settings keys — only the legacy `settings:get-folder` / `settings:set-folder` pair carried over from Phase 1.
- **Fix:** Added typed generic K/V channels `settings:get` and `settings:set` with a renderer-facing `getSetting(key)/setSetting(key, value)` surface. Main side gates on `SETTINGS_KEY_ALLOWLIST` (currently only `conversion.lastPreset`) and caps value size at 8 KiB. This is necessary critical functionality without which the LOCKED persistence rule could not be satisfied.
- **Files modified:** `src/shared/ipc-types.ts`, `src/preload/index.ts`, `src/main/ipc/settings.ts`, `src/renderer/src/App.test.tsx`, `src/renderer/src/store/useScanStore.test.ts` (mock surface)
- **Commit:** `7cf5608`

**2. [Process - Task ordering] Task 3 executed before Task 2**
- **Issue:** Task 2 wires `ScanToolbar`'s click handler to `useConversionStore.getState().seedFilePaths(paths)` — that store doesn't exist until Task 3. The plan acknowledged this ("Add `useConversionStore.seedFilePaths(paths)` action as a temporary forward-reference; Task 3 builds the store and includes this action") but executing Task 2 first would have required a stub-then-replace.
- **Fix:** Implemented Task 3 first, then Task 2. Both still committed atomically with task-numbered messages preserving plan traceability. SUMMARY tables list tasks in plan order; commit order in `git log` shows execution order.

**3. [Refactor — non-blocking] Local recomputation of selector helpers in `ConversionProgress`**
- **Issue:** Passing `selectSummaryCounts` directly as a Zustand selector (`useConversionStore(selectSummaryCounts)`) triggered a `useSyncExternalStore` infinite loop because the helper returns a new object every call. (Surfaced as "Maximum update depth exceeded" in the first test run; React also printed the warning "The result of getSnapshot should be cached to avoid an infinite loop.")
- **Fix:** Subscribe to the underlying `fileStatuses` Map and call the pure helpers inline. No behavioral change; same return values; just stable selector identity.
- **Commit:** `276384d`

### Plan-Checker Suggestion Handled Inline
The prompt context noted: "ensure `useConversionStore` setup doesn't bake stale assumptions about denominator. Document in SUMMARY that 03-03 will need to reset progress Maps on resume."

`selectGlobalProgress` reads its denominator from `pendingFilePaths.length`, NOT from a cached `totalCount`. When Plan 03-03 wires resume:

1. It must call `useConversionStore.getState().seedFilePaths([...stillPending])` with the **remaining** files (or with the full original list, depending on how resume is framed).
2. It MUST reset `perFileProgress` and `fileStatuses` to empty Maps before subscribing — otherwise stale done-status entries from a prior batch will inflate `selectGlobalProgress` numerator.
3. The `reset()` action in the store already does this: it returns the store to INITIAL with fresh Map instances. Resume should call `reset()` then `seedFilePaths(...)` then `subscribeEvents()`, in that order, before invoking `djUtils.conversion.resume(conversionId)`.

## Known Stubs

None. Every component is wired to live data sources.

## Threat Flags

None. The plan's `<threat_model>` covered the renderer surface; the new settings IPC channel is allowlisted and bounded (defence in depth on T-1-02 / T-3-10).

The new `settings:get` / `settings:set` channels did add IPC surface NOT enumerated in the plan's threat model — but the mitigation (allowlist + size cap) was applied at implementation time. Flag for the verifier: confirm the allowlist is enforced and that `MAX_SETTING_VALUE_BYTES` cap is reasonable for the renderer's serialised Preset (the largest preset JSON is ~200 bytes, so 8 KiB is generous and future-safe).

## Self-Check: PASSED

Files created — verified present:
- `src/renderer/src/store/useConversionStore.ts` ✓
- `src/renderer/src/store/useConversionStore.test.ts` ✓
- `src/renderer/src/components/convertir/ConvertirView.tsx` ✓
- `src/renderer/src/components/convertir/PresetSelector.tsx` ✓
- `src/renderer/src/components/convertir/CustomPresetForm.tsx` ✓
- `src/renderer/src/components/convertir/ConversionProgress.tsx` ✓
- `src/renderer/src/components/convertir/convertir.css` ✓
- `src/renderer/src/components/convertir/presets.ts` ✓
- `src/renderer/src/components/convertir/ConvertirView.test.tsx` ✓
- `src/renderer/src/components/analyser/ScanToolbar.test.tsx` ✓

Commits — verified in `git log`:
- `ee3c623` ✓ Task 1
- `7cf5608` ✓ Task 3
- `dc0453f` ✓ Task 2
- `276384d` ✓ Task 4

Test gate: `npm test` → 242/242 passed.
Build gate: `npm run build` → green.
Typecheck: `npm run typecheck` → green.
French-copy gate: only internal identifiers contain English; all user-visible strings French.
Token gate: `convertir.css` declares zero new `--color-*` custom properties.
DoS gate: `@tanstack/react-virtual` wired in `ConversionProgress.tsx`.
