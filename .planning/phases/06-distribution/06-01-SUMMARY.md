---
phase: 06-distribution
plan: 01
subsystem: infra
tags: [electron-builder, ffmpeg-static, lipo, universal-binary, dmg, macos, better-sqlite3]

requires:
  - phase: 05-tag-writing-rekordbox-compatibility
    provides: complete app surface (analyse/convert/tagger) to package
provides:
  - macOS Universal CrateKeeper-1.0.0-universal.dmg (unsigned v1)
  - electron-builder.yml shared distribution config (mac + win + github publish)
  - scripts/prepare-universal-ffmpeg.sh fat-ffmpeg merge
  - package.json version 1.0.0 + universal build:mac script
affects: [06-02-windows-autoupdate, 06-03-release]

tech-stack:
  added: []
  patterns:
    - "Pre-build fat-binary merge: download both darwin arches from ffmpeg-static b6.1.1 and lipo -create before electron-builder --universal"
    - "Unsigned v1 packaging stays signing-ready: identity:null + hardenedRuntime:false, entitlements plist retained (D-03)"

key-files:
  created:
    - electron-builder.yml
    - scripts/prepare-universal-ffmpeg.sh
  modified:
    - package.json

key-decisions:
  - "electron-builder.yml scaffold default overwritten with intended distribution config (appId com.theosantos.cratekeeper, github publish Theosantos/CrateKeeper) — plan said 'create' but a @quick-start scaffold default already existed"
  - "build:mac uses electron-builder --universal (NOT the plan's invalid --arch universal flag)"
  - "mac.x64ArchFiles: **/test_extension.node added so @electron/universal merges past better-sqlite3's byte-identical test fixture"
  - "Dropped scaffold's npmRebuild:false — it would prevent the per-arch native-module rebuild the universal build requires"

patterns-established:
  - "Universal macOS build: fat ffmpeg via lipo + electron-builder per-arch native rebuild + @electron/universal merge, with x64ArchFiles escape hatch for identical fixtures"

requirements-completed: [DIST-01, DIST-02]

duration: ~25min
completed: 2026-06-24
---

# Phase 06 / Plan 01: macOS Universal .dmg Summary

**Unsigned macOS Universal `CrateKeeper-1.0.0-universal.dmg` with a fat (x86_64+arm64) bundled FFmpeg and fat better-sqlite3, both asar-unpacked and resolving at runtime — installs, launches, converts, and renders a waveform on macOS with zero system dependencies.**

## Performance

- **Duration:** ~25 min (incl. 3 build iterations resolving 2 universal-build landmines)
- **Completed:** 2026-06-24
- **Tasks:** 3 (2 auto + 1 human-verify checkpoint)
- **Files modified:** 3

## Accomplishments
- Authored the shared `electron-builder.yml` the Windows + release slices extend — mac universal dmg (unsigned, signing-ready), win nsis x64, GitHub publish to `Theosantos/CrateKeeper` (releaseType:release).
- Fat-ffmpeg pre-build script (`prepare-universal-ffmpeg.sh`): downloads both darwin arches from ffmpeg-static `b6.1.1` and `lipo -create`s them; idempotent, Darwin-only.
- Built `dist/CrateKeeper-1.0.0-universal.dmg` (243 MB). All four build-time assertions pass: ffmpeg present+fat in `app.asar.unpacked`, `better_sqlite3.node` fat, all `.node` flagged unpacked (asar is 4.4 MB; unpacked tree is 153 MB).
- Human-verified on macOS: installs via right-click → Open, converts a file to MP3 320 (bundled ffmpeg resolves), Tagger waveform renders — no Homebrew/Node/FFmpeg installed.

## Task Commits

1. **Task 1: electron-builder config + universal ffmpeg script + version bump** — `e264be2` (build)
2. **Task 1/2 fix: correct universal flag + better-sqlite3 universal-merge handling** — `fdce344` (fix)
3. **Task 2: build the .dmg + build-time assertions** — no source commit (produces gitignored `dist/` artifacts)
4. **Task 3: human-verify** — approved by developer (install + launch + convert + waveform)

## Files Created/Modified
- `electron-builder.yml` — distribution config: appId `com.theosantos.cratekeeper`, mac universal dmg unsigned (`identity:null` + `hardenedRuntime:false`), `mac.x64ArchFiles` fixture escape hatch, win nsis x64, asarUnpack ffmpeg-static + `**/*.node`, github publish.
- `scripts/prepare-universal-ffmpeg.sh` — fat-ffmpeg merge (both arches from b6.1.1, lipo).
- `package.json` — version 0.1.0 → 1.0.0; `build:mac` = ffmpeg pre-step + `electron-vite build` + `electron-builder --mac --universal`.

## Decisions Made
- Overwrote the pre-existing `@quick-start/electron` scaffold `electron-builder.yml` with the intended config — end state matches PATTERNS verbatim plus two corrections below. The scaffold's placeholder `publish: generic https://example.com/auto-updates` and `appId com.cratekeeper.app` were wrong for this project.
- Added explicit `dmg.artifactName` / `nsis.artifactName` so produced filenames match what 06-02/06-03 expect (`CrateKeeper-1.0.0-universal.dmg`, `CrateKeeper-Setup-1.0.0.exe`).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Blocking] Plan's `--arch universal` is an invalid electron-builder flag**
- **Found during:** Task 2 (first build)
- **Issue:** `electron-builder --mac --arch universal` errors with `Unknown argument: arch`. electron-builder uses the boolean `--universal` flag, not `--arch <value>`. The plan's Task-1 grep also checked for the literal `--arch universal`.
- **Fix:** Changed `build:mac` to `electron-builder --mac --universal`. The mac target in `electron-builder.yml` already pins `arch: universal`.
- **Verification:** Build proceeded past the CLI parse and packaged both arches.
- **Committed in:** `fdce344`

**2. [Rule 2 - Missing Critical] @electron/universal merge blocked by better-sqlite3 test fixture**
- **Found during:** Task 2 (second build)
- **Issue:** `@electron/universal` aborted: `test_extension.node` is byte-identical across x64/arm64 and "not covered by the x64ArchFiles rule". The broad `asarUnpack: **/*.node` pulls in this better-sqlite3 test fixture (never loaded at runtime).
- **Fix:** Added `mac.x64ArchFiles: "**/test_extension.node"` so the merge takes the x64 copy. The real `better_sqlite3.node` differs per-arch and still lipo-merges to a fat binary.
- **Verification:** Third build succeeded; `better_sqlite3.node` confirmed fat (x86_64+arm64) and unpacked.
- **Committed in:** `fdce344`

**3. [Rule 1 - Config drift] electron-builder.yml existed as a scaffold default**
- **Found during:** Task 1
- **Issue:** Plan said "create electron-builder.yml" but a scaffold default already existed with wrong appId and a placeholder publish URL.
- **Fix:** Overwrote with the intended config; dropped `npmRebuild:false` (would break the universal per-arch native rebuild) and the placeholder `generic` publish provider.
- **Verification:** Task 1 token greps pass; universal native rebuild produced fat `better_sqlite3.node`.
- **Committed in:** `e264be2`

---

**Total deviations:** 3 auto-fixed (2 Rule 1, 1 Rule 2)
**Impact on plan:** All necessary for a working universal build. No scope creep — config-only corrections plus the documented x64ArchFiles escape hatch. Note: the plan's build-time assertions for fat arches used an order-specific `grep "arm64 x86_64"` while `lipo` reports `x86_64 arm64`, and the "no .node in asar" check used `asar.listPackage` (which lists unpacked entries); both underlying truths were re-verified order-independently and via the asar `unpacked` header flag.

## Issues Encountered
- Three build iterations were needed (invalid flag → universal-merge fixture → success). Each was diagnosed from the electron-builder log and fixed at the config level; the fat-ffmpeg mitigation from RESEARCH worked first try (ffmpeg never tripped the merge).

## User Setup Required
None for this plan. (Plan 06-02 needs `GH_TOKEN` for the Windows build/publish host; Plan 06-03 needs it to publish the release.)

## Next Phase Readiness
- Shared `electron-builder.yml` + `package.json` 1.0.0 are in place for Wave 2 (Windows `.exe` + electron-updater) and Wave 3 (GitHub Release).
- The `.dmg` artifact exists in `dist/` for the eventual release publish (06-03).
- Windows `.exe` cannot be cross-compiled from macOS — 06-02 Task 3 requires a Windows/CI host.

---
*Phase: 06-distribution*
*Completed: 2026-06-24*
