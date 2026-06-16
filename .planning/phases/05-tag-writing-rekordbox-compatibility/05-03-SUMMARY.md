---
phase: 05-tag-writing-rekordbox-compatibility
plan: 03
subsystem: tagger/apply-banner + renderer-store
tags: [applyWrites, pendingWriteCount, ApplyBanner, tdd, per-file-feedback, zustand]
dependency_graph:
  requires:
    - 05-02 (preload bridge: applyWrites / getPendingCount / onWriteEvent + TagWriteEvent + ApplyResult)
    - 04-02 (useTaggerStore base + TaggerView shell)
    - 04-01 (pending_tag_edits schema)
  provides:
    - useTaggerStore.applyWrites action (subscribe-before-invoke, immutable Map updates)
    - useTaggerStore.loadPendingWriteCount action (D-03 re-edit-aware count)
    - ApplyBanner.tsx (Appliquer (N) CTA + per-file Écrit/Erreur feedback + summary)
    - tagger.css .apply-banner styles (existing :root tokens only)
    - TaggerView loadPendingWriteCount in mount Promise.all
  affects:
    - TaggerView.tsx (ApplyBanner mounted in active-card + end-of-queue branches)
    - TaggerView.test.tsx (mock extended with Phase 5 tagger bridge methods)
    - TaggerEndToEnd.test.tsx (E2E apply slice + manual checkpoint docs)
tech_stack:
  added: []
  patterns:
    - subscribe-before-invoke (mirrors useConversionStore.startBatch)
    - immutable Map update per fileDone event (new Map(s.writeResults))
    - isApplying re-entry guard (T-05-DBL)
    - unsub called on both done and error paths (T-05-LEAK)
    - render-null-when-empty (mirrors ResumeBanner)
    - React text children for filePath/error (T-05-UI-XSS)
    - loadPendingWriteCount in mount Promise.all alongside loadQueue/loadGenrePresets
key_files:
  created:
    - src/renderer/src/components/tagger/ApplyBanner.tsx
    - src/renderer/src/components/tagger/ApplyBanner.test.tsx
  modified:
    - src/renderer/src/store/useTaggerStore.ts
    - src/renderer/src/store/useTaggerStore.test.ts
    - src/renderer/src/components/tagger/tagger.css
    - src/renderer/src/views/TaggerView.tsx
    - src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx
    - src/renderer/src/views/TaggerView.test.tsx
decisions:
  - "loadPendingWriteCount reads from getPendingCount bridge (D-03 source of truth), NOT derived from in-memory pendingEdits map — re-edits after a prior apply are counted correctly"
  - "subscribe-before-invoke: onWriteEvent registered before tagger.applyWrites() call so no fileDone events are missed (mirrors useConversionStore.resumeBatch pattern)"
  - "unsub called in both the done event handler AND the catch block so no listener leaks on rejection (T-05-LEAK)"
  - "ApplyBanner mounted in both active-card and end-of-queue branches — end-of-queue is the primary moment users click Appliquer"
  - "loadPendingWriteCount added to mount Promise.all so the badge is live on first render without a separate effect"
  - "TaggerView.test.tsx mock extended with Phase 5 bridge methods (Rule 1: failing tests from missing getPendingCount stub)"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-16"
  tasks: 3
  files_changed: 8
---

# Phase 05 Plan 03: "Appliquer (N)" Apply Surface Summary

User-facing apply surface that closes the Phase 5 loop: a live pending-edit count badge, a single-click Appliquer button, and per-file Écrit/Erreur feedback as the write loop commits each file.

## What Was Built

### Task 1: useTaggerStore — applyWrites action + apply state + pending count

`src/renderer/src/store/useTaggerStore.ts` extended with:

- **State fields:** `isApplying: boolean` (false), `applyResult: ApplyResult | null` (null), `applyError: string | null` (null), `writeResults: Map<string, { ok: boolean; error?: string }>` (new Map), `pendingWriteCount: number` (0)
- **`loadPendingWriteCount()`** — calls `window.crateKeeper.tagger.getPendingCount()` and sets `pendingWriteCount`. This is the D-03 re-edit-aware source of truth (not a derivation from in-memory pendingEdits).
- **`applyWrites()`** — mirrors `useConversionStore.startBatch` ordering:
  1. Re-entry guard: `if (get().isApplying) return`
  2. Subscribe to `onWriteEvent` BEFORE invoking `applyWrites` (subscribe-before-invoke pattern)
  3. `fileDone` handler: immutably sets `writeResults` with a new Map per event
  4. `done` handler: sets `applyResult`, calls `loadPendingWriteCount()` to refresh the badge, then `unsub()`
  5. After subscribing: `set({ isApplying: true, ... })` + `await tagger.applyWrites()`
  6. Error path: `unsub()` + `set({ isApplying: false, applyError: message })`

6 new tests: count loading, subscribe-before-invoke, Map immutability per event, rejection path, re-entry guard, done-event count refresh.

### Task 2: ApplyBanner.tsx + tagger.css + TaggerView mount

`src/renderer/src/components/tagger/ApplyBanner.tsx`:
- Renders `null` when `pendingWriteCount === 0 && applyResult === null && !isApplying` (ResumeBanner render-null pattern)
- Shows "N tag(s) en attente" label + `<button aria-busy>` CTA
- CTA text: `Appliquer (N)` at rest, `Écriture…` + disabled while `isApplying`
- Button disabled when `isApplying || pendingWriteCount === 0`
- `applyResult` renders `"N écrits, N erreurs"` summary
- `writeResults` renders per-file list: `Écrit` / `Erreur` badges with error text
- File paths displayed as basename only; rendered as React text children (T-05-UI-XSS)

`src/renderer/src/components/tagger/tagger.css`:
- `.apply-banner` section + `.apply-banner__cta` + `.apply-banner__badge--done/--error` styles
- Reuses existing `:root` design tokens only (no new `--color-*` vars per CLAUDE.md editorial lock)
- CTA uses `transform + opacity` transitions (compositor-friendly per web/coding-style.md)

`src/renderer/src/views/TaggerView.tsx`:
- `loadPendingWriteCount` added to mount `Promise.all` alongside `loadQueue/loadGenrePresets/loadMuteSetting`
- `<ApplyBanner />` mounted in the active-card branch (above the card wrapper) and the end-of-queue branch (the primary user moment)

`ApplyBanner.test.tsx`: 12 RTL tests covering all five plan requirements (null render, count display, disabled/loading states, click wiring, badge + summary).

### Task 3: E2E apply slice test + manual checkpoint documentation

`TaggerEndToEnd.test.tsx`:
- Mock extended with `getPendingCount / applyWrites / onWriteEvent`
- New E2E test: renders TaggerView with `getPendingCount=2`; asserts banner shows "Appliquer (2)"; click triggers apply; drives `fileDone(ok) + fileDone(ok:false) + done` events via captured callback; asserts `Écrit` + `Erreur` badges and `"1 écrits, 1 erreurs"` summary

Manual checkpoints documented for end-of-phase human-verify gate:
- **[SC #1] Mp3tag (TAGS-01):** Write a sample MP3, open in Mp3tag, confirm Artist/Title/Genre/BPM/Key/Comment and star rating show edited values
- **[SC #2] Crash-safety (TAGS-02):** Force-kill mid-batch write; relaunch; confirm no zero-byte sources and not-yet-written files remain in pending queue
- **[SC #3] Rekordbox (TAGS-03):** Import a written 4-star MP3 into Rekordbox 6.x; confirm BPM/Key/Genre and that the star rating renders as 4 stars (validates POPM byte scale 204 → 4 stars from A3)

## Verification Results

```
useTaggerStore.test.ts   — 36/36 passed (30 existing + 6 new)
ApplyBanner.test.tsx     — 12/12 passed
TaggerEndToEnd.test.tsx  — 3/3 passed (2 existing + 1 new)
TaggerView.test.tsx      — 16/16 passed (16 existing, mock extended)
npm test                 — 546/546 passed (39 test files)
npm run build            — typecheck (node + web) + vite build green
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TaggerView.test.tsx mock missing Phase 5 bridge methods**
- **Found during:** Task 3 — `npm test` full suite run
- **Issue:** `loadPendingWriteCount` added to mount `Promise.all` calls `getPendingCount()` on the bridge; `TaggerView.test.tsx` mock didn't include this method, causing two tests to fail with `TypeError: window.crateKeeper.tagger.getPendingCount is not a function`
- **Fix:** Added `getPendingCount` (returns 0), `applyWrites` (resolves), `onWriteEvent` (returns noop unsub) to `installMock` in `TaggerView.test.tsx`
- **Files modified:** `src/renderer/src/views/TaggerView.test.tsx`
- **Commit:** 2cb17a0

## Known Stubs

None. The apply surface is fully wired: `useTaggerStore.applyWrites` calls the real `window.crateKeeper.tagger.applyWrites` via the preload bridge built in Plan 02, which delegates to `applyController.applyPendingWrites()` in the main process, which writes actual files via `tagWriter.ts` from Plan 01. The Phase 5 loop is complete.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. This plan adds renderer UI only. All file-system threats are handled in Plans 01-02. The T-05-UI-XSS, T-05-LEAK, and T-05-DBL mitigations specified in the plan's threat model are implemented and tested.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/renderer/src/components/tagger/ApplyBanner.tsx | FOUND |
| src/renderer/src/components/tagger/ApplyBanner.test.tsx | FOUND |
| src/renderer/src/store/useTaggerStore.ts (applyWrites, loadPendingWriteCount) | FOUND |
| src/renderer/src/store/useTaggerStore.test.ts (Phase 5 tests) | FOUND |
| src/renderer/src/components/tagger/tagger.css (.apply-banner) | FOUND |
| src/renderer/src/views/TaggerView.tsx (ApplyBanner import + mount) | FOUND |
| src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx (E2E apply test) | FOUND |
| commit a665275 (useTaggerStore extend) | FOUND |
| commit cd4c77a (ApplyBanner + CSS + TaggerView) | FOUND |
| commit 2cb17a0 (E2E test + TaggerView.test.tsx fix) | FOUND |
