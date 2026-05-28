# Project State — DJ Utils

## Current Status
Phase: 1 — Foundation (In progress — Plan 01-01 complete, Plan 01-02 next; human-verify checkpoint pending)
Last updated: 2026-05-28

## Project Reference
See: .planning/PROJECT.md (updated 2026-05-28)

**Core value:** Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.
**Current focus:** Phase 1 — Foundation

## Phase History

### Phase 1 — Foundation (in progress)
- **Plan 01-01** (2026-05-28, ~8 min): Scaffold + secure window + better-sqlite3 settings store + folder-pick/settings IPC bridge + Vitest infra. 5 commits (1 chore + 2 TDD RED/GREEN pairs). 7 tests green, build green. See `.planning/phases/01-foundation/01-01-SUMMARY.md`. Human-verify checkpoint (dev launch + ABI + folder round-trip) pending user action.

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

### Known Risks
- FFmpeg asarUnpack misconfiguration can silently break conversion on packaged builds — test packaged build early
- ID3v2.4 writes will appear broken in Rekordbox — enforce v2.3 at the tag-writing layer

### Todos
(none yet)

### Blockers
- Human-verify checkpoint for Plan 01-01: user must run `npm run dev`, confirm no better-sqlite3 ABI error, run `await window.djUtils.setRootFolder('/tmp/test-folder')` then `getRootFolder()` (expect same), then quit + relaunch + `getRootFolder()` (expect persistence). See SUMMARY for full steps.
