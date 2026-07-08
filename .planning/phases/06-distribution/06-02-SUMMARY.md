---
phase: 06-distribution
plan: 02
subsystem: infra
tags: [electron-updater, nsis, auto-update, github-actions, ci, windows, github-api]

requires:
  - phase: 06-distribution
    provides: electron-builder.yml (win nsis + github publish), package.json 1.0.0
provides:
  - electron-updater Windows NSIS auto-update + macOS notify-only version check
  - .github/workflows/release.yml (CI build of macOS .dmg + Windows .exe)
  - Windows CrateKeeper-Setup-1.0.0.exe built green on windows-latest
affects: [06-03-release]

tech-stack:
  added: [electron-updater@^6.8.9]
  patterns:
    - "Cross-platform update split: electron-updater NSIS feed on Windows (D-06), GitHub-API notify-only on macOS (D-07, no Squirrel.Mac)"
    - "Graceful-degrade update checks: app.isPackaged + process.platform guards, AbortSignal.timeout, silent/console-only catch — never block the app (D-08)"
    - "CI release matrix: build macOS universal .dmg + Windows NSIS .exe on GitHub runners; tag push publishes, dispatch builds artifacts"

key-files:
  created:
    - src/main/update/updater.ts
    - .github/workflows/release.yml
  modified:
    - src/main/index.ts
    - package.json

key-decisions:
  - "electron-updater verified on npmjs.com (official electron-userland monorepo package) before install — blocking-human legitimacy gate, never auto-approvable"
  - "Windows .exe produced via GitHub Actions (windows-latest) instead of a local Windows host — NSIS cannot be cross-compiled from macOS"
  - "GITHUB_TOKEN (contents: write) publishes to the same repo's Releases — no separate PAT needed for CI"

patterns-established:
  - "Updater module: two named functions (initWindowsUpdater / checkForUpdatesMacOS), no class/default export, matching ffmpegPath.ts + audioProtocol.ts"
  - "release.yml: matrix(mac,win) + publish-on-tag / build-on-dispatch, ref_type guard so branch pushes never publish"

requirements-completed: [DIST-01, DIST-02]

duration: ~20min
completed: 2026-06-24
---

# Phase 06 / Plan 02: Windows .exe + Cross-Platform Auto-Update Summary

**electron-updater wired for Windows NSIS auto-update + macOS notify-only GitHub-API check (both graceful-degrade), plus a GitHub Actions release pipeline that built the Windows `CrateKeeper-Setup-1.0.0.exe` green on windows-latest.**

## Performance

- **Duration:** ~20 min active (plus a CI release run)
- **Completed:** 2026-06-24
- **Tasks:** 3 (1 legitimacy gate + 1 auto + 1 CI/human-verify)
- **Files modified:** 4

## Accomplishments
- Package-legitimacy gate cleared: developer verified `electron-updater` on npmjs.com as the official electron-userland auto-updater before any install.
- `src/main/update/updater.ts`: `initWindowsUpdater()` (NSIS feed, autoDownload, restart-to-install dialog, error→console only) and `checkForUpdatesMacOS()` (GitHub-API latest-tag compare, opens Releases on confirm). Both guarded by `app.isPackaged` + `process.platform`; macOS path has a 5 s `AbortSignal.timeout` + silent catch (D-08).
- Wired both into `src/main/index.ts` after `createWindow()` (dialogs get a parent window); fire-and-forget. typecheck + 554 tests green.
- `.github/workflows/release.yml`: matrix build of the macOS universal `.dmg` and the Windows NSIS `.exe`. Tag push → build **+ publish**; manual dispatch → build-only artifacts.
- **Windows build verified green** on `windows-latest` via the `v1.0.0` tag run; `CrateKeeper-Setup-1.0.0.exe` + `latest.yml` produced and published.

## Task Commits

1. **Task 1: package legitimacy gate** — no commit (protocol gate; approved on npmjs.com)
2. **Task 2: electron-updater module + wiring** — `ff1ceb9` (feat)
3. **Task 3: Windows build via CI** — `bcc77e2` (ci: release workflow) + `2140f15` (ci: node24 action majors); artifact built green by the `v1.0.0` Actions run.

## Files Created/Modified
- `src/main/update/updater.ts` — Windows NSIS updater + macOS notify-only checker (named exports, guards, D-08 graceful degrade).
- `src/main/index.ts` — import + fire-and-forget calls after `createWindow()`.
- `package.json` — `electron-updater@^6.8.9` in production dependencies.
- `.github/workflows/release.yml` — CI build/publish of both installers.

## Decisions Made
- Built the Windows artifact on GitHub Actions (`windows-latest`) rather than a local Windows host — the maintainer is Mac-only and NSIS can't be cross-compiled. The same workflow doubles as the publish path for Plan 06-03.
- Grouped the updater import with the other ES imports in `index.ts` (not after the `require('ffmpeg-static')` line as PATTERNS suggested) to avoid tripping the `import/first` lint rule. Behavior identical; wiring-order check (after `createWindow()`) still satisfied.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - User-directed] Windows build via GitHub Actions instead of a local Windows host**
- **Found during:** Task 3
- **Issue:** Plan assumed the developer runs `npm run build:win` on a Windows/CI host; the maintainer has only a Mac.
- **Fix:** Authored `.github/workflows/release.yml` (matrix mac+win) per the developer's choice. A tagged `v1.0.0` run built the `.exe` green and published it.
- **Verification:** GitHub Actions run for tag `v1.0.0` — both jobs `success`; release carries the `.exe` + `latest.yml`.
- **Committed in:** `bcc77e2`, `2140f15`

**2. [Rule 1 - Lint] Import placement in index.ts**
- **Found during:** Task 2
- **Issue:** PATTERNS said to insert the updater import after `const ffmpegStatic = require(...)`, which would put an ES import after a statement (`import/first` violation).
- **Fix:** Placed the import with the other ES imports. All Task-2 wiring assertions still pass.
- **Committed in:** `ff1ceb9`

---

**Total deviations:** 2 (1 user-directed scope, 1 lint-cleanliness)
**Impact on plan:** The CI workflow is additive and is the agreed path to the Windows artifact; it also serves Plan 06-03's publish. No behavioral change to the app beyond the planned updater wiring.

## Issues Encountered
- CI surfaced non-blocking warnings (node20 action runtime deprecation; macos-latest migration notice). Bumped the actions to their node24 majors (`@v5`) to silence the first; the macOS notice is informational and left as-is.

## User Setup Required
None beyond what CI provides. The release uses the runner's `GITHUB_TOKEN`; no separate PAT was needed. (A `GH_TOKEN` PAT would only be needed for publishing from a local machine.)

## Next Phase Readiness
- v1.0.0 is published non-draft with `latest.yml` + `latest-mac.yml`, so the updater feed resolves.
- Plan 06-03: README done and release published; the only remaining item is the macOS notify-only update verification against the live release (06-03 Task 3).
- Residual human verification: a real Windows install smoke-test (SmartScreen → Run anyway → convert) still needs a Windows machine — naturally covered when a Windows user downloads the published `.exe`.

---
*Phase: 06-distribution*
*Completed: 2026-06-24*
