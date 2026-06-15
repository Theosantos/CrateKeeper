---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: in_progress
last_updated: "2026-06-15T21:54:48.544Z"
progress:
  total_phases: 6
  completed_phases: 4
  total_plans: 14
  completed_plans: 11
  percent: 67
---

# Project State — DJ Utils

## Current Status

Phase: 4 — Tagger Core (Complete, 2026-06-15)
Last updated: 2026-06-15

## Project Reference

See: .planning/PROJECT.md (updated 2026-05-28)

**Core value:** Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.
**Current focus:** Phase 05 — Tag Writing & Rekordbox Compatibility (next)

## Phase History

### Phase 1 — Foundation (Complete, 2026-05-29)

Walking skeleton end-to-end: renderer ↔ window.djUtils ↔ main ↔ better-sqlite3, with persistent root-folder selection.

- **Plan 01-01** (2026-05-28, ~8 min): Scaffold + secure window + better-sqlite3 settings store + folder-pick/settings IPC bridge + Vitest infra. 5 commits (1 chore + 2 TDD RED/GREEN pairs). 7 tests green, build green. See `.planning/phases/01-foundation/01-01-SUMMARY.md`.
- **Plan 01-02** (2026-05-29, ~35 min): Renderer vertical slice — Zustand store, three-tool nav (Analyser/Convertir/Tagger), RootFolderPicker, mount-time hydration, editorial dark-studio design tokens. 14/14 tests green, build green, human-verify checkpoint approved (FOUND-01/02/03 all confirmed). See `.planning/phases/01-foundation/01-02-SUMMARY.md`.

### Phase 4 — Tagger Core (Complete, 2026-06-15)

Swipe-style tagging queue with audio preview, inline editing, undo, and session resume. 479/479 tests green, build green. See `.planning/phases/04-tagger-core/04-VERIFICATION.md` (PASS-WITH-NOTES).

- **Plan 04-01**: Main backbone — tagger IPC namespace, `taggerRepo` (`pending_tag_edits` + `tagger_session`), `scanRepo.listIncompleteFiles`, `cratekeeper://` audio protocol, genre presets.
- **Plan 04-02**: Renderer card UX — `useTaggerStore`, `TaggerCard` (preview/rating/preset-bar/split), `useTaggerKeyboard`, transform-only slide animation.
- **Plan 04-03**: Undo state machine + session resume + E2E test, then an extended user-driven UAT loop (see Key Decisions below).
- **Post-checkpoint UX changes (user-approved):** removed BPM/Key editing (Rekordbox handles detection); replaced the fixed 30s preview with a full-track SoundCloud-style waveform decoded in the **main process via ffmpeg** (`tagger:get-waveform`); mute toggle → play/pause; partial-range audio protocol + ErrorBoundary + `render-process-gone` logging after diagnosing native renderer crashes.

## Accumulated Context

### Key Decisions

- Plan 01-01: Electron 39 (scaffold-pinned, not 42) accepted; better-sqlite3 12 prebuilds cover both ABIs
- Plan 01-01: Dual native-module ABI strategy via npm scripts (pretest→Node, predev/prebuild→Electron) so Vitest and Electron runtime coexist
- Plan 01-01: Shared `IpcChannels` const in src/shared/ipc-types.ts is the single source of truth for IPC channel names (main + preload import the same constants)
- Plan 01-01: Repo pattern — `createXRepo(db)` factory + `initXSchema(db)` + lazy singleton via connection.ts; prepared statements only
- Stack pinned (verified 2025): electron-vite 5 + Vite 7 (NOT 8 — peer conflict), React 19, better-sqlite3 12, electron-builder 26 — use @quick-start/electron react-ts scaffold
- Single persistence layer: better-sqlite3 settings key/value table (NOT electron-store) — tagger queue needs SQLite anyway
- State-based 3-tool navigation via Zustand (NOT React Router)
- Plan 04-03: Tagger writes edits to SQLite `pending_tag_edits` only — `applied_at` stays NULL until Phase 5 writes the file (a Phase-4 re-edit must NOT clear it). NOTHING is written to audio files yet.
- Plan 04-03: Renderer must NOT decode audio (Web Audio `decodeAudioData` of full tracks crashed the renderer natively). Waveform peaks are decoded in the main process via ffmpeg and sent over IPC; the renderer only draws ~hundreds of floats. Playback stays on a plain `<audio>` element fed by the partial-range `cratekeeper://` protocol.
- Plan 04-03: BPM/Key are not editable in the Tagger (user decision — Rekordbox detects them). Schema/IPC still carry the columns for Phase 5 forward-compat.
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

### Phase 4 — Tagger Core (in progress, 2026-06-05)

- **Plan 04-01** (2026-06-05): Tagger main-process backbone — 6 IPC channels (tagger:*), pending_tag_edits + tagger_session SQLite tables, cratekeeper:// custom protocol with folder + AUDIO_EXTS gates, mergeGenrePresets helper, scanRepo.findLatestScan/listIncompleteFiles, autoplayPolicy unlock. 7 commits. 351 tests green (64 new). Deviations: [Rule 2] additive `scanned_files.genre TEXT` column (Phase 2 schema was missing it for topGenres). See `.planning/phases/04-tagger-core/04-01-SUMMARY.md`.
- **Plan 04-02** (2026-06-05): Tagger renderer card UX — useTaggerStore (queue + dirty edits + presets + mute + Keep/Skip), TaggerCard composite (filename + chips + AudioPreview + ArtistTitleSplit + 6 editable fields + RatingStars + GenrePresetBar + action row), useTaggerKeyboard with input-focus gate, AudioPreview cratekeeper:// + 30s loop + AIFF fallback, transform-only slide animation orchestrated by TaggerView, CSP media-src extension. 5 commits. 426 tests green (75 new). Marks TAGG-02..08 complete. Deviations: [Rule 3] jsdom HTMLMediaElement.play guard + contentEditable focus test setup + lifted slide orchestration to TaggerView (planner-discretion path). Annuler button rendered disabled (Plan 04-03 owns undo). See `.planning/phases/04-tagger-core/04-02-SUMMARY.md`.
- **Plan 04-03** (2026-06-05): Tagger session resume + 1-level undo — useTaggerStore.lastAction descriptor + undo action (routes keep-with-prior / keep-no-prior / skip) + scanId on state; TaggerView mount-time getSession AFTER loadQueue with identity-by-path restore + library-change fallback to 0; 500ms debounced tagger:set-session + beforeunload synchronous flush (Pitfall 1); Cmd-Z + Annuler button wired through reversed-direction slide. End-to-end RTL integration test covers the full flow. 3 commits. 452 tests green (26 new). Marks TAGG-09 + TAGG-10 complete; closes Phase 4 surface pending end-of-phase human-verify checkpoint. Deviations: [Rule 3] swapped fake-timer/advanceTimersByTimeAsync for waitFor({timeout:1500}) in 3 debounce tests (fake timers hang waitFor in jsdom); exact-match getByLabelText('Genre') in E2E test to disambiguate from "Genre détecté" chip. See `.planning/phases/04-tagger-core/04-03-SUMMARY.md`.
