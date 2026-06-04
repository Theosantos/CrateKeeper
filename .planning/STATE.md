---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: unknown
last_updated: "2026-06-03T16:01:40.686Z"
progress:
  total_phases: 6
  completed_phases: 2
  total_plans: 8
  completed_plans: 5
  percent: 33
---

# Project State — DJ Utils

## Current Status

Phase: 1 — Foundation (Complete)
Last updated: 2026-05-29

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-28)

**Core value:** Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.
**Current focus:** Phase 03 — conversion

## Phase History

### Phase 1 — Foundation (Complete, 2026-05-29)

Walking skeleton end-to-end: renderer ↔ window.djUtils ↔ main ↔ better-sqlite3, with persistent root-folder selection.

- **Plan 01-01** (2026-05-28, ~8 min): Scaffold + secure window + better-sqlite3 settings store + folder-pick/settings IPC bridge + Vitest infra. 5 commits (1 chore + 2 TDD RED/GREEN pairs). 7 tests green, build green. See `.planning/phases/01-foundation/01-01-SUMMARY.md`.
- **Plan 01-02** (2026-05-29, ~35 min): Renderer vertical slice — Zustand store, three-tool nav (Analyser/Convertir/Tagger), RootFolderPicker, mount-time hydration, editorial dark-studio design tokens. 14/14 tests green, build green, human-verify checkpoint approved (FOUND-01/02/03 all confirmed). See `.planning/phases/01-foundation/01-02-SUMMARY.md`.

## Accumulated Context

### Key Decisions

- Plan 01-01: Electron 39 (scaffold-pinned, not 42) accepted; better-sqlite3 12 prebuilds cover both ABIs
- Plan 01-01: Dual native-module ABI strategy via npm scripts (pretest→Node, predev/prebuild→Electron) so Vitest and Electron runtime coexist
- Plan 01-01: Shared `IpcChannels` const in src/shared/ipc-types.ts is the single source of truth for IPC channel names (main + preload import the same constants)
- Plan 01-01: Repo pattern — `createXRepo(db)` factory + `initXSchema(db)` + lazy singleton via connection.ts; prepared statements only
- Stack pinned (verified 2025): electron-vite 5 + Vite 7 (NOT 8 — peer conflict), React 19, better-sqlite3 12, electron-builder 26 — use @quick-start/electron react-ts scaffold
- Single persistence layer: better-sqlite3 settings key/value table (NOT electron-store) — tagger queue needs SQLite anyway
- State-based 3-tool navigation via Zustand (NOT React Router)
- ID3v2.3 (not v2.4) required for Rekordbox compatibility — validate before Phase 5
- FFmpeg binary path must be handled via asarUnpack from Phase 1 onwards
- Strict Electron main/renderer split — all Node/FFmpeg calls go through IPC bridge via contextBridge preload
- Worker Threads for batch operations (scan, conversion) to keep UI non-blocking
- Plan 01-02: Sandboxed preloads cannot require external modules — preload imports only 'electron' and shared types; @electron-toolkit/preload removed.
- Plan 01-02: predev/prebuild uses electron-rebuild -f -w better-sqlite3 (not electron-builder install-app-deps, which silently no-ops).
- Plan 01-02: Renderer components consume the Zustand store, never window.djUtils directly (T-1-04 mitigation, grep-enforced).
- Plan 01-02: Editorial dark-studio direction with :root design tokens — explicit anti-template baseline for the whole renderer.

### Known Risks

- FFmpeg asarUnpack misconfiguration can silently break conversion on packaged builds — test packaged build early
- ID3v2.4 writes will appear broken in Rekordbox — enforce v2.3 at the tag-writing layer
- Running `npm test` rebuilds better-sqlite3 for Node ABI (137); the next `npm run dev` triggers `predev` → `electron-rebuild` to swap back to Electron ABI (140). If a dev launch ever hits NODE_MODULE_VERSION mismatch, run `npx electron-rebuild -f -w better-sqlite3`.

### Todos

(none yet)

### Blockers

(none — Phase 1 checkpoint approved by user 2026-05-29)
