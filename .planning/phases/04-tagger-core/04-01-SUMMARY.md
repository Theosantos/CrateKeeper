---
phase: 04-tagger-core
plan: 01
subsystem: tagger
tags: [tagger, ipc, sqlite, protocol, security]
requires:
  - 02-01 (scanRepo + scanned_files schema)
  - 03-01 (IPC namespace + V5 validation pattern)
provides:
  - taggerRepo (pending_tag_edits + tagger_session)
  - tagger:* IPC namespace (6 channels)
  - cratekeeper:// custom protocol (folder + ext gates)
  - mergeGenrePresets pure helper
  - scanRepo.findLatestScan + listIncompleteFiles
affects:
  - src/main/index.ts (autoplayPolicy + protocol wiring)
  - src/main/db/connection.ts (getTaggerRepo singleton)
  - src/main/scan/scanRepo.ts (additive genre TEXT column)
tech_stack:
  added: []
  patterns:
    - lazy require('electron') in IPC modules
    - protocol.handle + registerSchemesAsPrivileged
    - V5 validation: typeof + length cap + range check + folder-allowlist + extension-allowlist
key_files:
  created:
    - src/main/tagger/taggerRepo.ts
    - src/main/tagger/taggerRepo.test.ts
    - src/main/tagger/queueBuilder.ts
    - src/main/tagger/queueBuilder.test.ts
    - src/main/tagger/audioProtocol.ts
    - src/main/tagger/audioProtocol.test.ts
    - src/main/ipc/tagger.ts
    - src/main/ipc/tagger.test.ts
  modified:
    - src/shared/ipc-types.ts
    - src/preload/index.ts
    - src/main/db/connection.ts
    - src/main/scan/scanRepo.ts
    - src/main/scan/scanRepo.test.ts
    - src/main/index.ts
    - src/renderer/src/App.test.tsx
    - src/renderer/src/components/analyser/ScanToolbar.test.tsx
    - src/renderer/src/components/convertir/ConvertirView.test.tsx
    - src/renderer/src/store/useScanStore.test.ts
    - src/renderer/src/store/useConversionStore.test.ts
decisions:
  - additive scanned_files.genre TEXT column (Rule 2 deviation — Phase 2 schema missing the field topGenres requires; ALTER TABLE wrapped in try/catch for existing DBs)
  - V5 caps: text fields ≤500 chars, key ≤16 chars, bpm ∈ [1,399] integer, rating ∈ {1..5}
  - cratekeeper://audio/<encoded-abs-path> as the streaming URL shape
  - bypassCSP=false on privileged scheme (Plan 04-02 will extend CSP media-src)
metrics:
  duration_minutes: ~7
  tasks_completed: 7
  tests_added: 64
  tests_total: 351
  completed_date: 2026-06-05
---

# Phase 4 Plan 01: Tagger Backbone Summary

One-liner: Main-process Tagger spine — pending_tag_edits + tagger_session SQLite tables, 6-channel typed IPC namespace with V5 + folder/extension allowlist, cratekeeper:// custom protocol streaming under rootFolder with autoplay-policy unlock.

## What Shipped

### IPC surface (T-4-07 mitigated)
- 6 new channels in `IpcChannels`: TaggerLoadQueue / TaggerSaveEdit / TaggerDeleteEdit / TaggerGetSession / TaggerSetSession / TaggerGetGenrePresets.
- `CrateKeeperTaggerApi` exposed via preload as `window.crateKeeper.tagger.*`.
- `SETTINGS_KEY_ALLOWLIST` extended with `'tagger.muteEnabled'` (T-4-07).
- Strongly-typed `PendingTagEdit` / `TaggerSession` / `TaggerQueueResult` / `GenrePresetsResult` / `SaveTagEditInput` types shared main↔preload↔renderer.

### Persistence (T-4-04, T-4-06 mitigated)
- `pending_tag_edits` table (PK file_path, CHECK rating IS NULL OR 1..5, applied_at preserved on UPSERT for Phase 5).
- `tagger_session` single-row table (CHECK id=1).
- `createTaggerRepo(db)` factory + `getTaggerRepo()` lazy singleton mirror the Phase 3 pattern.
- All statements prepared; no template-literal SQL with embedded values (V5 grep gate green).

### scanRepo extension (substrate for TAGG-01)
- `findLatestScan(rootFolder)` returns the most recent `status='done'` scan; running/cancelled/error excluded.
- `listIncompleteFiles(scanId)` returns rows where `has_genre=0 OR has_bpm=0 OR has_key=0`, ordered by path ASC.

### queueBuilder (substrate for TAGG-04)
- Pure `mergeGenrePresets(libraryTop, fallback)` — 9-slot output, library-first, case-sensitive dedup.
- `HARDCODED_GENRE_FALLBACK = ['House','Techno','Afro House','Melodic','Disco','Hip-Hop','Funk','Deep','Electronica']` (LOCKED order).

### Custom protocol (T-4-01, T-4-02 mitigated)
- `cratekeeper://audio/<encoded-abs-path>` registered via `protocol.handle` inside whenReady, after `protocol.registerSchemesAsPrivileged` runs at module top-level (Pitfall 2).
- 403 for paths outside rootFolder; 415 for extensions not in AUDIO_EXTS; 404 for wrong hostname.
- Streams matched files via `net.fetch('file://' + abs)`.

### Handler wiring (T-4-01..05 mirrored at IPC layer)
- `registerTaggerHandlers({ipcMain, taggerRepo, scanRepo, settingsRepo, now?})` registers all six channels.
- save-edit enforces: object payload + folder-allowlist + AUDIO_EXTS + text caps (500) + key cap (16) + bpm int 1..399 + rating set {1..5}.
- delete-edit + set-session enforce folder-allowlist.
- get-genre-presets returns `{ source: 'library' | 'mixed' | 'defaults', presets: string[9] }`.

### Main bootstrap
- `BrowserWindow.webPreferences.autoplayPolicy = 'no-user-gesture-required'` (Pitfall 5).
- Existing sandbox + contextIsolation preserved.

## Per-task Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | 9b714bd | feat(04-01): extend IPC surface with tagger namespace + preload bridge |
| 2 | 5b65d42 | feat(04-01): extend scanRepo with findLatestScan + listIncompleteFiles |
| 3 | 4d7a1d5 | feat(04-01): add taggerRepo + schema (pending_tag_edits + tagger_session) |
| 4 | 2f2e502 | feat(04-01): add mergeGenrePresets pure helper + HARDCODED_GENRE_FALLBACK |
| 5 | cc4bcb2 | feat(04-01): register cratekeeper:// custom protocol with folder + ext gates |
| 6 | beec9a3 | feat(04-01): register tagger:* IPC handlers with V5 validation |
| 7 | 98c8b6c | feat(04-01): wire tagger backbone in main bootstrap |

## Verification

- `npm run build` exits 0 — typechecks (node + web tsconfigs) + electron-vite bundle.
- `npx vitest --run` — 351/351 tests green (64 new across taggerRepo, queueBuilder, audioProtocol, ipc/tagger, scanRepo extensions).
- Bundled `out/main/index.js` references `registerSchemesAsPrivileged`, `autoplayPolicy`, `registerAudioProtocol`, `registerTaggerHandlers` (grep verified).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 — Missing functionality] Added `genre TEXT` column to `scanned_files`**
- **Found during:** Task 3 (taggerRepo tests for `topGenres`).
- **Issue:** Plan 04-01 assumes `taggerRepo.topGenres(limit)` issues `SELECT genre, COUNT(*) FROM scanned_files`. The Phase 2 schema only stores boolean tag-presence flags (`has_genre`, `has_bpm`, `has_key`) — there is no `genre` text column. Without one, `topGenres` would always return `[]` and TAGG-04 ("library top-9") could never trigger.
- **Fix:** Added an additive `genre TEXT` column to the `scanned_files` schema in `initScanSchema` and wrapped an `ALTER TABLE scanned_files ADD COLUMN genre TEXT` in `try/catch` so existing user DBs created under Phase 2 also pick up the column lazily. Phase 2's scan worker still doesn't populate it (out of scope for this plan), but the column is in place for a future Phase 2 follow-up (or Phase 5) to fill.
- **Files modified:** `src/main/scan/scanRepo.ts`.
- **Commit:** 4d7a1d5.

**2. [Rule 3 — Blocking issue] Renderer test mocks missing `tagger` member**
- **Found during:** Task 1 (`npm run typecheck` after extending `CrateKeeperApi`).
- **Issue:** Five existing renderer test files construct `CrateKeeperApi` mocks; making `tagger` a required member broke their type-checks.
- **Fix:** Added a `tagger: { ... } as unknown as CrateKeeperApi['tagger']` stub to each affected mock (App.test, ScanToolbar.test, ConvertirView.test, useScanStore.test, useConversionStore.test). Stubs return empty queues / null sessions / defaults presets so behavioural expectations remain unchanged.
- **Files modified:** five renderer `*.test.{ts,tsx}`.
- **Commit:** 9b714bd.

## Checkpoint Handling

The plan's final `checkpoint:human-verify` task is **deferred to end-of-phase** per its own `how-to-verify` spec ("Manual verification of this plan's surface is rolled into the Plan 04-03 final checkpoint"). Automated coverage — `npm run build` green + 351 tests green + grep gate on bundled symbols — is the agreed verification surface for plan 04-01 in isolation. Auto-mode auto-approval applies (not a package-legitimacy / `gate="blocking-human"` checkpoint).

## Known Stubs

None. All surface delivered in this plan is wired end-to-end (renderer→preload→main→DB). The `scanned_files.genre` column is empty until a future write — that's a Phase 2 follow-up, not a stub in the Phase 4 surface.

## Threat Flags

None — every new surface (custom protocol handler + 6 IPC channels) is already in the plan's `<threat_model>` (T-4-01..07) and mitigated at the layers documented above.

## Self-Check: PASSED

Files exist (taggerRepo.ts, taggerRepo.test.ts, queueBuilder.ts, queueBuilder.test.ts, audioProtocol.ts, audioProtocol.test.ts, src/main/ipc/tagger.ts, src/main/ipc/tagger.test.ts). All 7 task commits present in `git log` (9b714bd / 5b65d42 / 4d7a1d5 / 2f2e502 / cc4bcb2 / beec9a3 / 98c8b6c).
