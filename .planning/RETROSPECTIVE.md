# Project Retrospective

*A living document updated after each milestone. Lessons feed forward into future planning.*

## Milestone: v1.0 — MVP

**Shipped:** 2026-06-24
**Phases:** 6 | **Plans:** 17 | **Tasks:** 35 | **Timeline:** ~26 days (2026-05-29 → 06-24), 30 commits, ~17.4k LOC

### What Was Built
- Secure Electron shell (electron-vite + React 19 + TS) with a typed `window.djUtils` contextBridge, better-sqlite3 persistence, and three-tool navigation (Analyser / Convertir / Tagger).
- Non-blocking, worker-thread batch **scan** (format/bitrate/metadata + tag-status badges + CSV export) and **convert** (FFmpeg queue with per-file progress, resume-after-crash, tag preservation).
- **Tagger**: Tinder-style swipe queue with a full-track waveform (decoded main-side via ffmpeg), genre presets, rating, undo, and session resume.
- Rekordbox-compatible **tag writing** — atomic ID3v2.3 (MP3) + MP4, batch "Appliquer" with per-file retry.
- **Distribution**: unsigned macOS Universal `.dmg` + Windows NSIS `.exe` with a bundled fat FFmpeg, a GitHub Actions release pipeline, published v1.0.0 (then v1.0.1) GitHub Releases, and cross-platform update checks.

### What Worked
- **TDD discipline held to the end** — 554 tests green through the final distribution phase; config/doc-only phases never regressed source.
- **Deviation rules with rule-numbered commits** made every unplanned fix auditable (e.g. `[Rule 1]` invalid electron-builder flag, `[Rule 2]` universal-merge fixture).
- **CI-as-Windows-builder** cleanly solved the Mac-only maintainer's inability to cross-compile NSIS — one tagged run builds + publishes both platforms.
- **Evidence-first debugging** — the "no macOS update dialog" was root-caused by inspecting the installed app's asar (pre-updater local build) rather than guessing at the code.
- **Goal-backward verification caught a real ship-gap-adjacent issue** (published artifact vs fixed source provenance) that task-completion checks would have missed.

### What Was Inefficient
- **Three build iterations** for the universal `.dmg` — an invalid `--arch universal` flag, then the @electron/universal byte-identical `test_extension.node` landmine. Both were config-level and each cost a full ~10-min build.
- **Stale-install confusion** — the update-dialog test failed only because the human tested a local build made *before* the updater existed; a note in the 06-01 checkpoint ("this build predates 06-02") would have pre-empted it.
- **PROJECT.md drifted** — an `electron-builder.yml` scaffold already existed when the plan said "create", and shipped requirements lingered in Active until milestone close.
- **Code-review fixes landed after the first publish** — v1.0.0 shipped the pre-fix updater, forcing a v1.0.1. Running the review gate *before* the release tag would have shipped it right the first time.

### Patterns Established
- **Universal macOS build recipe:** pre-build fat ffmpeg via `lipo` + `mac.x64ArchFiles` for identical native fixtures + drop `npmRebuild:false`.
- **Release = push a `v*` tag** → GitHub Actions builds + publishes both installers with the runner's `GITHUB_TOKEN` (no local Windows host, no manual PAT).
- **Main-process ffmpeg for renderer-hostile work** (full-track waveform) after `decodeAudioData` crashed the renderer.
- **Reproducible brand assets** — single source SVG → `npm run icons` (resvg + iconutil + png-to-ico).
- **Test throwaway releases with a non-`v` tag** so they never trigger the release CI.

### Key Lessons
1. **Verify the published artifact, not the local build.** "Works on my install" ≠ "works in the release" — inspect the actual asar/tag commit.
2. **electron-builder CLI flags ≠ its docs' prose.** `--universal` is a boolean; `--arch <value>` doesn't exist. Read the CLI `--help`, not just guides.
3. **@electron/universal rejects any byte-identical native file across arches** — including test fixtures pulled in by a broad `**/*.node` unpack glob. Scope the fix with `x64ArchFiles`.
4. **Run code review before the release tag**, not after — a patch release is the cost of reviewing late.
5. **A CI pipeline can substitute for missing hardware** (Windows) but not for a human install gesture — track that residual explicitly.

### Cost Observations
- Model mix: orchestration on Opus; executor / verifier / code-reviewer subagents on Sonnet.
- Sessions: milestone spanned multiple sessions; Phase 6 executed largely in one long interactive session with human checkpoints.
- Notable: the checkpoint-heavy distribution phase was more efficient run *inline* (no worktree subagents) — single plan per wave meant zero parallelism to gain, and the heavy build needed the main tree's `node_modules`.

---

## Cross-Milestone Trends

### Process Evolution

| Milestone | Sessions | Phases | Key Change |
|-----------|----------|--------|------------|
| v1.0 | multi | 6 | Established GSD phase→plan→execute→verify loop; adopted CI-driven cross-platform release |

### Cumulative Quality

| Milestone | Tests | Coverage | Zero-Dep Additions |
|-----------|-------|----------|-------------------|
| v1.0 | 554 green | — | ffmpeg-static, node-id3, better-sqlite3 all pure/prebuilt (no electron-rebuild churn on version bumps) |

### Top Lessons (Verified Across Milestones)

1. Evidence-first over guess-first — inspect real artifacts (asar, tags, releases) before concluding.
2. Deviation rules + rule-numbered commits keep unplanned work auditable without slowing execution.

*(Trends will accrue signal from v1.1 onward.)*
