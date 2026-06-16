---
phase: 05-tag-writing-rekordbox-compatibility
plan: 02
subsystem: tagger/apply-controller + ipc-layer
tags: [applyController, ipc, preload, security-gate, tdd, batch-write, per-file-retry]
dependency_graph:
  requires:
    - 05-01 (tagWriter + taggerRepo.listPendingWrites + markApplied)
    - 04-01 (pending_tag_edits schema + taggerRepo base + resolvesUnderRoot)
  provides:
    - applyController.ts (createApplyController, makeTaggerWriteSender)
    - tagger:apply-writes IPC handler (rootFolder guard + security gate + delegate)
    - tagger:pending-count IPC handler
    - TagWriteEvent + ApplyResult in ipc-types.ts
    - preload bridge: applyWrites / getPendingCount / onWriteEvent
    - filterWritableEdits security helper (T-05-PT + T-05-IV)
  affects:
    - 05-03 (Appliquer UI button invokes applyWrites via preload bridge)
tech_stack:
  added: []
  patterns:
    - module-level isRunning guard (single-active batch, T-05-TMP)
    - per-file try/catch with applied_at NULL on failure (D-05 retryable)
    - makeTaggerWriteSender mirrors makeConversionSender (null/destroyed guard)
    - filterWritableEdits: resolvesUnderRoot + AUDIO_EXTS reuse (T-05-PT/IV)
    - discriminated union push events (TagWriteEvent mirrors ConversionEvent)
    - preload on()/off() unsubscribe closure (mirrors conversion.onEvent)
    - TDD RED→GREEN with vitest --project node
key_files:
  created:
    - src/main/tagger/applyController.ts
    - src/main/tagger/applyController.test.ts
  modified:
    - src/shared/ipc-types.ts (3 channels + TagWriteEvent + ApplyResult + 3 bridge methods)
    - src/preload/index.ts (applyWrites + getPendingCount + onWriteEvent)
    - src/main/ipc/tagger.ts (filterWritableEdits + 2 new handlers + opts extension)
    - src/main/ipc/tagger.test.ts (8 new tests incl. T-05-PT)
    - src/main/index.ts (Phase 5 block: taggerWriteSend + applyController wiring)
    - src/renderer/src/App.test.tsx (mock extended with 3 new tagger methods)
decisions:
  - "applyController receives taggerRepo.listPendingWrites() from its own deps at call time; the IPC handler also calls filterWritableEdits(taggerRepo.listPendingWrites(), root) as a separate defence-in-depth gate at the IPC layer — belt-and-suspenders for T-05-PT"
  - "applyController is optional in RegisterTaggerHandlersOpts (applyController?: ApplyController) to keep backward compatibility with Phase 4 test setups that don't pass it; the handler throws a clear error if called without it"
  - "filterWritableEdits exported from ipc/tagger.ts for unit-testability — reuses resolvesUnderRoot + AUDIO_EXTS already defined in that file without copying"
metrics:
  duration: "~12 minutes"
  completed: "2026-06-16"
  tasks: 3
  files_changed: 8
---

# Phase 05 Plan 02: Batch Apply Controller & IPC Surface Summary

Sequential, per-file-retryable batch write controller wired end-to-end through a secured `tagger:apply-writes` + `tagger:pending-count` IPC surface, with shared-types and preload bridge for the renderer.

## What Was Built

### Task 1: applyController.ts — sequential, per-file-retryable batch loop (TDD)

`src/main/tagger/applyController.ts` exports:

- **`createApplyController(deps)`** — factory returning `{ applyPendingWrites() }`. Deps-injected (taggerRepo, writeMp3Tags, writeMp4Tags, ffmpegBinaryPath, send, now?). Module-level `isRunning` boolean prevents concurrent runs (T-05-TMP). Sequential loop over `listPendingWrites()`: `getWriteStrategy` dispatches to `writeMp3Tags` / `writeMp4Tags` / throws on 'unsupported'. `markApplied` called only AFTER write succeeds; a per-file failure leaves `applied_at` NULL → retryable (D-05). Per-file `fileDone` events sent; `done` event with totals sent at the end.
- **`makeTaggerWriteSender(getSender)`** — mirrors `makeConversionSender`. Guards against null / destroyed WebContents.

10/10 tests green: happy path, order (write before markApplied), per-file isolation (D-05), events, single-active guard, unsupported extension.

### Task 2: ipc-types + preload bridge

`src/shared/ipc-types.ts` extended:
- 3 new IpcChannels: `TaggerApplyWrites`, `TaggerPendingCount`, `TaggerWriteEvent`
- `TagWriteEvent` discriminated union (`fileDone ok:true | fileDone ok:false+error | done`)
- `ApplyResult` interface `{ totalWritten, totalFailed }`
- `CrateKeeperTaggerApi` extended with `applyWrites()`, `getPendingCount()`, `onWriteEvent(cb) => () => void`

`src/preload/index.ts` extended:
- `applyWrites`: `ipcRenderer.invoke(TaggerApplyWrites)`
- `getPendingCount`: `ipcRenderer.invoke(TaggerPendingCount)`
- `onWriteEvent`: `ipcRenderer.on(TaggerWriteEvent, handler)` + unsubscribe closure via `ipcRenderer.off()` (mirrors `conversion.onEvent`)

### Task 3: tagger IPC handlers + main-process wiring

`src/main/ipc/tagger.ts`:
- **`filterWritableEdits(edits, root)`** — exported security helper. Filters `PendingTagEdit[]` to those passing `resolvesUnderRoot(filePath, root)` AND `AUDIO_EXTS` extension check (T-05-PT path traversal + T-05-IV extension validation). Reuses existing helpers without copying.
- **`tagger:apply-writes`** handler — rootFolder null-guard → throws; calls `filterWritableEdits` as IPC-layer gate; delegates to `applyController.applyPendingWrites()`
- **`tagger:pending-count`** handler — returns `taggerRepo.listPendingWrites().length`
- `RegisterTaggerHandlersOpts` extended with `applyController?: ApplyController`

`src/main/index.ts`:
- Phase 5 block after Phase 4: `makeTaggerWriteSender(() => mainWindow?.webContents ?? null)`, `createApplyController({ taggerRepo, writeMp3Tags, writeMp4Tags, ffmpegBinaryPath: resolveFfmpegPath(...), send: taggerWriteSend })`, `applyController` passed to `registerTaggerHandlers`

## Verification Results

```
applyController.test.ts  — 10/10 passed
tagger.test.ts           — 35/35 passed (27 existing + 8 new)
npm test                 — 527/527 passed (38 test files)
npm run build            — typecheck (both projects) + vite green
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing functionality] ipc-types.ts channels needed before Task 1 GREEN**
- **Found during:** Task 1 GREEN (applyController imports `IpcChannels.TaggerWriteEvent` which didn't exist yet)
- **Issue:** `IpcChannels.TaggerWriteEvent` was `undefined` at runtime — the channel const didn't exist yet (Task 2 was supposed to add it, but Task 1 depends on it)
- **Fix:** Added the 3 channels + `TagWriteEvent` + `ApplyResult` to `ipc-types.ts` before completing Task 1 GREEN, then committed them with Task 2
- **Files modified:** `src/shared/ipc-types.ts`
- **Commit:** d09ca2d

**2. [Rule 1 - Bug] vi.fn() type incompatibility with typed function signatures in applyController.test.ts**
- **Found during:** `npx tsc --noEmit -p tsconfig.node.json`
- **Issue:** `vi.fn()` returns `Mock<Procedure | Constructable>` which TypeScript rejects as a typed function signature (TS2322) when passed as `writeMp3Tags: WriteFn3`
- **Fix:** Added `WriteFn3`, `WriteFn4`, `SendFn` type aliases and `as unknown as` casts for vi.fn() reassignments. Standard Vitest mocking pattern
- **Files modified:** `src/main/tagger/applyController.test.ts`
- **Commit:** d09ca2d

**3. [Rule 1 - Bug] App.test.tsx missing new CrateKeeperTaggerApi methods**
- **Found during:** `npx tsc --noEmit -p tsconfig.web.json` — TS2739
- **Issue:** Adding `applyWrites`, `getPendingCount`, `onWriteEvent` to `CrateKeeperTaggerApi` interface caused `App.test.tsx` mock to be incomplete
- **Fix:** Added mock implementations for the 3 new methods in the `installCrateKeeperMock` factory
- **Files modified:** `src/renderer/src/App.test.tsx`
- **Commit:** d09ca2d

**4. [Rule 2 - Missing functionality] applyController is optional in RegisterTaggerHandlersOpts**
- **Found during:** Task 3 implementation
- **Issue:** Making `applyController` required would break all Phase 4 test setups that call `registerTaggerHandlers` without it
- **Fix:** Made `applyController?: ApplyController` optional with an explicit error thrown if the handler is invoked without it; added a test for this case
- **Files modified:** `src/main/ipc/tagger.ts`, `src/main/ipc/tagger.test.ts`
- **Commit:** 12f9171

## Key Decisions

- **IPC-layer defence-in-depth:** `filterWritableEdits` is called at the `tagger:apply-writes` handler AND the controller reads from the DB directly. This double-gate approach means even if a future caller bypasses the IPC handler, the per-file security is still in place at the controller level via `getWriteStrategy`.
- **Optional applyController in opts:** Backward compatibility with Phase 4 tests. Clear error thrown at runtime if invoked without it.

## Threat Surface Scan

No new network endpoints or auth paths. `filterWritableEdits` adds a verified mitigation for:
- T-05-PT (path traversal via DB-stored paths) — `resolvesUnderRoot` gate
- T-05-IV (non-audio extension bypass) — `AUDIO_EXTS` gate

## Known Stubs

None. All exported functions are fully implemented. The renderer UI (Appliquer button) is the only missing piece — that is Plan 03's scope.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| src/main/tagger/applyController.ts | FOUND |
| src/main/tagger/applyController.test.ts | FOUND |
| src/shared/ipc-types.ts (TaggerApplyWrites, TagWriteEvent, ApplyResult) | FOUND |
| src/preload/index.ts (onWriteEvent) | FOUND |
| src/main/ipc/tagger.ts (filterWritableEdits, TaggerApplyWrites handler) | FOUND |
| src/main/index.ts (createApplyController block) | FOUND |
| commit 149f84b (applyController) | FOUND |
| commit d09ca2d (ipc-types + preload) | FOUND |
| commit 12f9171 (IPC handlers + wiring) | FOUND |
