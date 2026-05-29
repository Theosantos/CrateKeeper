---
phase: 02-scanning
plan: 01
subsystem: scan-backbone
tags: [ipc, worker-threads, sqlite, music-metadata, readdirp, electron-vite]
requires:
  - "Phase 1 typed IPC bridge (IpcChannels, DjUtilsApi, sandbox:true preload)"
  - "Phase 1 settings repo (settings:get/set-folder + persisted rootFolder)"
  - "Phase 1 better-sqlite3 connection + createXRepo factory pattern"
provides:
  - "window.djUtils.scan.{start,cancel,exportCsv,onEvent} typed bridge surface"
  - "scans + scanned_files SQLite tables behind createScanRepo(db) / initScanSchema(db)"
  - "Pure scanCore: AUDIO_EXTS, inferFormat, hasGenre/Bpm/KeyTag, rowFromMetadata, errorRow"
  - "Node worker_threads scanWorker entry bundled to out/main/workers/scanWorker.js"
  - "ScanController(spawnWorker, repo, send, now): single-active-scan with persist-then-forward batching"
  - "scan:start folder allowlist gate (folder === settings.rootFolder)"
affects:
  - "Renderer (Plan 02-02 will consume window.djUtils.scan + ScanEvent stream)"
  - "Plan 02-03 (CSV export wires into scanExportCsvHandler; iterateFiles cursor ready)"
  - "Phase 4 tagger queue (will SELECT FROM scanned_files WHERE has_genre=0 OR ...)"
tech-stack:
  added:
    - "music-metadata ^11.12 (already in deps from prior commit, now used)"
    - "readdirp ^5.0 (already in deps, now used)"
  patterns:
    - "createXRepo(db) + initXSchema(db) factory mirrored from Phase 1 settingsRepo"
    - "Pure-handler + thin-registration split mirrored from Phase 1 dialog/settings IPC"
    - "Dependency-injected ScanController (spawnWorker/repo/send) — testable without spinning a real Worker"
key-files:
  created:
    - src/main/workers/scanCore.ts
    - src/main/workers/scanCore.test.ts
    - src/main/workers/scanWorker.ts
    - src/main/workers/__fixtures__/tagged.mp3
    - src/main/workers/__fixtures__/untagged.mp3
    - src/main/workers/__fixtures__/sample.flac
    - src/main/scan/scanRepo.ts
    - src/main/scan/scanRepo.test.ts
    - src/main/scan/controller.ts
    - src/main/scan/controller.test.ts
    - src/main/ipc/scan.ts
    - src/main/ipc/scan.test.ts
  modified:
    - electron.vite.config.ts
    - src/shared/ipc-types.ts
    - src/preload/index.ts
    - src/main/db/connection.ts
    - src/main/index.ts
    - vitest.setup.ts
    - src/renderer/src/env.d.ts
    - src/renderer/src/App.test.tsx
decisions:
  - "AUDIO_EXTS locked to 9 extensions (.mp3/.flac/.m4a/.aac/.wav/.aiff/.aif/.ogg/.opus) — RESEARCH Open Question 1"
  - "Single-active-scan: starting while running cancels-and-restarts (no concurrent scans) — Open Question 4"
  - "One scan per root folder, replaced on rescan via replaceScanForFolder() atomic transaction — Open Question 5"
  - "Failed-parse rows are still emitted with parsedOk=false + errorMessage so UI can surface them — Open Question 6"
  - "scan:start handler enforces folder === settings.rootFolder (RESEARCH Pitfall 8 mitigation; Threat T-2-01)"
  - "Persist-before-forward ordering inside controller 'rows' branch (replay/correctness safety)"
metrics:
  duration_minutes: 10
  completed: 2026-05-29
  tasks_completed: 6
  tasks_total: 6
  tests_added: 40
  tests_total: 55
---

# Phase 2 Plan 01: Scan Backbone Summary

End-to-end main-process scanning pipeline shipped: typed `window.djUtils.scan` namespace, `scans` + `scanned_files` SQLite persistence, pure scanCore over music-metadata, `worker_threads`-based streaming scan worker bundled to `out/main/workers/scanWorker.js`, ScanController with single-active-scan + persist-then-forward batching, and a `scan:start` handler with a folder-allowlist gate enforcing `folder === settings.rootFolder`.

## Commits

| Task | Hash      | Message                                                                |
| ---- | --------- | ---------------------------------------------------------------------- |
| 1    | `527630e` | chore(02-01): add scanWorker build entry + audio fixtures (Wave 0)     |
| 2    | `9e080a9` | feat(02-01): extend IPC bridge with scan namespace (Task 2)            |
| 3    | `fbf8ce0` | feat(02-01): scanCore pure helpers + tests (Task 3, SCAN-01/02/03)     |
| 4    | `73b0ca7` | feat(02-01): scanRepo + connection wiring (Task 4, SCAN-05 persistence)|
| 5    | `67595eb` | feat(02-01): scanWorker entry + ScanController (Task 5, SCAN-05 backbone)|
| 6    | `a9cc179` | feat(02-01): scan IPC handlers + main wiring (Task 6)                  |

## Acceptance Criteria

### Requirements covered (PLAN frontmatter)

- **SCAN-01** (format/bitrate/size) — `rowFromMetadata` returns format/bitrate/sizeBytes; 12 scanCore unit tests pass against MP3 + FLAC fixtures.
- **SCAN-02** (sample rate/duration) — same row carries `sampleRate` + `durationSeconds` extracted from `meta.format`.
- **SCAN-03** (Genre/BPM/Key badges) — `hasGenreTag`/`hasBpmTag`/`hasKeyTag` predicates produce booleans persisted as 0/1 in `scanned_files`.
- **SCAN-05** (worker-threads off-main-process) — `scanWorker.ts` runs `readdirp` + `parseFile` on a Node Worker; main only persists + forwards batches.

### Verification

- `npm run build` green (typecheck:node + typecheck:web + electron-vite build).
- `out/main/index.js` AND `out/main/workers/scanWorker.js` both emit (RESEARCH Pitfall 1 HIGH verified — worker is 3.9 KB of real code after Task 5).
- `npm run test -- --run` green: **55 tests across 8 files** (40 new tests added in this plan).
- Per-task vitest suites all green:
  - `src/main/workers/scanCore` — 12 tests (multi-format MP3+FLAC, badge predicates, error rows)
  - `src/main/scan/scanRepo` — 13 tests (schema, batched-transaction insert, INSERT OR REPLACE idempotency, replaceScanForFolder, iterateFiles cursor, SQL-safety defence-in-depth)
  - `src/main/scan/controller` — 7 tests (spawn, persist-then-forward call-order, done/error terminal, single-active-scan cancel-and-restart, cancel happy path + no-op)
  - `src/main/ipc/scan` — 8 tests (V5 input validation, folder allowlist gate, controller delegation, CSV stub, registration channel set)

### Invariant grep gates

- `grep -E "^import.*worker_threads|^import.*readdirp" src/main/workers/scanCore.ts` → no banned imports (purity preserved).
- `grep -E "\\$\\{.*\\}.*(FROM|INSERT|UPDATE|SELECT)" src/main/scan/scanRepo.ts` → no template-literal SQL (V5 defence-in-depth).
- `grep -c "db.transaction" src/main/scan/scanRepo.ts` → 2 (RESEARCH Pitfall 2 HIGH — batched inserts).
- `grep "workers/scanWorker.js" src/main/index.ts` → present (worker spawn path matches bundled output).
- Phase 1 IpcChannels values (PickFolder, GetRootFolder, SetRootFolder) and DjUtilsApi methods (pickFolder, getRootFolder, setRootFolder) are unchanged — only additive extension.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] vitest test typecheck failure on toBeInTheDocument**

- **Found during:** Task 1 build verification.
- **Issue:** `npm run build` typecheck failed with `TS2339: Property 'toBeInTheDocument' does not exist on type 'Assertion<HTMLElement>'` across `src/renderer/src/App.test.tsx`. Modern `@testing-library/jest-dom` (^6.x) exposes vitest type augmentation at the `/vitest` subpath only — the bare `import '@testing-library/jest-dom'` registers Jest globals, not Vitest's `Assertion` interface.
- **Fix:** Switched `vitest.setup.ts` to `import '@testing-library/jest-dom/vitest'` AND added a `/// <reference types="@testing-library/jest-dom" />` directive in `src/renderer/src/env.d.ts` so the augmentation reaches the test file's type-checking context (test files don't import the setup file directly).
- **Files modified:** `vitest.setup.ts`, `src/renderer/src/env.d.ts`.
- **Commit:** `527630e` (rolled into Task 1's chore commit).
- **Justification:** Plan acceptance requires `npm run build` exit 0; this typecheck regression was pre-existing at the wave base commit and blocked the build. Cause appears to be the Phase 2 dependency install commit altering peer-dep resolution.

**2. [Rule 3 — Blocking] App.test.tsx mock missing scan namespace**

- **Found during:** Task 2 build verification.
- **Issue:** Extending `DjUtilsApi` with the `scan` namespace broke `installDjUtilsMock()` in `src/renderer/src/App.test.tsx` (TS2741 missing property).
- **Fix:** Added `scan: { start, cancel, exportCsv, onEvent }` stubs to the mock object using the same typed `vi.fn` shape pattern used for the existing four members.
- **Files modified:** `src/renderer/src/App.test.tsx`.
- **Commit:** `9e080a9` (rolled into Task 2's feat commit).
- **Justification:** A typed shared contract change requires test mocks to evolve with it; this is the expected propagation, not a separate deviation in spirit.

No bugs (Rule 1), no missing critical functionality (Rule 2), no architectural changes (Rule 4).

## Authentication Gates

None. This plan does not touch auth-bearing surfaces.

## Threat Mitigations Implemented

| Threat ID | Mitigation                                                                                                                                |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| T-2-01    | `scanStartHandler` rejects when `folder !== settingsRepo.get('rootFolder')` — tested with `/etc/passwd` and `null` persisted cases.       |
| T-2-02    | Per-file try/catch in `scanWorker.ts` emits `errorRow`; top-level try/catch posts `{type:'error'}`; controller `worker.on('error')` + `worker.on('exit')` always clear active scan. |
| T-2-03    | `readdirp` v5 inode-cycle protection used as-is (documented limitation: network volumes).                                                 |
| T-2-04    | `parseFile(path, { duration: true, skipCovers: true })` — `skipCovers` avoids loading large MP4 cover atoms.                              |
| T-2-05    | `spawnWorker` in `src/main/index.ts` uses `path.join(__dirname, 'workers/scanWorker.js')` — never accepts a renderer-supplied path.       |
| T-2-06    | All four new channels added to `IpcChannels` const and typed in `DjUtilsApi.scan`; handlers runtime-validate input (V5).                  |

## Known Stubs

- `scanExportCsvHandler` throws `Error('scan:export-csv not implemented yet — Plan 02-03')` by design — Plan 02-03 replaces with the streaming CSV implementation. The IPC channel + bridge surface exists so Plan 02-02's renderer typechecks against the full `DjUtilsApi.scan` contract today.

## Threat Flags

None — no new security surface beyond what is already tracked in the PLAN's `<threat_model>`.

## Pending Human Verification (PLAN Task 7 — checkpoint:human-verify)

Plan 02-01 ends with a `checkpoint:human-verify` task. As a parallel-wave worktree executor, the implementation is complete and committed; the manual DevTools-console verification (Phase 1 round-trip preserved, `window.djUtils.scan.start(persistedFolder)` produces row events + done event, allowlist gate rejects non-rootFolder paths, no orphan worker after quit) is left for the orchestrator's post-merge phase verification step per the parallel-execution contract. All automated checks listed in the checkpoint (`out/main/workers/scanWorker.js` exists, `npm run build` green, full test suite green) PASS at this commit.

## Self-Check: PASSED

**Files checked (all FOUND):**

- src/main/workers/scanCore.ts
- src/main/workers/scanCore.test.ts
- src/main/workers/scanWorker.ts
- src/main/workers/__fixtures__/tagged.mp3
- src/main/workers/__fixtures__/untagged.mp3
- src/main/workers/__fixtures__/sample.flac
- src/main/scan/scanRepo.ts
- src/main/scan/scanRepo.test.ts
- src/main/scan/controller.ts
- src/main/scan/controller.test.ts
- src/main/ipc/scan.ts
- src/main/ipc/scan.test.ts
- out/main/index.js
- out/main/workers/scanWorker.js

**Commits checked (all FOUND in git log):** 527630e, 9e080a9, fbf8ce0, 73b0ca7, 67595eb, a9cc179.
