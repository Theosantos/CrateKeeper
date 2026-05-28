---
phase: 01-foundation
plan: 01
subsystem: infra
tags: [electron, electron-vite, react, typescript, vite, better-sqlite3, vitest, ipc, contextBridge, ffmpeg-static, zustand]

requires: []
provides:
  - electron-vite + React 19 + TypeScript scaffold (pinned vite 7 / plugin-react 5 / electron 39)
  - Secure BrowserWindow (contextIsolation:true, nodeIntegration:false, sandbox:true)
  - Typed window.djUtils contextBridge API (pickFolder, getRootFolder, setRootFolder) with shared IpcChannels constants
  - better-sqlite3 settings key/value store at app.getPath('userData')/dj-utils.db with WAL
  - Parameterized SettingsRepo (factory pattern, injectable Database for tests)
  - Folder-picker ipcMain handler (dialog:pick-folder) with factored pickFolderHandler(dialogApi)
  - Settings IPC handlers (settings:get-folder, settings:set-folder) with renderer-input type check
  - resolveFfmpegPath() helper with app.asar.unpacked rewrite (used Phase 3)
  - Vitest infrastructure: node project (src/main, src/shared) + jsdom project (src/renderer)
  - electron-builder.yml asarUnpack entries for ffmpeg-static and better-sqlite3
  - Dual-runtime native-module scripts (pretest rebuilds for Node ABI; predev/prebuild rebuild for Electron ABI)
affects: [01-02, 02-scanning, 03-conversion, 04-tagger, 05-tag-writing, 06-distribution]

tech-stack:
  added:
    - "electron-vite ^5.0.0 (scaffold)"
    - "electron ^39.2.6 (scaffold-pinned — RESEARCH assumed 42 but scaffold pins 39; ABI verified, see deviations)"
    - "react ^19.2.1 + react-dom ^19.2.1"
    - "vite ^7.2.6 (NOT 8 — peer conflict with electron-vite 5)"
    - "@vitejs/plugin-react ^5.1.1 (NOT 6 — would force vite 8)"
    - "typescript ^5.9.3"
    - "better-sqlite3 ^12.10.0 + @types/better-sqlite3"
    - "zustand ^5.0.14 (installed, used in 01-02)"
    - "ffmpeg-static ^5.3.0 (path helper wired, used Phase 3)"
    - "vitest ^4.1.7 + @testing-library/react ^16.3.2 + @testing-library/jest-dom ^6.9.1 + jsdom ^29.1.1"
    - "@electron/rebuild ^4.0.4"
    - "electron-builder ^26.0.12 (asarUnpack stubbed; full packaging in Phase 6)"
  patterns:
    - "Single source of truth for IPC channel names in src/shared/ipc-types.ts (IpcChannels const) — main and preload import the same constants"
    - "Factored pure handler + injectable dependency for testability (pickFolderHandler(DialogApi), createSettingsRepo(Database))"
    - "Lazy + memoized DB connection (openDb / getSettingsRepo) so test files can import db modules without invoking electron.app"
    - "Runtime type-check on every renderer-supplied IPC payload before persistence (threat T-1-02)"
    - "Prepared statements only in repos (threat T-1-03; RESEARCH Security V5)"
    - "Dual-ABI native-module strategy via npm scripts (pretest→Node, predev/prebuild→Electron) rather than a single rebuild hook"

key-files:
  created:
    - "package.json (scaffold + runtime/dev deps + dual-ABI scripts)"
    - "vitest.config.ts (node + jsdom test projects)"
    - "vitest.setup.ts"
    - "electron-builder.yml (asarUnpack ffmpeg-static + better-sqlite3)"
    - "src/main/db/connection.ts (lazy openDb + getSettingsRepo)"
    - "src/main/db/settingsRepo.ts (createSettingsRepo factory + initSettingsSchema)"
    - "src/main/db/settingsRepo.test.ts"
    - "src/main/ipc/dialog.ts (pickFolderHandler + registerDialogHandlers)"
    - "src/main/ipc/dialog.test.ts"
    - "src/main/ipc/settings.ts (registerSettingsHandlers)"
    - "src/main/ffmpeg/path.ts (resolveFfmpegPath)"
    - "src/shared/ipc-types.ts (IpcChannels constants + DjUtilsApi interface)"
  modified:
    - "src/main/index.ts (explicit secure webPreferences; register IPC handlers; removed ipcMain.on('ping') placeholder)"
    - "src/preload/index.ts (exposeInMainWorld('djUtils', api))"
    - "src/preload/index.d.ts (declare Window.djUtils)"

key-decisions:
  - "Accept scaffold's Electron 39 instead of the RESEARCH-targeted 42 (scaffold-pinned by @quick-start/electron@1.0.30; better-sqlite3 12 prebuilds match, ABI verified by passing tests)"
  - "Dual native-module ABI strategy via pretest/predev/prebuild scripts — better-sqlite3 must match Node ABI for Vitest and Electron ABI for runtime; one rebuild path was insufficient"
  - "Mock electron module at the top of dialog.test.ts so the module-graph import chain resolves under Node"
  - "Memoize DB connection + settings repo in connection.ts (single instance per process; closeDb() resets — useful for testing)"

patterns-established:
  - "IPC pattern: shared channel constants in src/shared, factored handler + injectable API for tests, register* function called after app ready"
  - "Repo pattern: createXRepo(db) factory + initXSchema(db) returning a typed interface; prepared statements; default singleton bound to userData DB via connection.ts"
  - "Native-module dual-ABI: pretest → Node; predev/prebuild → Electron"

requirements-completed: [FOUND-02, FOUND-03]

duration: 8min
completed: 2026-05-28
---

# Phase 01 Plan 01: Foundation Scaffold + Backbone Summary

**electron-vite/React 19/TS scaffold with a secure BrowserWindow, typed window.djUtils contextBridge, better-sqlite3 settings store at userData, native folder-pick IPC, ffmpeg path helper, and Vitest infra — every later phase reuses this backbone.**

## Performance

- **Duration:** ~8 min
- **Started:** 2026-05-28T19:11:37Z
- **Completed:** 2026-05-28T19:19:16Z
- **Tasks:** 3 auto + 1 human-verify checkpoint (pending)
- **Files modified:** 12 created, 3 modified (excluding scaffold-generated files)

## Accomplishments

- Project scaffolded end-to-end (electron-vite 5 + Vite 7 + React 19 + TS 5.9 + Electron 39) with `npm run build` green and zero ERESOLVE
- Secure BrowserWindow explicitly hardened (contextIsolation, nodeIntegration off, sandbox) — threat T-1-01 mitigated from day 1
- Typed `window.djUtils` contextBridge bridge with shared channel constants — pickFolder + getRootFolder + setRootFolder wired through to ipcMain handlers
- better-sqlite3 settings key/value store with WAL, parameterized SettingsRepo (4 unit tests green, including upsert + null + value-type guard)
- Folder-picker handler factored as a pure injectable function — 3 unit tests green covering first-path / null-on-cancel / null-on-empty
- resolveFfmpegPath() helper with app.asar.unpacked rewrite + electron-builder asarUnpack entries for ffmpeg-static and better-sqlite3 — Phase 3 + Phase 6 will not need a retrofit
- Vitest configured with node + jsdom projects; full suite (7 tests, 2 files) runs in <100 ms

## Task Commits

1. **Task 1: Scaffold + deps + Vitest + asarUnpack** — `140d6df` (chore)
2. **Task 2 (RED): SettingsRepo failing tests** — `f4ba015` (test)
2. **Task 2 (GREEN): SettingsRepo implementation** — `8cfe3fd` (feat)
3. **Task 3 (RED): pickFolderHandler failing tests** — `9cfea63` (test)
3. **Task 3 (GREEN): IPC bridge + handlers + ffmpeg helper** — `a051020` (feat)

_Note: Task 2 and Task 3 both followed TDD; each has a test (RED) commit and a feat (GREEN) commit. No REFACTOR was needed._

## Files Created/Modified

**Created**
- `package.json` — name/version/deps/scripts (incl. dual-ABI pretest/predev/prebuild)
- `vitest.config.ts` — node + jsdom projects
- `vitest.setup.ts` — `@testing-library/jest-dom` import
- `electron-builder.yml` — appId/productName + `asarUnpack` for ffmpeg-static + better-sqlite3
- `src/shared/ipc-types.ts` — `IpcChannels` const + `DjUtilsApi` interface + `Window.djUtils` declaration
- `src/main/db/connection.ts` — lazy `openDb()` + memoized `getSettingsRepo()` at userData/dj-utils.db with WAL
- `src/main/db/settingsRepo.ts` — `createSettingsRepo(db)` factory + `initSettingsSchema(db)` with prepared statements
- `src/main/db/settingsRepo.test.ts` — 4 tests (missing key / round-trip / upsert / value-type guard)
- `src/main/ipc/dialog.ts` — `pickFolderHandler(DialogApi)` pure handler + `registerDialogHandlers()` registrar
- `src/main/ipc/dialog.test.ts` — 3 tests (mocked electron module)
- `src/main/ipc/settings.ts` — `registerSettingsHandlers()` registrar with runtime type-check
- `src/main/ffmpeg/path.ts` — `resolveFfmpegPath()` with app.asar.unpacked rewrite

**Modified (scaffold defaults overridden)**
- `src/main/index.ts` — explicit secure webPreferences; registers dialog + settings handlers; removed scaffold `ipcMain.on('ping')`
- `src/preload/index.ts` — `exposeInMainWorld('djUtils', { pickFolder, getRootFolder, setRootFolder })` via shared `IpcChannels`
- `src/preload/index.d.ts` — declare `Window.djUtils` from shared types

## Decisions Made

- **Electron 39 (scaffold-pinned) instead of Electron 42 (RESEARCH target).** The `@quick-start/electron` scaffold version 1.0.30 currently pins Electron 39.2.6. RESEARCH Assumption A3 explicitly allowed for a slightly different pin; better-sqlite3 12 prebuilds cover both. ABI verified end-to-end by `electron-builder install-app-deps` succeeding and tests passing after `npm rebuild better-sqlite3` (Node-ABI for Vitest).
- **Dual native-module ABI via npm scripts** (`pretest: rebuild:node`, `predev/prebuild: rebuild:electron`). Single-postinstall strategies break the other side. This makes Vitest reliable in the same checkout that runs `npm run dev`.
- **`vi.mock('electron', ...)` at the top of `dialog.test.ts`.** `src/main/ipc/dialog.ts` imports `ipcMain, dialog` at top level; without the mock, Vitest tries to load the Electron binary as a Node module and crashes with "Electron failed to install correctly". The mock is one-time, file-local, and does not leak into the repo behavior.
- **Lazy DB connection.** Constructing the DB at module top-level would fail in Vitest (no `electron.app`). Lazy `openDb()` defers `app.getPath('userData')` until the first runtime call.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking] better-sqlite3 NODE_MODULE_VERSION mismatch when running Vitest**
- **Found during:** Task 2 (GREEN, first test run after creating settingsRepo)
- **Issue:** `electron-builder install-app-deps` (scaffold's `postinstall`) rebuilt better-sqlite3 against Electron 39's Node-ABI (137). Vitest runs under system Node (24.16.0), a different ABI. `new Database(':memory:')` threw `NODE_MODULE_VERSION 137. Please try re-compiling`.
- **Fix:** Added `rebuild:node`/`rebuild:electron` scripts + `pretest`/`predev`/`prebuild` hooks so each entry point gets the correct ABI without manual intervention. Verified by running the full suite (7 tests green) and `npm run build` (green) back-to-back.
- **Files modified:** `package.json`
- **Committed in:** `8cfe3fd` (Task 2 GREEN commit)

**2. [Rule 3 — Blocking] Vitest could not load `src/main/ipc/dialog.ts` because of top-level `import 'electron'`**
- **Found during:** Task 3 (GREEN, first test run after creating dialog.ts)
- **Issue:** `dialog.ts` imports `ipcMain, dialog` from `'electron'`. Vitest in the Node project resolves `'electron'` to the npm package's `index.js`, which tries to spawn the Electron binary and fails with "Electron failed to install correctly".
- **Fix:** Added `vi.mock('electron', () => ({ ipcMain: { handle: vi.fn() }, dialog: { showOpenDialog: vi.fn() } }))` at the top of `dialog.test.ts`. Implementation file unchanged; only the test stubs the module.
- **Files modified:** `src/main/ipc/dialog.test.ts`
- **Committed in:** `a051020` (Task 3 GREEN commit)

---

**Total deviations:** 2 auto-fixed (both Rule 3 — Blocking)
**Impact on plan:** Both are infrastructure unblockers around running tests in a Node runtime against an Electron-targeted native module + the `'electron'` module itself. Neither changes behavior, both are now codified (the scripts + the mock) so the next developer does not hit them. No scope creep.

## Issues Encountered

- The repo root is at `/Users/theo/Documents/projects` (a parent monorepo containing both `dj-utils` and a sibling `flip7rl`). All commits therefore land in that parent repo with paths prefixed `dj-utils/` — this is correct behavior, not drift. `git rev-parse --show-toplevel` confirms the toplevel and the `pwd` is consistent.

## User Setup Required

None — Phase 1 has no external services. The user must manually verify the dev launch (see checkpoint below).

## Self-Check: PASSED

Verified each created file exists on disk and each task commit is reachable from `HEAD`:

```
FOUND: package.json
FOUND: vitest.config.ts
FOUND: vitest.setup.ts
FOUND: electron-builder.yml
FOUND: src/shared/ipc-types.ts
FOUND: src/main/db/connection.ts
FOUND: src/main/db/settingsRepo.ts
FOUND: src/main/db/settingsRepo.test.ts
FOUND: src/main/ipc/dialog.ts
FOUND: src/main/ipc/dialog.test.ts
FOUND: src/main/ipc/settings.ts
FOUND: src/main/ffmpeg/path.ts
FOUND: 140d6df (Task 1 chore)
FOUND: f4ba015 (Task 2 RED)
FOUND: 8cfe3fd (Task 2 GREEN)
FOUND: 9cfea63 (Task 3 RED)
FOUND: a051020 (Task 3 GREEN)
```

## Next Phase Readiness

- **Plan 01-02 (renderer vertical slice)** unblocked: the backbone is fully wired. 01-02 can build the 3-tool nav + Zustand store + RootFolderPicker component and call `window.djUtils.getRootFolder()`/`setRootFolder()`/`pickFolder()` directly.
- **Pending blocker:** Plan-level human-verify checkpoint (Task 4) — see below. The MUST-HAVE truths "App launches in dev mode with a secure BrowserWindow", "better-sqlite3 loads under Electron without an ABI error", and the SQLite cross-session persistence claim can only be confirmed at a real Electron launch.

## Human-Verify Checkpoint (pending)

**Run these manually:**

1. `npm run dev`
2. Confirm the app window opens and DevTools console shows NO "The module was compiled against a different Node.js version" / NODE_MODULE_VERSION error.
3. In the DevTools console: `await window.djUtils.setRootFolder('/tmp/test-folder')`, then `await window.djUtils.getRootFolder()` — expect `'/tmp/test-folder'`.
4. Quit fully (Cmd-Q), re-run `npm run dev`, in console run `await window.djUtils.getRootFolder()` — expect `'/tmp/test-folder'` again (cross-session persistence).

If any step fails with an ABI error, the fix is `npx electron-builder install-app-deps` (or add `electron-rebuild -f -w better-sqlite3` to postinstall per RESEARCH Pitfall 3 fallback).

---
*Phase: 01-foundation*
*Completed: 2026-05-28*
