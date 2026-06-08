---
phase: 04-tagger-core
plan: 03
subsystem: tagger
tags: [tagger, undo, session-resume, debounce, integration-test]
requires:
  - 04-01 (taggerRepo + tagger:save-edit/delete-edit/get-session/set-session IPC)
  - 04-02 (useTaggerStore queue+dirty+keep/skip, useTaggerKeyboard, TaggerCard, TaggerView shell, useDebouncedCallback)
provides:
  - useTaggerStore.lastAction (1-level in-memory undo descriptor)
  - useTaggerStore.undo (routes keep-with-prior, keep-no-prior, skip)
  - useTaggerStore.scanId (sourced from loadQueue; consumed by session writes)
  - TaggerView session restore (mount-time getSession after loadQueue)
  - TaggerView 500ms debounced setSession + beforeunload synchronous flush
  - TaggerView Cmd-Z + Annuler wiring with REVERSED slide direction
  - TaggerEndToEnd.test.tsx (full-flow integration coverage)
affects:
  - src/renderer/src/components/tagger/TaggerCard.tsx (Annuler button now active when canUndo)
tech_stack:
  added: []
  patterns:
    - Same-set() atomic lastAction consumption (prevents double-undo by construction)
    - useDebouncedCallback.flush() wired to window 'beforeunload' (Pitfall 1 mitigation)
    - Identity-by-path session restore with library-change fallback to index 0
    - Reversed-direction slide animation derived from lastAction.type BEFORE undo()
key_files:
  created:
    - src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx
  modified:
    - src/renderer/src/store/useTaggerStore.ts
    - src/renderer/src/store/useTaggerStore.test.ts
    - src/renderer/src/views/TaggerView.tsx
    - src/renderer/src/views/TaggerView.test.tsx
    - src/renderer/src/components/tagger/TaggerCard.tsx
decisions:
  - lastAction descriptor includes both `prior` (for state restoration) and `savedEdit` (for debugging/observability). The `prior` field is the load-bearing one; `savedEdit` is informational.
  - scanId added to store state (not threaded through props) — simplest source of truth for the debounced setSession payload; updated atomically inside loadQueue alongside files+pending.
  - Debounce ms = 500 (LOCKED in 04-CONTEXT). Trailing edge. flush() synchronously runs the pending args; never queues another timer.
  - beforeunload listener lives on window (not document) — that's the spec-correct surface, and matches the Pitfall 1 research note.
  - Slide direction for undo is computed BEFORE undo() is called by reading lastAction off the store snapshot. Reversing AFTER undo would be too late (lastAction is null).
  - Annuler button toggles `disabled` based on `canUndo` prop (TaggerView lifts the read of lastAction!==null). aria-disabled mirrors disabled for screen-reader parity.
metrics:
  duration_minutes: ~12
  tasks_completed: 3
  tests_added: 26
  tests_total: 452
  completed_date: 2026-06-05
---

# Phase 4 Plan 03: Tagger Session Resume + Undo Summary

One-liner: Persistence + 1-level undo for the Tagger — 500ms debounced `tagger:set-session` with `beforeunload` synchronous flush + mount-time identity-by-path restore + Cmd-Z / Annuler routed through a `lastAction` state machine with reversed slide direction.

## What Shipped

### Store: 1-level undo state machine + scanId tracking
- `LastAction` descriptor: `{type: 'keep'|'skip', filePath, prior?: PendingTagEdit|null, savedEdit?: SaveTagEditInput}`. New object reference on every push.
- `keep()` now snapshots the prior pending row BEFORE `saveEdit` and pushes `{type:'keep', filePath, prior, savedEdit:merged}` atomically with the index advance.
- `skip()` pushes `{type:'skip', filePath}` atomically with the index advance.
- `undo()` branches:
  - `lastAction === null` → return immediately (no-op).
  - `type === 'skip'` → rewind index by 1, clear lastAction, no IPC.
  - `type === 'keep' && prior === null` → await `tagger.deleteEdit(filePath)`, drop the pending row, rewind index, clear lastAction.
  - `type === 'keep' && prior !== null` → await `tagger.saveEdit(prior)`, restore the pending row, rewind index, clear lastAction.
- `lastAction` cleared in the SAME `set()` that consumes it — double-undo is structurally impossible (the second call sees `null` and returns).
- `scanId` now tracked on state, sourced from the `tagger.loadQueue` result. Consumed by the TaggerView debounced session writer.
- `reset()` clears `lastAction` and `scanId` back to null.

### View: session resume + debounced persistence + undo wiring
- **Mount lifecycle:** `Promise.all([loadQueue(), loadGenrePresets(), loadMuteSetting()])` first, THEN `await tagger.getSession()`. If `session.currentFilePath` is found in the queue via `findIndex`, jump `currentIndex` to it; otherwise stay at 0 (library-change resilience).
- **Debounced setSession:** `useDebouncedCallback((path) => tagger.setSession({currentFilePath:path, scanId}), 500)`. Scheduled after every Keep / Skip / Undo `runWithSlide` completes, with the path derived AFTER the action settles (so it reflects the new currentIndex).
- **beforeunload flush:** `window.addEventListener('beforeunload', () => debounced.flush())`. Pitfall 1 mitigated — quitting the app never drops the last in-flight session pointer.
- **Cmd-Z routing:** `useTaggerKeyboard.onUndo` now calls `handleUndo` which (a) reads `lastAction.type` from the store BEFORE calling undo, (b) picks `dir = type==='keep' ? 'right' : 'left'` (reverse of the original action's slide direction), (c) routes through the same `runWithSlide` orchestrator.
- **Annuler button:** TaggerCard now accepts `onUndo` + `canUndo` props. TaggerView lifts the `lastAction !== null` read and passes both. Button is `disabled` + `aria-disabled` when null; both routing paths (button click + Cmd-Z) hit the same `handleUndo`.

### Integration test: TaggerEndToEnd.test.tsx
Single end-to-end RTL flow covering load → edit → preset → keep → skip → undo-skip → double-undo no-op → 3 rapid keeps → end-of-queue → beforeunload flush → remount-with-session → library-change fallback, plus a second smaller test covering undo-after-Keep (deleteEdit path) via the Annuler button. Only `window.crateKeeper.tagger.*` is mocked — the real store + real view + real keyboard hook + real debounce hook all participate. Runtime ~200ms with real timers.

## Per-task Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 47e7131 | feat(04-03): useTaggerStore lastAction + undo + scanId |
| 2 | 9c4b61f | feat(04-03): TaggerView session resume + debounced setSession + undo wiring |
| 3 | 07d808d | test(04-03): end-to-end RTL test for full Tagger flow |

## Verification

- `npm test -- --run` → 452/452 tests green (26 new across useTaggerStore, TaggerView, TaggerEndToEnd; existing 426 unchanged).
- `npm run build` → exit 0; typechecks (node + web tsconfigs) + electron-vite bundle.
- `useTaggerStore` tests: 30 (15 prior + 15 new undo/scanId).
- `TaggerView` tests: 21 (9 prior + 12 new session/debounce/undo).
- `TaggerEndToEnd` tests: 2 (one full flow + one undo-after-Keep smaller flow).
- Atomic-consumption invariant verified: double-undo test asserts no extra IPC calls after the first undo consumes lastAction.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Test environment quirk] Fake-timer + waitFor incompatibility**
- **Found during:** Task 2 (TaggerView debounce tests).
- **Issue:** Three tests in the plan recommended `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(...)` to advance through the 500ms debounce. In practice, `@testing-library/react`'s `waitFor` polls with real timers — once fake timers are installed, every `waitFor` call hangs until the 5s test timeout. Replacing the fake-timer dance with `waitFor({ timeout: 1500 })` on the IPC assertion (debounce is only 500ms, so 1500ms gives ample headroom) achieves the same observable behaviour, runs in <1s, and is robust under jsdom's event-loop quirks.
- **Fix:** Removed `vi.useFakeTimers()` from the three TaggerView debounce tests; kept the beforeunload synchronous-flush test logic (which doesn't need fake timers — flush() runs synchronously by design).
- **Files modified:** `src/renderer/src/views/TaggerView.test.tsx`.
- **Commit:** 9c4b61f.

**2. [Rule 3 — Plan refinement] `getByLabelText('Genre')` exact match in end-to-end test**
- **Found during:** Task 3.
- **Issue:** The default fuzzy match for `/Genre/` matched both the editable Genre field's label and the read-only "Genre détecté" chip text, causing `getByLabelText` to throw "multiple matches". The plan said `screen.getByLabelText` without specifying exact vs. fuzzy.
- **Fix:** Use exact string `'Genre'` for the field label query in the integration test. The chip uses "Genre détecté" so the exact match disambiguates cleanly.
- **Files modified:** `src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx`.
- **Commit:** 07d808d.

No security / architecture deviations. No new IPC surface in this plan; all writes use the Plan 04-01 channels with their existing validation.

## Checkpoint Handling

This plan's final `checkpoint:human-verify` task is the **end-of-phase Tagger validation** — visual + auditory + real-Electron checks that no automated test can cover (per-format audio playback, slide-animation smoothness during playback, real Cmd+Q + relaunch session resume cycle, library-change resume on a genuinely re-scanned library, DevTools security spot-checks at the IPC + protocol layers).

Auto-mode is active, but per the orchestrator prompt's explicit instruction (*"This plan ends with the final HUMAN-VERIFY checkpoint for the phase. When you reach it, stop and report back — do NOT auto-approve."*), this checkpoint is being surfaced to the user rather than auto-approved. The plan's `gate="blocking"` checkpoint is not a package-legitimacy / `blocking-human` gate, so auto-mode rules would normally apply — the orchestrator override takes precedence here.

Automated gates already cleared by this plan:
1. `npm run build` → exit 0 ✓
2. `npm test -- --run` → 452/452 green ✓ (no regressions in Plans 04-01/04-02)
3. End-to-end RTL test exercises load → edit → keep → skip → undo×2 → resume in a single flow ✓
4. Library-change resilience explicitly verified (path-not-in-queue → index 0) ✓
5. beforeunload synchronous flush verified ✓
6. Double-undo IPC-no-op verified ✓

## Known Stubs

None. Every stub flagged in the 04-02 summary (Annuler `disabled`, `useTaggerKeyboard.onUndo` no-op) has been wired in this plan. The Space-play-pause hotkey is still a no-op at the view level — that's a documented deferred-polish item from CONTEXT (not a stub for this plan to wire).

## Threat Flags

None new. T-4-09 / T-4-10 / T-4-11 mitigations from the plan's threat register are all in place:
- **T-4-09 (Data loss on quit):** mitigated by `useDebouncedCallback.flush()` wired to `beforeunload`. Verified by the synchronous-flush test.
- **T-4-10 (Stale session pointing at deleted file):** mitigated by identity-by-path `findIndex` with fallback to index 0. Verified by the library-change-resilience test.
- **T-4-11 (Double-undo corruption):** mitigated by atomic same-`set()` consumption of `lastAction`. Verified by the double-undo no-op test + asserted mock call counts.

Carry-forward T-4-01..08 (folder allowlist, V5 validation, protocol gating, sandboxed preload, etc.) from Plans 04-01 + 04-02 remain in force; this plan adds no new IPC surface.

## Post-checkpoint UX fixes (user feedback)

The first human-verify pass was rejected. User report verbatim:

> Il n'y a pas de sons qui sort et pour la clé et le bpm pas besoin de
> l'éditer dans cet outil. Rekordbox le fait déjà très bien et ce n'est
> pas à l'oreille qu'on va le trouver. Il faudrait un slider pour savoir
> où on en est dans la musique et pouvoir bouger dans la chanson. Pour
> la proposition de séparation de titre : enlever l'extension du fichier,
> actuellement le .m4a est proposé comme élement du titre ou de l'artiste.

Four atomic fixes applied on the same branch (phase-04-tagger), tests
re-run green, build re-run green:

| # | Fix | Commit | Files |
| - | --- | ------ | ----- |
| 1 | Silent audio: explicit `el.muted = prop` + `el.load()` on src change + muted-fallback retry on play() rejection; muted now in effect deps. | 4641b3f | `src/renderer/src/components/tagger/AudioPreview.tsx` |
| 2 | Remove BPM and Key editable fields from TaggerCard. Read-only chips for `hasBpm`/`hasKey` stay; `SaveTagEditInput` schema unchanged for forward compat. Updated TaggerCard tests. | 93faf4c | `src/renderer/src/components/tagger/TaggerCard.tsx`, `TaggerCard.test.tsx` |
| 3 | Seek slider with `0:00 / 0:00` mm:ss readout; removed the 30s sub-segment loop (`loop` attr now restarts the full track); native `<audio>` chrome hidden; transport uses tokenised colours only (`accent-color: var(--color-accent)`); compositor-friendly. | 14de9e1 | `src/renderer/src/components/tagger/AudioPreview.tsx`, `AudioPreview.test.tsx`, `tagger.css` |
| 4 | `suggestSplits` strips a trailing audio extension (case-insensitive, mirrors `AUDIO_EXTS`) before scanning for separators. Regression tests for `.m4a`, `.MP3`, `.flac`, and non-audio extension untouched-passthrough. | 38194bb | `src/renderer/src/components/tagger/splitDetection.ts`, `splitDetection.test.ts` |

Re-verification gates:

- `npm test -- --run` → 458/458 green (was 452; +6 net — added 1 TaggerCard test, 4 split-detection tests, 2 seek-slider tests, removed BPM-clamp test and 30s-loop test).
- `npm run build` → exit 0.
- No regression in undo / session restore / keyboard hooks (all suites green).
- Branch unchanged: still `phase-04-tagger`.

Re-checkpoint stays the responsibility of the user — do NOT re-claim
approval on their behalf. This summary documents the gap-closure only.

## Self-Check: PASSED

Files exist:
- `src/renderer/src/store/useTaggerStore.ts` (modified) ✓
- `src/renderer/src/store/useTaggerStore.test.ts` (modified) ✓
- `src/renderer/src/views/TaggerView.tsx` (modified) ✓
- `src/renderer/src/views/TaggerView.test.tsx` (modified) ✓
- `src/renderer/src/components/tagger/TaggerCard.tsx` (modified) ✓
- `src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx` (new) ✓

All 3 task commits present in `git log` (47e7131 / 9c4b61f / 07d808d).

452/452 tests green; build green.
