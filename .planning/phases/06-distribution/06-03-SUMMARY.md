---
phase: 06-distribution
plan: 03
subsystem: infra
tags: [github-releases, publish, ci, readme, documentation, code-signing, gatekeeper, smartscreen]

requires:
  - phase: 06-distribution
    provides: electron-builder.yml github publish config, .dmg (06-01), .exe + updater (06-02)
provides:
  - Published non-draft v1.0.0 GitHub Release with .dmg + .exe + latest.yml + latest-mac.yml
  - Public-ready README with download/first-launch docs + branding
  - Verified macOS notify-only update path against the live release
affects: []

tech-stack:
  added: []
  patterns:
    - "Release = push a v* tag; CI builds + publishes both installers via electron-builder --publish always (runner GITHUB_TOKEN)"

key-files:
  created:
    - LICENSE
    - docs/banner.svg
    - docs/screenshots/analyze.svg
    - docs/screenshots/convert.svg
    - docs/screenshots/tag.svg
  modified:
    - README.md
    - package.json

key-decisions:
  - "v1.0.0 published via the GitHub Actions tag pipeline (not manual electron-builder on two hosts) — single tagged CI run builds + publishes both installers"
  - "README written in English (public-GitHub convention) with the unsigned first-launch steps preserved; install docs scoped to the official Releases download only"
  - "MIT license added; package.json metadata (license/author/repository/bugs) filled"

patterns-established:
  - "Public-project README: SVG hero banner + shields badges + features + screenshots + install + dev/release docs"

requirements-completed: [DIST-01, DIST-02]

duration: ~30min
completed: 2026-06-24
---

# Phase 06 / Plan 03: GitHub Release + First-Launch Docs Summary

**Published a non-draft v1.0.0 GitHub Release carrying the macOS `.dmg`, Windows `.exe`, and both updater-feed YAMLs — downloadable and installable by a non-developer via the documented unsigned first-launch steps — and turned the scaffold README into a public-ready project front page.**

## Performance

- **Duration:** ~30 min (incl. README branding pass)
- **Completed:** 2026-06-24
- **Tasks:** 3 (1 auto + 1 human-action publish + 1 human-verify)
- **Files modified:** README.md, package.json (+ new LICENSE, branding assets)

## Accomplishments
- **Published v1.0.0** (non-draft) on `Theosantos/CrateKeeper` via the tag-triggered CI pipeline. Verified via the GitHub API: assets = `CrateKeeper-1.0.0-universal.dmg`, `CrateKeeper-Setup-1.0.0.exe`, `latest.yml`, `latest-mac.yml` (+ blockmaps); `draft:false`, `prerelease:false`.
- **README**: non-developer Download & Install section (macOS right-click → Open; Windows SmartScreen → Run anyway), later expanded into a full public front page — SVG hero banner, shields badges, features for the three tools, screenshots (placeholder mockups), tech stack, and dev/release docs. Added LICENSE (MIT) and filled `package.json` metadata.
- **macOS notify-only update path verified**: confirmed `checkForUpdatesMacOS` is compiled into the published v1.0.0 (`git show v1.0.0:src/main/index.ts`), and at version parity the app correctly shows no dialog. A throwaway `9.9.9` test release exercised the newer-version branch, then was deleted (`releases/latest` back to `v1.0.0`).

## Task Commits

1. **Task 1: README download + first-launch docs** — `cb9c80b`; public-ready rework + branding in `8144f78`, banner fix in `616ef13`.
2. **Task 2: publish v1.0.0** — produced by the `v1.0.0` tag CI run (build + `--publish always`); not a working-tree commit.
3. **Task 3: macOS notify verification** — verified against the live release (code present in the published build).

(Also this phase: `2140f15` node24 CI action bump; `e8f7462` branded app icon + `npm run icons` pipeline — polish requested during execution.)

## Files Created/Modified
- `README.md` — public project front page with correct unsigned first-launch steps.
- `LICENSE` — MIT © Theo Santos.
- `package.json` — license/author/repository/bugs metadata.
- `docs/banner.svg`, `docs/screenshots/*.svg` — branding + placeholder screenshots.

## Decisions Made
- Published through CI on a version tag rather than running `electron-builder --publish` manually on two machines — the maintainer is Mac-only, and one tagged run builds + publishes both platforms with the runner's `GITHUB_TOKEN`.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - User-directed] Publish via CI tag pipeline instead of manual two-host publish**
- **Found during:** Task 2
- **Issue:** Plan assumed manual `electron-builder --publish always` on macOS + a Windows host. Maintainer has only a Mac.
- **Fix:** The release workflow (06-02) publishes both installers on a `v*` tag push. `git push origin v1.0.0` built + published the full release.
- **Verification:** GitHub API confirms the non-draft v1.0.0 with all four assets.
- **Committed in:** release driven by tag `v1.0.0` (workflow `bcc77e2`/`2140f15`).

**2. [Rule 3 - User-directed] README expanded into a full public front page + branding + app icon**
- **Found during:** post-Task-1 (user request)
- **Issue:** The scaffold-derived README and default electron icon weren't "public-project" quality.
- **Fix:** Added SVG banner, badges, screenshots, LICENSE, metadata; replaced the app icon with a branded vinyl-record mark + a reproducible `npm run icons` pipeline.
- **Committed in:** `8144f78`, `616ef13`, `e8f7462`.

---

**Total deviations:** 2 (both user-directed scope additions)
**Impact on plan:** Same end state (downloadable, installable v1.0.0 + first-launch docs), reached via CI + with stronger public-facing polish. No regressions.

## Issues Encountered
- The user's initial notify-update test showed no dialog. Root-caused with evidence: the *installed* app was the local 06-01 build (made before the updater existed); the *published* v1.0.0 contains the updater. Not a code bug — a stale-build test artifact.
- A `9.9.9` test release was briefly the repo's "latest" (badge + phantom update); deleted with `--cleanup-tag`.

## User Setup Required
None outstanding. Publishing used the CI runner's `GITHUB_TOKEN` (no manual PAT needed).

## Next Phase Readiness
- v1.0.0 is live and installable end-to-end on both platforms (DIST-01), with bundled FFmpeg (DIST-02).
- Note: the published v1.0.0 carries the *previous* app icon; the new branded icon ships with the next release.
- Residual: a real human install smoke-test of the Windows `.exe` (SmartScreen → Run anyway → convert) still benefits from a Windows machine — covered when a Windows user downloads the published installer.

---
*Phase: 06-distribution*
*Completed: 2026-06-24*
