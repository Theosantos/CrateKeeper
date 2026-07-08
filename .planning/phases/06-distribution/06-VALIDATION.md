---
phase: 6
slug: distribution
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-22
---

# Phase 6 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Packaging correctness is NOT meaningfully unit-testable — the real validations
> are post-build assertions + human-verify smoke tests on the packaged app.
> See `06-RESEARCH.md` §Validation Architecture for the source of this strategy.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest (existing — 546 tests passing) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~existing suite runtime (no new unit tests for packaging config) |

---

## Sampling Rate

- **After every task commit:** Run `npm test` (existing suite must stay green — packaging
  config changes must not regress source behavior)
- **After every plan wave:** Run `npm test` + post-build packaging assertions (see Manual-Only / below)
- **Before `/gsd-verify-work`:** Full suite green + human-verify smoke test (DIST-01, DIST-02)
- **Max feedback latency:** existing suite runtime (seconds) for unit; minutes for a packaged build

---

## Per-Task Verification Map

> Populated during planning — each PLAN.md task carries its own `<acceptance_criteria>`.
> For packaging tasks, the "automated command" is a build-time assertion (see below), not a
> Vitest test. For human-only behaviors, see the Manual-Only table.

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| (filled by planner) | — | — | DIST-01 / DIST-02 | — | — | build-assert / manual | see below | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Build-time packaging assertions (scriptable, run right after `electron-builder` completes)

```bash
# ffmpeg-static landed in app.asar.unpacked (asarUnpack worked)
ls dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg

# no .node files inside the asar (would cause dlopen failure)
node -e "const asar=require('@electron/asar');const f=asar.listPackage('dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar');const n=f.filter(x=>x.endsWith('.node'));if(n.length){console.error('FAIL .node in asar',n);process.exit(1)}console.log('OK')"

# ffmpeg is a fat (universal) binary
lipo -info dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
# Expected: arm64 x86_64

# better_sqlite3.node is fat
lipo -info dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node
# Expected: arm64 x86_64
```

---

## Wave 0 Requirements

New artifacts this phase introduces (no new test files — packaging assertions are shell/CLI):

- [ ] `electron-builder.yml` — build config (appId, productName, asarUnpack, mac universal, win nsis, github publish)
- [ ] `scripts/prepare-universal-ffmpeg.sh` — fat ffmpeg pre-merge for macOS Universal build
- [ ] `src/main/update/updater.ts` — updater logic (Windows electron-updater + macOS notify-only)
- [ ] `npm install electron-updater` — production dependency, gated behind a `checkpoint:human-verify` task
- [ ] Existing Vitest infrastructure covers all source behavior; no new unit-test stubs required

---

## Manual-Only Verifications

The phase success criteria require a *packaged* app and cannot be exercised by Vitest. Each MUST
have an explicit human-verify checkpoint task in the plan.

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| .dmg installs + app launches on macOS | DIST-01 | Needs a packaged build + macOS host | Build `.dmg`, right-click app → Open (unsigned), confirm main window opens |
| .exe installs + app launches on Windows | DIST-01 | Needs NSIS build on Windows/CI | Run `CrateKeeper-Setup-1.0.0.exe`, launch, confirm window opens |
| FFmpeg conversion works in packaged build | DIST-02 | ffmpeg resolves only in packaged asar.unpacked tree | In packaged app, convert one file; confirm output produced |
| Waveform extraction works in packaged build | DIST-02 | Same ffmpeg path resolution surface | Open tagger in packaged app; confirm waveform renders |
| Windows update check degrades gracefully | D-08 | Requires packaged Windows app + network states | Launch packaged app with no newer release / offline; confirm no crash/block |
| macOS notify-only update prompt | D-07 | Requires packaged macOS app + a newer published release | With a newer release published, launch; confirm dialog → opens Releases page |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify (build-assert), Wave 0 dependency, or a human-verify checkpoint
- [ ] Sampling continuity: existing `npm test` runs on every commit; no 3 consecutive tasks without a check
- [ ] Wave 0 covers all new artifacts (config, scripts, updater module, dependency)
- [ ] No watch-mode flags in any verify command
- [ ] Human-verify checkpoints exist for every Manual-Only behavior above
- [ ] `nyquist_compliant: true` set in frontmatter (after planning fills the per-task map)

**Approval:** pending
