---
phase: 01-foundation
plan: 02
subsystem: ui
tags: [react, zustand, electron, vitest, ipc, design-tokens]

# Dependency graph
requires:
  - phase: 01-foundation
    provides: "Plan 01-01 — secure window.djUtils bridge (pickFolder/getRootFolder/setRootFolder) + better-sqlite3 settings store"
provides:
  - "Renderer vertical slice: three-tool nav shell (Analyser/Convertir/Tagger) backed by Zustand"
  - "RootFolderPicker component invoking the native dialog through window.djUtils"
  - "Mount-time folder hydration (FOUND-03) in App.tsx"
  - "Editorial dark-studio design tokens in :root (CSS custom properties) as the styling baseline for later phases"
  - "App + store test infra under jsdom Vitest project (typed MockedApi, globals on)"
affects: [02-scanning, 03-conversion, 04-tagger]

# Tech tracking
tech-stack:
  added: [zustand, @testing-library/react, jest-dom matchers via vitest.setup.ts]
  patterns:
    - "Renderer never imports electron/Node — only window.djUtils (T-1-04 mitigation, grep-enforced)"
    - "State-based view switching from useAppStore.activeTool (no React Router in renderer)"
    - "Components consume the store, not the bridge directly (RootFolderPicker / NavBar do not reference window.djUtils)"
    - "Design tokens centralised in :root custom properties; kebab-case classes; semantic header/nav/main"

key-files:
  created:
    - src/renderer/src/store/useAppStore.ts
    - src/renderer/src/store/useAppStore.test.ts
    - src/renderer/src/components/nav/NavBar.tsx
    - src/renderer/src/components/folder/RootFolderPicker.tsx
    - src/renderer/src/views/AnalyserView.tsx
    - src/renderer/src/views/ConvertirView.tsx
    - src/renderer/src/views/TaggerView.tsx
    - src/renderer/src/App.test.tsx
  modified:
    - src/renderer/src/App.tsx
    - src/renderer/src/assets/main.css
    - src/preload/index.ts
    - package.json

key-decisions:
  - "Sandboxed preloads cannot require external modules — preload imports only 'electron' and shared types; @electron-toolkit/preload removed."
  - "predev/prebuild uses electron-rebuild -f -w better-sqlite3 (not electron-builder install-app-deps, which silently no-ops)."
  - "Vitest jsdom project enables globals:true so tests can use describe/it/expect without per-file imports."
  - "MockedApi typed against DjUtilsApi (shared/ipc-types) — guarantees test stubs match the real bridge signature."
  - "Editorial dark-studio direction (not default Tailwind/shadcn template) — :root design tokens for palette, type scale, spacing, motion."

patterns-established:
  - "Mount-effect hydration: App.tsx useEffect → store.loadRootFolder() on first paint"
  - "Async store action wrapping bridge calls: pickRootFolder() awaits pickFolder, persists via setRootFolder, only mutates state on success"
  - "fireEvent.click in unit tests (user-event not required for simple nav clicks at this slice)"

requirements-completed: [FOUND-01, FOUND-02, FOUND-03]

# Metrics
duration: ~35min
completed: 2026-05-29
---

# Phase 1 Plan 02: Renderer Walking Skeleton Summary

**Three-tool Electron renderer (Analyser/Convertir/Tagger) wired to a Zustand store that drives the native folder picker and mount-time hydration through the typed window.djUtils bridge.**

## Performance

- **Duration:** ~35 min (incl. post-checkpoint fixes)
- **Completed:** 2026-05-29
- **Tasks:** 3 implementation + 1 human-verify checkpoint (approved)
- **Files created/modified:** 11

## Accomplishments
- FOUND-01: navigation with three distinct tool areas, clicking switches the visible view
- FOUND-02: "Choisir un dossier" button opens the native OS dialog and renders the chosen path
- FOUND-03: chosen folder reappears across a full app relaunch (verified Cmd-Q + `npm run dev`)
- Editorial dark-studio styling baseline (design tokens in :root) — no default-template look
- 14/14 Vitest tests green across the unit + jsdom projects; `npm run build` green

## Task Commits

1. **Task 1 — useAppStore (Zustand)** TDD pair
   - RED: `c0c082b` test(01-02): failing tests for useAppStore (activeTool transitions + folder hydration/pick)
   - GREEN: `4515665` feat(01-02): implement useAppStore (Zustand activeTool + rootFolder via window.djUtils)
2. **Task 2 — Nav shell + RootFolderPicker + mount hydration + design tokens**
   - `f0fa870` feat(01-02): three-tool nav shell + folder picker + mount hydration with editorial dark studio styling
3. **Task 3 — App render test (FOUND-01 automated)** TDD
   - `4f0aab5` test(01-02): App render test — three tools visible, default Analyser view, nav switch to Tagger (FOUND-01)

### Post-checkpoint follow-up commits (outside the original executor session)
- `1493815` fix(01-01): drop @electron-toolkit/preload from preload (sandbox:true incompatibility) + trim scaffold Versions — unblocked dev launch so the human-verify checkpoint could complete
- `96e5e79` chore: switch rebuild:electron to `electron-rebuild -f` (electron-builder install-app-deps silently short-circuited, leaving better-sqlite3 on the wrong ABI after `npm test`)
- `1ea036f` feat(folder-picker): pin first + leaf path segments and ellipsize the middle (UX follow-up for long paths)

## Files Created/Modified

- `src/renderer/src/store/useAppStore.ts` — Zustand store: activeTool, rootFolder, setActiveTool, loadRootFolder, pickRootFolder
- `src/renderer/src/store/useAppStore.test.ts` — 4 behaviors covered with typed MockedApi
- `src/renderer/src/components/nav/NavBar.tsx` — semantic `<nav aria-label>` with three items + designed active state (aria-current)
- `src/renderer/src/components/folder/RootFolderPicker.tsx` — folder-pick button + path display (with middle-ellipsis for long paths)
- `src/renderer/src/views/{Analyser,Convertir,Tagger}View.tsx` — labelled placeholder sections (real content lands in Phases 2/3/4)
- `src/renderer/src/App.tsx` — `<header>` (NavBar + RootFolderPicker) + `<main>` switching on activeTool + mount-effect hydration
- `src/renderer/src/App.test.tsx` — three-tools-visible + default-view + nav-switch (FOUND-01 automated)
- `src/renderer/src/assets/main.css` — :root design tokens (palette, type scale, spacing, motion) + component styles
- `src/preload/index.ts` — trimmed scaffold Versions; removed @electron-toolkit/preload (sandbox-incompatible)
- `package.json` — `predev`/`prebuild` now run `electron-rebuild -f -w better-sqlite3` (reliable ABI swap)

## Decisions Made

See `key-decisions` in frontmatter. The two most consequential for future phases:
1. Sandboxed preload constraint — any future preload helper must be inlined into `src/preload/index.ts` or shipped as a bundle that the preload entry imports relatively; external CommonJS modules are not loadable under `sandbox:true`.
2. Native-module ABI flow — `npm test` rebuilds better-sqlite3 for Node ABI (137); the very next `npm run dev` runs `predev → electron-rebuild -f -w better-sqlite3` to swap back to the Electron ABI (140). This is the canonical sequence; do not interleave manual installs.

## Deviations from Plan

### Auto-fixed during the original executor run
**1. [Rule 3 — Blocking] Vitest jsdom project missing globals**
- **Found during:** Task 1 (`npm run test -- --run src/renderer/src/store`)
- **Issue:** Tests used bare `describe`/`it`/`expect` (per common testing.md style) but the jsdom Vitest project did not enable `globals`.
- **Fix:** Added `globals: true` to the jsdom project in `vitest.config.ts`.
- **Committed in:** `4515665` (folded into Task 1 GREEN)

**2. [Rule 2 — Missing Critical] Typed MockedApi against DjUtilsApi**
- **Found during:** Task 1
- **Issue:** Plan said "stub window.djUtils with vi.fn()". A loosely-typed stub would drift away from the real bridge over time.
- **Fix:** Declared `MockedApi` as `{ [K in keyof DjUtilsApi]: ReturnType<typeof vi.fn> }` (imported from src/shared/ipc-types). Type-checks all mocks against the real surface.
- **Committed in:** `c0c082b` + `4515665`

**3. [Rule 3 — Style/blocking] fireEvent in lieu of user-event**
- **Found during:** Task 3
- **Issue:** Plan suggested `getByRole` queries; user-event would add a fresh dep for a single nav click.
- **Fix:** Used `fireEvent.click` from `@testing-library/react` (already a transitive dep). Simpler, no extra install.
- **Committed in:** `4f0aab5`

### Resolved during/after the human-verify checkpoint
**4. [Post-checkpoint blocker] Preload crashed on launch — `Cannot find module @electron-toolkit/preload`**
- **Found during:** First `npm run dev` after Plan 01-02 implementation
- **Issue:** The scaffold-default preload imported `@electron-toolkit/preload`, but our preload runs with `sandbox: true`, which prohibits external module loading.
- **Fix:** Removed the import and trimmed scaffold-default `Versions` bridge exposure. Preload now imports only `electron` + shared IPC types.
- **Committed in:** `1493815`

**5. [Post-checkpoint blocker] Wrong native ABI for better-sqlite3 after `npm test`**
- **Found during:** Returning to `npm run dev` after a test run
- **Issue:** `electron-builder install-app-deps` short-circuited silently when better-sqlite3 was already on the Node ABI from the test pass — leaving the Electron runtime broken with NODE_MODULE_VERSION mismatch.
- **Fix:** Switched `rebuild:electron` (used by `predev`/`prebuild`) to `electron-rebuild -f -w better-sqlite3`, which always forces a clean rebuild against the Electron ABI.
- **Committed in:** `96e5e79`

**6. [Post-checkpoint UX] Long folder paths truncated unhelpfully**
- **Found during:** Checkpoint verification — user picked a deep folder and the displayed path elided the leaf segment.
- **Fix:** RootFolderPicker now pins the first and last segments and ellipsizes the middle, so the meaningful tail of the path stays visible.
- **Committed in:** `1ea036f`

---

**Total deviations:** 6 (3 auto-fixed in-session, 3 resolved during/after checkpoint)
**Impact on plan:** All deviations were correctness / unblocking work for the actual checkpoint verification. No scope creep into Phase 2 territory.

## Issues Encountered

- The dev-launch crash (#4) was the reason the human-verify checkpoint initially could not proceed. Once the preload was trimmed, the three success criteria passed cleanly.
- The native-ABI flip-flop (#5) was a latent issue from Plan 01-01's dual-ABI strategy — Plan 01-02 surfaced it the first time a test run preceded a dev launch.

## Verification

- `npm run test -- --run` — **14/14 green** (jsdom + node projects)
- `npm run build` — **green**
- Manual (checkpoint, user-approved):
  - FOUND-01 ✓ three-tool nav (Analyser/Convertir/Tagger), view switching works
  - FOUND-02 ✓ native folder picker opens via `window.djUtils.pickFolder`, selected path appears in UI
  - FOUND-03 ✓ folder persists across full app relaunch (Cmd-Q + `npm run dev`)

## User Setup Required

None — no external service configuration required. Local dev is fully self-contained (Electron + bundled better-sqlite3).

## Next Phase Readiness

- Walking skeleton end-to-end proven: renderer → window.djUtils → main → SQLite → restart hydration.
- Phase 2 (File Scanning & Library View) can build directly on `useAppStore.rootFolder` as the input to a scan command, and add a new view alongside the existing three-tool nav.
- No blockers carried forward.

## Self-Check: PASSED

- src/renderer/src/store/useAppStore.ts — FOUND
- src/renderer/src/store/useAppStore.test.ts — FOUND
- src/renderer/src/App.test.tsx — FOUND
- src/renderer/src/components/nav/NavBar.tsx — FOUND
- src/renderer/src/components/folder/RootFolderPicker.tsx — FOUND
- src/renderer/src/views/AnalyserView.tsx — FOUND
- src/renderer/src/views/ConvertirView.tsx — FOUND
- src/renderer/src/views/TaggerView.tsx — FOUND
- Commits c0c082b / 4515665 / f0fa870 / 4f0aab5 / 1493815 / 96e5e79 / 1ea036f — all FOUND in `git log`

---
*Phase: 01-foundation*
*Completed: 2026-05-29*
