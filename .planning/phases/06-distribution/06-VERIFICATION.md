---
phase: 06-distribution
verified: 2026-06-24T17:05:00Z
status: human_needed
score: 3/3 success criteria verified (macOS end-to-end; Windows verified via CI build + published artifact, pending one human install on Windows hardware)
overrides_applied: 0
human_verification:
  - test: "Windows install smoke-test on real Windows x64 hardware"
    expected: "Run CrateKeeper-Setup-1.0.0.exe from the published Releases page → SmartScreen → More info → Run anyway → per-user install (no admin) → app launches with the three-tool nav → convert one file to MP3 320 produces output with no system FFmpeg → app does not crash/block on the update check when offline or at version parity (D-08)."
    why_human: "The .exe built green on GitHub Actions windows-latest and is published + downloadable, but the SmartScreen-bypass + first-launch + bundled-ffmpeg conversion path on actual Windows hardware is the one DIST-01/DIST-02 behavior not directly exercised by the Mac-only maintainer. CI proves the artifact builds and packages; it does not exercise the end-user install gesture. Naturally covered when the first Windows user downloads the published installer."
---

# Phase 6: Distribution Verification Report

**Phase Goal:** Non-developer DJs on macOS and Windows can install the app from a single installer file with no manual dependency setup.
**Verified:** 2026-06-24T17:05:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria + PLAN must_haves)

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| SC-1 | macOS user downloads a .dmg, drags app to Applications, runs it — no Homebrew/Node/FFmpeg | ✓ VERIFIED | Published non-draft v1.0.0 carries `CrateKeeper-1.0.0-universal.dmg` (253 MB, gh API). Build-time assertions pass on `dist/mac-universal/CrateKeeper.app`: ffmpeg present + fat (`x86_64 arm64`) in `app.asar.unpacked`, better_sqlite3.node fat, `.node` entries are unpacked stubs (no native binary inside the asar archive — confirmed via asar header `unpacked:true` flag). Human-verified at the 06-01 checkpoint (installs via right-click→Open, converts a file, renders waveform, no system deps). |
| SC-2 | Windows user runs a .exe installer and launches — conversion + scanning work out of the box | ⚠️ VERIFIED (artifact) / human residual | Published v1.0.0 carries `CrateKeeper-Setup-1.0.0.exe` (122 MB, gh API). The `Release` workflow run for tag `v1.0.0` completed `conclusion: success` on the `windows-latest` runner (built + published the .exe + latest.yml). `electron-builder.yml` win block = nsis x64, perMachine:false (per-user, no admin). The artifact builds, packages, and is downloadable; the one un-exercised behavior is a human install on Windows hardware (→ human_verification). |
| SC-3 | FFmpeg bundled inside the installer + resolves correctly at runtime on both platforms | ✓ VERIFIED | `electron-builder.yml asarUnpack: node_modules/ffmpeg-static/**` matches the runtime rewrite in `src/main/conversion/ffmpegPath.ts` (`app.asar` → `app.asar.unpacked`). Resolved path `.../app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg` confirmed present + fat in the packaged app. Conversion + waveform both consume this resolved binary (`index.ts` wires `resolveFfmpegPath` into the conversion controller and tagger). macOS path human-verified; Windows ffmpeg-static ships win32-x64 binary, unpacked by the same glob. |

**Score:** 3/3 success criteria verified (SC-1 fully end-to-end on macOS; SC-2 artifact + CI verified, one human install pending; SC-3 wiring + macOS runtime verified).

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `electron-builder.yml` | mac universal dmg (identity:null, hardenedRuntime:false), win nsis x64, asarUnpack ffmpeg + `**/*.node`, github publish Theosantos/CrateKeeper releaseType:release | ✓ VERIFIED | All tokens present. Adds `mac.x64ArchFiles: **/test_extension.node` (documented escape hatch for better-sqlite3's byte-identical test fixture — SUMMARY deviation #2, sound). |
| `scripts/prepare-universal-ffmpeg.sh` | Downloads both darwin arches from b6.1.1, lipo -create, idempotent, Darwin-only | ✓ VERIFIED | `set -euo pipefail`, `curl -fL` both arches, `lipo -create`, idempotent skip when already fat, cleans intermediates, executable. |
| `package.json` | version 1.0.0, build:mac with ffmpeg pre-step + universal, electron-updater in dependencies | ✓ VERIFIED | version `1.0.0`; `build:mac` = `bash scripts/prepare-universal-ffmpeg.sh && electron-vite build && electron-builder --mac --universal` (corrected from plan's invalid `--arch universal` — SUMMARY deviation #1); `electron-updater@^6.8.9` in `dependencies` (not devDependencies). |
| `src/main/update/updater.ts` | initWindowsUpdater + checkForUpdatesMacOS, guarded, graceful-degrade (D-06/07/08) | ✓ VERIFIED | Both named exports present, `app.isPackaged` + `process.platform` guards, `AbortSignal.timeout(5000)`, silent macOS catch, `shell.openExternal`, `quitAndInstall`. Post-review fixes applied (semver `isNewer`, `.catch` on dialog + openExternal, narrowed `res.json`). |
| `src/main/index.ts` | updater wired after createWindow() inside whenReady | ✓ VERIFIED | Import grouped with ES imports (lint-correct); `initWindowsUpdater()` + `checkForUpdatesMacOS()` both fire after `mainWindow = createWindow()`. |
| `.github/workflows/release.yml` | matrix(mac,win), publish on v* tag | ✓ VERIFIED | matrix macos-latest + windows-latest; `--publish always` on tag/dispatch-publish; concurrency guard + `if-no-files-found: warn` (review hardening applied). |
| `README.md` | Download & Install: Releases link, both installer names, macOS right-click→Open, Windows SmartScreen→Run anyway, no "double-click to open" | ✓ VERIFIED | All required tokens present; no double-click-to-open instruction; bypass scoped to official Releases. Present in both working tree and v1.0.0 tag. |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `electron-builder.yml asarUnpack` | `ffmpegPath.ts` resolveFfmpegPath | `node_modules/ffmpeg-static` glob ↔ `app.asar`→`app.asar.unpacked` rewrite | ✓ WIRED | Resolved runtime path exists in packaged app; ffmpeg fat + unpacked. |
| `package.json build:mac` | `prepare-universal-ffmpeg.sh` | bash pre-step | ✓ WIRED | Pre-step present in script chain. |
| `index.ts app.whenReady` | `updater.ts` | calls after createWindow() | ✓ WIRED | Order check: both updater calls after `mainWindow = createWindow()`. |
| `initWindowsUpdater` | app-update.yml (embedded by electron-builder) | `checkForUpdatesAndNotify()` guarded by `app.isPackaged` | ✓ WIRED | Guard present; NSIS feed from electron-builder publish config. |
| electron-builder publish | GitHub Releases v1.0.0 | `--publish always` + GH_TOKEN | ✓ WIRED | CI run for tag v1.0.0 = success; release published with 4 assets + blockmaps. |
| README download | github.com/Theosantos/CrateKeeper/releases | documented first-launch steps | ✓ WIRED | Link + per-platform steps present. |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| Test suite green | `npx vitest run` | 554 passed (39 files) | ✓ PASS |
| Typecheck clean | `npm run typecheck` | node + web, no errors | ✓ PASS |
| ffmpeg fat in packaged app | `lipo -info .../app.asar.unpacked/.../ffmpeg` | `x86_64 arm64` | ✓ PASS |
| better_sqlite3.node fat | `lipo -info .../better_sqlite3.node` | `x86_64 arm64` | ✓ PASS |
| no native binary inside asar | asar header `unpacked` flag check | both `.node` are unpacked stubs | ✓ PASS |
| updater module exports | static grep | initWindowsUpdater + checkForUpdatesMacOS + guards present | ✓ PASS |
| Live release state | `gh release view v1.0.0` | isDraft:false, isPrerelease:false, 4 assets + 2 blockmaps | ✓ PASS |
| CI release run | `gh run list --workflow release.yml` | v1.0.0 push run conclusion:success | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| DIST-01 | 06-01, 06-02, 06-03 | App distributable via .dmg (macOS) + .exe (Windows) with no prior install | ✓ SATISFIED (macOS end-to-end; Windows artifact+CI, human install pending) | Published v1.0.0 with both installers; macOS human-verified; Windows .exe built green + downloadable. |
| DIST-02 | 06-01, 06-02, 06-03 | FFmpeg bundled in the installer — no system dependency | ✓ SATISFIED | Fat ffmpeg unpacked + runtime-resolved; macOS conversion + waveform verified with no system FFmpeg. Windows ffmpeg-static x64 unpacked by same glob (resolution path shared, runtime-confirmed on macOS). |

No orphaned requirements: REQUIREMENTS.md maps only DIST-01 + DIST-02 to Phase 6; both are claimed by all three plans' frontmatter and accounted for.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| (none) | — | No TODO/FIXME/XXX/HACK/PLACEHOLDER/TBD in any phase-6 modified source file | — | Clean — completion is auditable. |

Note: README contains a "Placeholder mockups" line for screenshots (`docs/screenshots/*.svg`). This is intentional public-README polish (decorative placeholder graphics), not a code stub, and is unrelated to DIST-01/DIST-02. Info-only.

### Code-Review Remediation (06-REVIEW.md cross-check)

06-REVIEW.md (status: issues_found, 1 critical + 6 warnings) was raised after the v1.0.0 tag. All actionable findings are FIXED in the current committed HEAD (`a43beb9 fix(06): address code review`):

| Finding | Status in HEAD |
| ------- | -------------- |
| CR-01 macOS update check string `!==` (false "update available") | ✓ FIXED — `isNewer()` numeric-segment semver compare; raw string-compare removed |
| WR-01 update-downloaded dialog no `.catch` | ✓ FIXED — `.catch` added |
| WR-02 shell.openExternal result discarded | ✓ FIXED — `void ...catch` added |
| WR-03 `res.json()` asserted not narrowed | ✓ FIXED — `unknown` + `'tag_name' in data` narrowing |
| WR-04 `if-no-files-found: ignore` masks empty build | ✓ FIXED — set to `warn` |
| WR-05 no concurrency guard (double-publish race) | ✓ FIXED — `concurrency: group: release-${{ github.ref }}` |

**Provenance note (informational, not a gap):** the published **v1.0.0 tag (`cb9c80b`) predates these fixes** and therefore ships the pre-fix updater (CR-01 string-compare). This affects only the *macOS notify-only update prompt* (D-07/D-08), which is NOT a DIST-01/DIST-02 requirement and does not impair install or conversion. The corrected updater is committed on the branch and will ship with the next tagged release. No action required for this phase's goal; flagged so the maintainer knows the live build's updater nicety lags the fixed source.

### Human Verification Required

#### 1. Windows install smoke-test on real Windows hardware

**Test:** Download `CrateKeeper-Setup-1.0.0.exe` from the published Releases page on a Windows x64 machine → on SmartScreen click **More info** → **Run anyway** → complete the per-user install (no admin prompt) → launch CrateKeeper and confirm the three-tool nav → pick a folder, scan, convert one file to MP3 320 and confirm output is produced → confirm the app does not crash or block on the update check when offline or at version parity.
**Expected:** Installs per-user, launches, converts using the bundled win32-x64 FFmpeg (no system FFmpeg), and degrades gracefully on the update check (D-08).
**Why human:** The .exe built green in CI and is published + downloadable, but the SmartScreen-bypass + first-launch + bundled-ffmpeg conversion gesture on actual Windows hardware is the single DIST-01/DIST-02 behavior the Mac-only maintainer cannot directly exercise. CI verifies the build/package; it does not perform an end-user install. Naturally covered when the first Windows user runs the published installer.

### Gaps Summary

No blocking gaps. The phase goal — single-file install with no manual dependency setup — is delivered and live:

- macOS: fully verified end-to-end (published .dmg, human-verified install/convert/waveform, fat asar-unpacked ffmpeg resolving at runtime, zero system deps).
- Windows: the published .exe builds green in CI (`windows-latest`), is downloadable from the live non-draft v1.0.0 release, and is configured for per-user no-admin install with the same bundled-ffmpeg unpack glob. The only un-exercised step is a human install on Windows hardware → routed to human_verification (not a code gap).
- FFmpeg bundling + runtime resolution verified at the config↔resolver key-link level and in the packaged macOS app.
- Full test suite (554) and typecheck pass; no debt markers; all 06-REVIEW findings remediated in committed source.

Status is **human_needed** (not passed) solely because a Windows-hardware install smoke-test remains — the decision-tree mandates human_needed whenever a human verification item exists, even with all truths otherwise verified.

---

_Verified: 2026-06-24T17:05:00Z_
_Verifier: Claude (gsd-verifier)_
