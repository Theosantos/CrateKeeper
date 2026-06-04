---
phase: 03-conversion
plan: 03
subsystem: conversion-resume
tags: [conv-05, resume, heartbeat, pitfall-9, ipc, ui]
requires: [03-01, 03-02]
provides:
  - controller.resume (real implementation, not stub)
  - controller.markStaleAsCrashed (boot-sweep wrapper)
  - repo.updateConversionStatus (resurrect 'crashed' → 'running')
  - IpcChannels.ConversionDiscard channel + handler
  - conversion:list-resumable + conversion:resume real handlers
  - useConversionStore: resumableBatches / checkResumable / resumeBatch / discardBatch
  - ResumeBanner component (above PresetSelector)
affects:
  - src/main/index.ts boot-order invariant (markStaleAsCrashed BEFORE createWindow)
tech-stack:
  added: []
  patterns:
    - boot-time stale-heartbeat sweep (Pitfall 9)
    - reset → seed → subscribe → resume order for clean Map state
    - source-line-order architectural smoke test
key-files:
  created:
    - src/renderer/src/components/convertir/ResumeBanner.tsx
    - .planning/phases/03-conversion/03-03-SUMMARY.md
  modified:
    - src/shared/ipc-types.ts
    - src/preload/index.ts
    - src/main/conversion/controller.ts
    - src/main/conversion/controller.test.ts
    - src/main/conversion/conversionRepo.ts
    - src/main/conversion/conversionRepo.test.ts
    - src/main/ipc/conversion.ts
    - src/main/ipc/conversion.test.ts
    - src/main/index.ts
    - src/renderer/src/store/useConversionStore.ts
    - src/renderer/src/store/useConversionStore.test.ts
    - src/renderer/src/components/convertir/ConvertirView.tsx
    - src/renderer/src/components/convertir/ConvertirView.test.tsx
    - src/renderer/src/components/convertir/convertir.css
    - src/renderer/src/App.test.tsx
    - src/renderer/src/components/analyser/ScanToolbar.test.tsx
decisions:
  - "Renderer does NOT receive the resumable file list — ResumableBatch exposes pendingCount only. Per-file rows appear via fileDone events as the worker processes them. Avoids leaking absolute paths through one extra IPC and keeps the surface minimal."
  - "resumeBatch order locked as reset() → restore resumableBatches (minus current) + selectedPreset → subscribeEvents() → conversion.resume(id). subscribeEvents wired BEFORE the IPC call so the first 'progress' event is captured. On rejection the batch is re-inserted into resumableBatches so the user can retry."
  - "Boot-sweep guarded by a source-line-order smoke test (reads src/main/index.ts and asserts markStaleAsCrashed line precedes the `mainWindow = createWindow()` line). Regex matches the call site, not the function declaration."
  - "Empty-pending defensive path on resume: if every file is already terminal, flip status='done' and emit a 'done' event without spawning a worker. Covers the race where a batch crashed after every file finished but before the row was marked done."
metrics:
  duration: ~25min
  completed: 2026-06-04
---

# Phase 03 Plan 03: Resume-After-Interruption Summary

CONV-05 closed end-to-end: boot-time heartbeat-stale sweep (Pitfall 9 mitigation) flips orphan 'running' rows to 'crashed' BEFORE the renderer is created, list-resumable / resume / discard IPC handlers replace the Plan 03-01 stubs, and a ResumeBanner above the Convertir PresetSelector lets the user resume (re-uses the original preset, re-queues non-terminal files only) or discard (CASCADE drops the row).

## What was built

### Task 1 — Controller surface (commit `087157f`)
- `ConversionController.resume(id)` real implementation: single-active guard → `repo.getConversion(id)` → reject if status !== 'crashed' → `repo.getResumablePending(id)` → if empty, defensive `complete({status:'done'})` + emit `done` and return → else `updateConversionStatus(id, 'running')` + `bumpHeartbeat` BEFORE spawning the worker (so the next sweep doesn't immediately re-crash us) → spawn worker with the row's preset + outputDir → start heartbeat timer → `attachWorker` for event forwarding.
- `ConversionController.markStaleAsCrashed({thresholdMs, now})`: pure delegation to `repo.markStaleAsCrashed`. Does NOT spawn workers, does NOT touch `activeConversion`. Exists on the controller so main has a single API surface and so the wrapper can grow telemetry later.
- `ConversionRepo.updateConversionStatus(id, status)`: new method, prepared statement `UPDATE conversions SET status = ? WHERE id = ?`. Distinct from `complete` because resume must preserve `ended_at` while flipping status back to 'running'.
- `IpcChannels.ConversionDiscard` + `DjUtilsConversionApi.discard` + preload bridge wrapped — the 'Ignorer (supprimer)' path.
- Controller tests (7 new) cover: original-preset re-use, single-active rejection, missing-row / cancelled / done rejection, empty-pending defensive completion, markStaleAsCrashed delegation + non-spawn invariant, post-resume active state. Repo tests (3 new): cancelled and done excluded from findResumable; updateConversionStatus preserves ended_at.

### Task 2 — IPC handlers + boot sweep (commit `ce74534`)
- `conversionListResumableHandler({repo})` returns `repo.findResumable()` (replaces Plan 03-01 stub).
- `conversionResumeHandler({controller}, id)`: V5 string validation; maps `BatchAlreadyActive` → 'Une conversion est déjà en cours' and 'Batch not resumable' → 'Cette conversion ne peut pas être reprise'.
- `conversionDiscardHandler({repo}, id)`: V5 string validation; delegates to `repo.deleteConversion` (CASCADE drops conversion_files).
- `registerConversionHandlers` now registers 5 channels (was 4) and requires a `repo` dep.
- `src/main/index.ts` boot order: openDb → init repos → construct `conversionController` → **`controller.markStaleAsCrashed({thresholdMs: 30_000, now: Date.now()})`** → register handlers → **`mainWindow = createWindow()`**. The sweep call appears on a source line BEFORE the createWindow call line — asserted by an architectural smoke test that reads the file and matches `=\s*createWindow\s*\(\s*\)` (call site, not function declaration).
- IPC tests: 7 new behaviors (list-resumable pass-through, resume V5 + error mappings, discard V5 + delegation, 5-channel registration, source-line-order assertion). All Plan 03-01 V5 + allowlist tests still green.

### Task 3 — Store + ResumeBanner UI (commit `f370797`)
- `useConversionStore` additive surface (Plan 03-02 behaviors unchanged):
  - `resumableBatches: ResumableBatch[]` (initial `[]`)
  - `checkResumable()`: one-shot fetch; idempotent (replaces, never appends); on rejection clears array + sets `error`, never throws.
  - `resumeBatch(id)`: locked sequence `reset() → restore resumableBatches minus current + selectedPreset → subscribeEvents() → conversion.resume(id) → set status='running' + conversionId`. On rejection the batch is re-inserted into `resumableBatches` so the user can retry; `state.error` carries the message.
  - `discardBatch(id)`: calls `conversion.discard(id)` and filters the batch out of `resumableBatches`.
- `ResumeBanner` (`src/renderer/src/components/convertir/ResumeBanner.tsx`): `role="region" aria-label="Conversion à reprendre"`; renders null when empty; one row per batch with French copy `Reprendre la conversion de N fichier(s) ?` + preset label + Reprendre / Ignorer (supprimer) buttons.
- `ConvertirView`: `useEffect(() => { void checkResumable() }, [])` — LOCKED Pitfall 9 one-shot, not polling; `<ResumeBanner />` rendered as the first child of `.convertir__body` (above PresetSelector).
- `convertir.css`: `.resume-banner` + `.resume-banner__*` classes using existing `--color-accent`, `--color-surface-overlay`, `--color-badge-error`, `--space-*`, `--radius-*` tokens. No new `--color-*` tokens defined (grep gate passes).
- Store tests: 9 new behaviors. Component tests: 6 new (one-shot mount check, empty-state null render, banner-above-PresetSelector DOM order, Reprendre wiring + banner clearance, Ignorer wiring + banner clearance, singular `1 fichier` copy).

## Architectural invariants (asserted by tests)

1. **Pitfall 9 — boot sweep ordering.** Source-line-order smoke test in `src/main/ipc/conversion.test.ts` reads `src/main/index.ts` and asserts the line containing `markStaleAsCrashed` appears before the line containing `= createWindow()`. The regex matches the call site, not the declaration — `lines.findIndex(l => /=\s*createWindow\s*\(\s*\)/.test(l))`.
2. **LOCKED: cancelled batches NOT resumable.** Repo SQL `WHERE c.status = 'crashed'` excludes them at the source. Controller-side guard also rejects via `row.status !== 'crashed'` → 'Batch not resumable'. Two layers of defence.
3. **LOCKED: single-active applies to resume.** `controller.resume` checks `if (active !== null) throw new BatchAlreadyActive()` BEFORE any DB writes. Test asserts no `updateConversionStatus` call after the throw.
4. **LOCKED: resume re-uses original preset.** Controller reads `repo.getConversion(id).preset`; store action restores `selectedPreset = batch.preset` so the UI reflects it. User does NOT re-pick.
5. **One-shot mount check.** ConvertirView `useEffect` with `[]` deps calls `checkResumable` exactly once. Test re-renders the component three times and asserts the IPC was called exactly once.
6. **Subscribe-before-resume.** Store test verifies `onEvent` `invocationCallOrder` < `resume` `invocationCallOrder` — the event stream is wired before the worker can emit progress.

## Test results

```
src/main/conversion/controller        — 28 passed
src/main/conversion/conversionRepo    — 30 passed
src/main/ipc/conversion               — 25 passed
src/renderer/src/store/useConversionStore — 29 passed
src/renderer/src/components/convertir/ConvertirView — 17 passed
Total suite                            — 275 passed (21 files)
```

`npm run build` green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Bug] resumeBatch incorrectly wiped resumableBatches via reset()**

- **Found during:** Task 3 implementation
- **Issue:** First-pass `resumeBatch` did `reset()` followed by `set({...resumableBatches: s.resumableBatches.filter(...)})`. But `reset()` already cleared `resumableBatches` to `[]`, so the filter ran on an empty array — sibling crashed batches (not the one being resumed) vanished from the banner.
- **Fix:** Snapshot `resumableBatches` BEFORE `reset()`, then restore the filtered list (minus the current id) immediately after. On rejection the batch is re-inserted so the user can retry.
- **Files modified:** `src/renderer/src/store/useConversionStore.ts`
- **Commit:** `f370797`

**2. [Rule 3 — Blocking] Pre-existing test mocks broke after adding `discard` to DjUtilsConversionApi**

- **Found during:** Task 2 `npm run build`
- **Issue:** `discard` is required by the interface; three pre-existing test files mocked `window.djUtils.conversion` and were missing the new property → TS2741 errors blocking the build.
- **Fix:** Added `discard: vi.fn().mockResolvedValue(undefined)` to the three test mocks (`App.test.tsx`, `ConvertirView.test.tsx`, `ScanToolbar.test.tsx`).
- **Files modified:** `src/renderer/src/App.test.tsx`, `src/renderer/src/components/analyser/ScanToolbar.test.tsx` (Plan 03-02 also touched here).
- **Commit:** `ce74534`

**3. [Rule 3 — Blocking] Architectural smoke test matched function declaration instead of call site**

- **Found during:** Task 2 test run
- **Issue:** Original regex `/createWindow\s*\(\s*\)/` matched the `function createWindow()` declaration at line 22, making the sweep call (line 120) "after" the declaration and failing the assertion.
- **Fix:** Tightened regex to `/=\s*createWindow\s*\(\s*\)/` so it only matches `mainWindow = createWindow()` at the call site.
- **Files modified:** `src/main/ipc/conversion.test.ts`
- **Commit:** `ce74534`

### Planner-flagged additions

- `repo.updateConversionStatus` was added in this plan (plan permitted it as additive). Repo test added — asserts `ended_at` is preserved when flipping status (the differentiator vs `complete`).

## Authentication gates

None — purely local IPC.

## Threat Flags

None new. T-3-13 (resume with arbitrary id) and T-3-14 (discard with arbitrary id) are mitigated by V5 string validation + DB-side `WHERE status = 'crashed'` guard, matching the threat register in the plan.

## Known Stubs

None. The Plan 03-01 stubs (`conversionListResumableHandler` returning `[]`, `conversionResumeHandler` throwing 'not implemented') are now fully implemented.

## Self-Check: PASSED

Created files:
- `src/renderer/src/components/convertir/ResumeBanner.tsx` — FOUND
- `.planning/phases/03-conversion/03-03-SUMMARY.md` — FOUND (this file)

Commits:
- `087157f` — FOUND
- `ce74534` — FOUND
- `f370797` — FOUND

Tests:
- `npm run test -- --run` → 275 passed (21 files)
- `npm run build` → green

Source-line-order invariant verified by `src/main/ipc/conversion.test.ts:351`.
