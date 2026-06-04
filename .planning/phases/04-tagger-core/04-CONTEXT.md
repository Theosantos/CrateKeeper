# Phase 4 — Tagger Core — Context

**Date:** 2026-06-04
**Phase:** 04-tagger-core
**Mode:** mvp
**Depends on:** Phase 1 (formally) + Phase 2 (queue source) + Phase 5 (Tagger reads, Phase 5 writes)
**Requirements:** TAGG-01, TAGG-02, TAGG-03, TAGG-04, TAGG-05, TAGG-06, TAGG-07, TAGG-08, TAGG-09, TAGG-10

---

<domain>

**What this phase delivers:**
The Tagger view — a one-card-at-a-time queue interface that lets the user work through their audio library file by file, hearing a 30-second preview, editing all the Rekordbox-relevant tags inline on the card, and pressing Keep (save) / Skip (advance) via buttons or `←` / `→` keyboard. Edits land in a `pending_tag_edits` SQLite table; **actual ID3v2.3 / POPM writes to the audio files happen in Phase 5** (this phase is the editor + intent store, not the writer).

The phase also delivers genre quick-buttons (1-9 hotkeys), an Artist/Title split suggestion when the title contains a recognized separator, one-level Undo, and session-resume by file path so closing+reopening lands on the same card.

It does NOT include: Phase 5's atomic file writes, full library re-tagging UI, batch tag operations, OR the Tinder swipe-on-touch gesture (we ship the keyboard / button / slide-anim slice for v1).

</domain>

<canonical_refs>

Downstream agents (researcher, planner, executor) MUST read these:

- `.planning/PROJECT.md` — Tech stack lock (Electron, React 19, Zustand, better-sqlite3, music-metadata, Web Audio API for preview), constraints.
- `.planning/REQUIREMENTS.md` — TAGG-01 through TAGG-10 verbatim + TAGS-01..03 for Phase 5 boundary awareness.
- `.planning/ROADMAP.md` — Phase 4 success criteria + Phase 5 dependency note.
- `.planning/STATE.md` — Phase 1/2/3 decisions accumulator.
- `.planning/phases/02-scanning/02-01-SUMMARY.md` — scanRepo + scans/scanned_files schema (Tagger reads from here).
- `.planning/phases/03-conversion/03-01-SUMMARY.md` — IPC namespace pattern + ConversionController (Tagger mirrors the shape).
- `src/main/scan/scanRepo.ts` — `iterateFiles`, `listScans`, latest-scan helpers Tagger will reuse.
- `src/main/conversion/conversionRepo.ts` — Repo factory pattern to mirror for `taggerRepo`.
- `src/main/ipc/conversion.ts` — Typed IPC handler shape Tagger IPC mirrors.
- `src/shared/ipc-types.ts` — Extend `IpcChannels` + `CrateKeeperApi` with the `tagger` namespace.
- `src/renderer/src/views/TaggerView.tsx` — Current placeholder (just title); becomes the real card view.
- `./CLAUDE.md` — Coding conventions (immutability, ≤800 lines, French copy, anti-template editorial dark-studio).

</canonical_refs>

<code_context>

**Reusable from Phases 1-3 (do not rebuild):**

| Asset | Path | How Phase 4 reuses it |
|-------|------|------------------------|
| Repo factory + lazy singleton | `src/main/db/connection.ts` | Add `getTaggerRepo()` + `initTaggerSchema()` mirror |
| IPC namespace pattern | `src/main/ipc/conversion.ts` | New `src/main/ipc/tagger.ts` with `tagger.*` handlers, lazy `require('electron')`, V5 validation |
| IPC bridge shape | `src/shared/ipc-types.ts` | Extend `IpcChannels` + `CrateKeeperTaggerApi` |
| Preload bridge | `src/preload/index.ts` | Add `crateKeeper.tagger.*` namespace |
| Renderer store pattern | `src/renderer/src/store/useConversionStore.ts` | New `useTaggerStore.ts` — queue, currentIndex, edits, undo stack |
| Scan results | `src/main/scan/scanRepo.ts` — `iterateFiles(scanId)` + `listScans(rootFolder)` | Source of queue items (latest scan filtered to incomplete-tag rows) |
| Editorial design tokens | `src/renderer/src/assets/main.css :root` | Card surfaces, badges, focus rings — no new color tokens |
| App nav | `src/renderer/src/store/useAppStore.ts` | `activeTool === 'tagger'` already exists |

**New surface this phase introduces:**

| File | Purpose |
|------|---------|
| `src/main/tagger/taggerRepo.ts` | `pending_tag_edits` table + `session_state` row (resume position) |
| `src/main/tagger/queueBuilder.ts` | Pure helper: builds the queue from scanRepo data + computes top-9 genres |
| `src/main/ipc/tagger.ts` | `tagger:load-queue`, `tagger:save-edits`, `tagger:get-session`, `tagger:set-session`, `tagger:get-genre-presets` |
| `src/renderer/src/store/useTaggerStore.ts` | Queue state, currentIndex, undo, dirty card edits |
| `src/renderer/src/components/tagger/TaggerCard.tsx` | The card itself — preview player + every editable field |
| `src/renderer/src/components/tagger/AudioPreview.tsx` | Web Audio API thin wrapper |
| `src/renderer/src/components/tagger/GenrePresetBar.tsx` | 9 buttons + 1-9 hotkey bindings |
| `src/renderer/src/components/tagger/RatingStars.tsx` | 1-5 stars → POPM byte |
| `src/renderer/src/components/tagger/ArtistTitleSplit.tsx` | Suggestion banner with two split options |
| `src/renderer/src/views/TaggerView.tsx` | View shell: empty state + active card + Keep/Skip/Undo controls + keyboard handler |
| `src/renderer/src/components/tagger/tagger.css` | Card surface + slide animations |

</code_context>

<decisions>

### Queue source (TAGG-01)

- **Latest scan of `rootFolder` from Phase 2**, filtered to incomplete-tag rows.
- On Tagger mount, the renderer calls `crateKeeper.tagger.loadQueue()`. The main-side handler:
  1. Reads `settings.rootFolder`.
  2. Calls `scanRepo.findLatestScan(rootFolder)` (new helper — extend Phase 2's repo).
  3. If no scan exists: returns `{ scanId: null, files: [] }`. Renderer shows empty state with a CTA "Lance un scan dans l'Analyser pour démarrer".
  4. If a scan exists: returns `{ scanId, files }` where `files` is `scanned_files` rows with `hasGenre = 0 OR hasBpm = 0 OR hasKey = 0` (carries forward Phase 2's tag-completeness booleans).
- **No re-scan from the Tagger.** Tagger does NOT call scanController — keeps the boundary clean (Analyser owns scanning; Tagger consumes its output).
- Queue order: `scanned_files.path ASC` (stable, predictable).

### Edit storage / Phase 4 ↔ Phase 5 boundary

- **New SQLite table `pending_tag_edits`:**
  ```
  file_path       TEXT PRIMARY KEY
  genre           TEXT NULLABLE
  bpm             INTEGER NULLABLE  -- integer per TAGS-03
  key             TEXT NULLABLE     -- Camelot notation per TAGS-03 (e.g. "8A")
  artist          TEXT NULLABLE
  title           TEXT NULLABLE
  comment         TEXT NULLABLE
  rating          INTEGER NULLABLE  -- 1-5; POPM byte derived at write time
  updated_at      INTEGER NOT NULL
  applied_at      INTEGER NULLABLE  -- set by Phase 5 after the actual ID3 write
  ```
- **Keep** action → upsert into `pending_tag_edits` (PK = `file_path`), advance to next card.
- **Skip** action → no DB write, just advance.
- Phase 5 (future) reads `pending_tag_edits WHERE applied_at IS NULL` and writes to the file atomically, then sets `applied_at`.
- For v1 (no Phase 5 yet) — the table accumulates; the user sees the editor working end-to-end except the actual file isn't touched. This is INTENTIONAL — the editor is the deliverable of this phase.
- Foreign key intentionally absent — `pending_tag_edits` survives independently of `scans` and `scanned_files` so re-scanning doesn't drop pending edits.

### Genre presets (TAGG-04)

- **Hybrid: top-9 from library, with hardcoded fallback when the library is small / untagged.**
- On Tagger mount, the main handler `tagger:get-genre-presets`:
  1. Queries `SELECT genre, COUNT(*) AS n FROM scanned_files WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY n DESC LIMIT 9`.
  2. Returns the result as `{ source: 'library', presets: [...up to 9 strings] }`.
  3. If fewer than 9 distinct genres exist in the library, the remaining slots are filled from the hardcoded fallback below (deduped, preserving library order first).
  4. If no library tags exist at all, returns `{ source: 'defaults', presets: [...9 hardcoded] }`.
- **Hardcoded fallback (DJ defaults):**
  1. House — 2. Techno — 3. Afro House — 4. Melodic — 5. Disco — 6. Hip-Hop — 7. Funk — 8. Deep — 9. Electronica
- Slot order = key 1-9 mapping. Slot 1 = the most-played library genre (or `House` for empty libs).
- Presets refresh on each Tagger mount — fast query, no cache. User-editable preset list deferred to a future phase.

### Card UX + preview audio (TAGG-02)

**Preview player:**
- 30s clip starting at **0:00** (track start). Researcher may revisit if intros are systematically silent in DJ libraries.
- **Auto-play** on card mount.
- **Mute toggle persistent** via `settings.tagger.muteEnabled` (default: false → audio plays). When muted, the preview still loads + advances but no sound. Toggle persists across sessions.
- Tech: **HTML `<audio>` element** with `src` pointing at a local `file://` URL (Electron renderer can load files under `rootFolder` via the standard file protocol with `webPreferences.webSecurity: true` and a CSP allowance — researcher confirms). NOT Web Audio API for v1: HTML audio is simpler, gives us native play/pause/seek/volume for free, and 30s is short enough that streaming isn't necessary.
- Loop at 30s back to 0:00 while the card is visible (so user has continuous audio context while editing).
- Stop + unload audio on card change (no leaks).

**Card layout:**
- All fields visible at once on the card — no tabs, no modal.
- Field stack: File name + path subtitle → Preview controls (play/mute/scrub) → Existing tags (read-only summary chips) → editable fields (Artist, Title, Genre, BPM, Key, Comment, Rating) → action row (Keep / Skip / Undo).
- Slide-horizontal animation on Keep (slides left) and Skip (slides right) to give the Tinder-style feel that PROJECT.md promised. ~250ms transform animation only (no layout-bound properties).

**Keyboard:**
- `←` Keep (save and advance)
- `→` Skip (advance)
- `1`-`9` Apply genre preset N (instant; no need to press Enter)
- `Cmd+Z` / `Ctrl+Z` Undo last action
- `Space` Toggle preview play/pause
- `M` Toggle mute (persists)
- Disable shortcuts while a text input has focus (so typing in BPM doesn't trigger preset 1).

### Energy / Rating (TAGG-07)

- UI: 1-5 clickable stars; click N stars sets rating to N.
- Internal storage: `pending_tag_edits.rating` INTEGER 1-5.
- POPM byte mapping (LOCKED — Rekordbox / Mp3tag convention; Phase 5 applies this):
  - 1★ → 51, 2★ → 102, 3★ → 153, 4★ → 204, 5★ → 255
  - 0 / unset → POPM frame omitted entirely
- Keyboard shortcut deferred — five star-press shortcuts conflict with genre presets 1-9. Phase 5 may revisit.

### Artist/Title split suggestion (TAGG-08)

- Triggered when `artist` field is empty AND `title` contains one of the locked separators: ` - ` (space-dash-space), ` -- ` (space-double-dash-space), or ` – ` (space-en-dash-space).
- Show a banner above the card with TWO suggestions:
  - **Suggestion A:** `Artist = "Daft Punk" / Title = "Around The World"` (left of sep = artist)
  - **Suggestion B:** `Artist = "Around The World" / Title = "Daft Punk"` (right of sep = artist)
- One click on a suggestion fills both fields. User can still edit afterward.
- The banner disappears once the user has either applied a suggestion OR manually edited the Artist field to non-empty.
- Separator detection is case-sensitive on the spaces (we do NOT trigger on `--` without surrounding spaces — too many false positives in filenames like `track--master`).

### Undo (TAGG-09)

- **In-memory only**, one-level deep, NOT persisted across sessions.
- `useTaggerStore` keeps `lastAction: { type: 'keep' | 'skip'; filePath; editsBeforeKeep?: ... } | null`.
- On Keep: snapshot prior pending row (or null) BEFORE upsert; push to `lastAction`.
- On Undo:
  - If `lastAction.type === 'keep'`: rewind currentIndex by 1, restore prior pending row (or DELETE if it was null), clear `lastAction`.
  - If `lastAction.type === 'skip'`: rewind currentIndex by 1, clear `lastAction`.
- Undo is disabled (greyed out) when `lastAction === null`.
- After undo, `lastAction` is cleared — no double-undo.

### Session resume (TAGG-10)

- **New table row `tagger_session(id INTEGER PRIMARY KEY CHECK (id = 1), root_folder TEXT, current_file_path TEXT, scan_id TEXT, updated_at INTEGER)` — single-row table.**
- Updated on every Keep / Skip / queue load (debounced 500ms to avoid write spam).
- On Tagger mount:
  1. Load queue (latest scan + filter).
  2. Read `tagger_session` row.
  3. If `tagger_session.current_file_path` exists in the new queue: jump to that file's index.
  4. Else: start at index 0 (file additions / removals between sessions → resync gracefully).
- Resume identity = file PATH (not queue index) — robust to library changes between sessions.
- Cleared if user clicks an explicit "Recommencer la file" button (future polish, not v1).

### IPC surface (LOCKED)

Extension to `IpcChannels` (`src/shared/ipc-types.ts`):

```ts
TaggerLoadQueue: 'tagger:load-queue'           // → { scanId, files: ScannedFile[], pendingEdits: Record<filePath, PendingEdit> }
TaggerSaveEdit: 'tagger:save-edit'             // upsert into pending_tag_edits
TaggerDeleteEdit: 'tagger:delete-edit'         // used by Undo on Keep
TaggerGetSession: 'tagger:get-session'         // → { currentFilePath: string | null }
TaggerSetSession: 'tagger:set-session'         // upsert current_file_path
TaggerGetGenrePresets: 'tagger:get-genre-presets'  // → { source: 'library' | 'defaults', presets: string[9] }
```

No `tagger:event` push channel — Tagger is purely renderer-driven (no background worker).

### Carry-forward decisions (from Phases 1-3)

LOCKED — every plan must follow:

- **Sandboxed preload** — only `electron` + shared types.
- **Folder allowlist gate** — every Tagger IPC handler that touches file paths validates resolution under `settings.rootFolder` (T-1-01 / T-3-01 mirror).
- **IpcChannels SoT** in `src/shared/ipc-types.ts`.
- **Repo factory + lazy singleton** in `connection.ts`.
- **Lazy `require('electron')`** in IPC registration for vitest purity.
- **Editorial dark-studio tokens** — reuse `:root` from `src/renderer/src/assets/main.css`. No new `--color-*`.
- **French copy** everywhere user-facing.
- **No mutation in store** — Zustand immutable updates only.
- **ID3v2.3 lock** carries into Phase 5 — but Phase 4 doesn't write ID3 frames, just stores intents.

</decisions>

<deferred>

Captured during discussion but explicitly OUT of Phase 4 scope. Surface in roadmap backlog when phase 4 ships.

- **Phase 5 file writes** — atomic ID3v2.3 / MP4 writes, the actual file mutation. Own phase already.
- **User-editable genre preset list** — settings panel to override the 9 slots.
- **Multi-level undo / redo** — only 1-level for v1.
- **Star-hotkey shortcuts** — conflicts with 1-9 genre presets; revisit if user pushes for it.
- **Tinder swipe gesture (touch / trackpad)** — keyboard + button only for v1. Slide animation simulates the feel.
- **Reset queue / start over button** — clear session, restart from index 0.
- **Filter UI** — show all files vs only-incomplete vs by-genre — v1 is locked to incomplete-tag filter (TAGG-01 verbatim).
- **Bulk re-tag from a master template** — out of scope.
- **Cue point detection for the preview offset** — locked to 0:00 for v1; researcher may flag if 33% works better.
- **Pre-Phase-5 file write fallback** — Tagger does NOT touch files in v1. The pending table is the deliverable.
- **Conflict detection** — what if the file changed on disk since the scan? v1 assumes the scan is fresh; researcher to flag mitigation.

</deferred>

<open_questions_for_research>

Things the researcher should investigate and lock before plans are written:

1. **HTML `<audio>` + Electron CSP** — confirm the exact `webPreferences` + CSP allowance that lets the renderer play a `file://` URL under `rootFolder` without disabling websecurity. Compare to a Web Audio API loadArrayBuffer approach if CSP fights us.
2. **Audio file format coverage** — verify HTML `<audio>` plays all 9 AUDIO_EXTS extensions (.mp3, .flac, .m4a, .aac, .wav, .aiff, .aif, .ogg, .opus) on both Mac and Windows builds. FLAC + AIFF are the wildcards.
3. **`tagger_session` debounce vs synchronous write** — confirm 500ms debounce on `set-session` is safe under rapid Keep/Skip spam (no missed final writes on quit).
4. **Top-9 genre query performance** — confirm `GROUP BY genre` with no index on `scanned_files.genre` is fine for ~10K row libraries. Add an index if not.
5. **Slide animation timing** — verify the 250ms transform-only slide doesn't visually conflict with the preview audio loop (audio shouldn't stutter mid-slide).
6. **Empty-state heuristic** — confirm `scanRepo.findLatestScan(rootFolder)` returns null vs the most-recent completed scan; locked-status edge cases (running/cancelled scans should NOT be picked up).
7. **Keyboard handler global vs scoped** — does it live on the TaggerView element with focus management, or via `document.addEventListener('keydown')` that the view registers/unregisters in useEffect? Locked: the latter (simpler, matches `useEffect → return cleanup`).
8. **POPM byte mapping cross-check** — confirm Rekordbox 6.x reads 51/102/153/204/255. Some implementations use 1/64/128/192/255 — Phase 5 will write, Phase 4 stores 1-5 so the mapping decision is Phase 5's, but documented here for forward awareness.

</open_questions_for_research>

---

## Summary of decisions captured

| Area | Decision |
|------|----------|
| Queue source | Latest Phase 2 scan of `rootFolder`, filtered to incomplete-tag rows |
| Re-scan from Tagger | Forbidden — Analyser owns scanning |
| Edit storage | `pending_tag_edits` SQLite table, PK = `file_path`, `applied_at` flag for Phase 5 |
| Phase 4 file writes | **None** — Phase 5 owns ID3 writes |
| Genre presets | Top-9 library genres, hardcoded fallback (House, Techno, Afro House, Melodic, Disco, Hip-Hop, Funk, Deep, Electronica) when scan empty / short |
| Preview audio | HTML `<audio>`, 30s loop from 0:00, auto-play, mute toggle persisted |
| Card layout | All fields visible at once, slide-horizontal animation on Keep / Skip |
| Keyboard | ← Keep / → Skip / 1-9 preset / Cmd-Z Undo / Space play-pause / M mute |
| Rating storage | INTEGER 1-5 in DB; POPM byte (51/102/153/204/255) derived at Phase 5 write time |
| Split separators | ` - ` / ` -- ` / ` – ` (case-sensitive on spaces) |
| Undo | 1 level, in-memory only |
| Session resume | `tagger_session` single-row table; identity by file path, robust to library changes |

## Next up

`/gsd-plan-phase 4` to break this into vertical-slice plans.
