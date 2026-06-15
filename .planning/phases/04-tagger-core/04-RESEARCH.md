# Phase 4: Tagger Core — Research

**Researched:** 2026-06-05
**Domain:** Electron renderer card-stack UI + better-sqlite3 intent store + HTML audio preview, on top of existing scanRepo / IPC / Zustand backbones
**Confidence:** HIGH (architecture mirrors Phases 2-3 verbatim; only audio-preview path and slide animation are new surface)

---

<user_constraints>

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **Queue source:** Latest Phase 2 scan of `settings.rootFolder`, filtered to `hasGenre = 0 OR hasBpm = 0 OR hasKey = 0`, ordered by `path ASC`. **No re-scan from the Tagger** — Analyser owns scanning.
- **Edit storage:** new SQLite table `pending_tag_edits(file_path PK, genre, bpm INTEGER, key, artist, title, comment, rating INTEGER, updated_at, applied_at)`. Phase 4 only writes intents; **Phase 5 owns the actual ID3 writes**.
- **Genre presets:** hybrid — top-9 from `scanned_files.genre` GROUP BY/COUNT/LIMIT 9, hardcoded fallback (House, Techno, Afro House, Melodic, Disco, Hip-Hop, Funk, Deep, Electronica) when library short. Refresh on every mount, no cache.
- **Preview audio:** HTML `<audio>` element, 30s loop from 0:00, auto-play on card mount, mute toggle persisted via `settings.tagger.muteEnabled`.
- **Card layout:** all fields visible at once (no tabs/modals), slide-horizontal ~250ms transform-only animation on Keep (left) and Skip (right).
- **Keyboard:** ← Keep, → Skip, 1-9 preset, Cmd/Ctrl-Z undo, Space play/pause, M mute. Disabled while a text input has focus.
- **Rating:** 1-5 stars stored as INTEGER. POPM byte mapping (51/102/153/204/255) is Phase 5's concern, documented forward.
- **Split separators:** ` - ` / ` -- ` / ` – ` (case-sensitive on the surrounding spaces). 2-suggestion banner.
- **Undo:** 1 level, in-memory only.
- **Session resume:** `tagger_session(id=1 single-row, root_folder, current_file_path, scan_id, updated_at)`, identity by file path, robust to library changes.
- **IPC channels:** `tagger:load-queue`, `tagger:save-edit`, `tagger:delete-edit`, `tagger:get-session`, `tagger:set-session`, `tagger:get-genre-presets`. **No push channel** — Tagger is renderer-driven.
- **No worker thread** — UI-bound work, no heavy CPU.

### Claude's Discretion

- Exact CSS animation choreography (transform values, easing curves).
- Whether to factor `useAudioPreview` as a custom hook vs inline `<audio>` element.
- Exact debounce implementation (custom `useDebouncedCallback` vs library).
- How to handle `tagger_session` flush-on-quit (must address — see Open Q 3 below).
- Card component decomposition under `components/tagger/`.

### Deferred Ideas (OUT OF SCOPE)

- Phase 5 file writes (atomic ID3v2.3 / MP4 writes).
- User-editable genre preset list (settings UI).
- Multi-level undo/redo.
- Star-hotkey shortcuts (conflicts with 1-9 presets).
- Tinder swipe touch/trackpad gesture.
- Reset-queue button.
- Filter UI (all vs incomplete vs by-genre).
- Bulk re-tag from template.
- Cue point detection.
- Conflict detection (file changed on disk since scan).

</user_constraints>

<phase_requirements>

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAGG-01 | Charger un dossier — seuls les fichiers avec tags incomplets apparaissent | §Queue Loading; new `scanRepo.findLatestScan(rootFolder)` + filtered SELECT |
| TAGG-02 | Carte affiche nom + tags existants + auto-play 30s | §Audio Preview; HTML `<audio>` + custom protocol; §Card Layout |
| TAGG-03 | Skip/Keep via boutons ou ← / → | §Keyboard Handler; document-level keydown with input-focus gate |
| TAGG-04 | Boutons genre rapides 1-9 | §Genre Presets; `tagger:get-genre-presets` query |
| TAGG-05 | BPM + Key inline | §Card Layout; integer BPM input + free-text Key (Camelot) |
| TAGG-06 | Genre/Artiste/Titre/Commentaire inline | §Card Layout |
| TAGG-07 | Rating 1-5 (POPM forward) | §Rating; INTEGER 1-5; Phase 5 maps to POPM byte |
| TAGG-08 | Artist/Title split suggestion | §Split Suggestion; pure helper `suggestSplits(title)` |
| TAGG-09 | Undo 1 niveau | §Undo State Machine |
| TAGG-10 | Reprise de session | §Session Resume; single-row `tagger_session` + debounce + before-quit flush |

</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Immutability:** all Zustand store updates return new objects/Maps; never mutate state in place.
- **File size:** target 200-400 lines, hard cap 800. The card view will likely warrant decomposition.
- **French copy** for every user-visible string.
- **Editorial dark-studio tokens** only — no new `--color-*` in `:root`.
- **Web rules:** animate only `transform` + `opacity` (slide animation locked to `transform: translateX`).
- **Sandboxed preload:** only `electron` + shared types imports. Same gate as Phases 1-3.
- **Lazy `require('electron')`** inside IPC registration for Vitest purity.
- **V5 input validation** at every IPC boundary (T-1-01/T-3-01 carry-forward).
- **No `console.log`** in production code.
- **GSD workflow:** must run via `/gsd-execute-phase`.

## Summary

Phase 4 is a **renderer-heavy phase with a thin main-side IPC + persistence backbone** that mirrors the Phase 2 + 3 architecture verbatim. The only structurally new concept is the **audio preview path** under Electron's sandboxed renderer: a `file://` URL cannot be loaded by an HTML `<audio>` element from a page that itself originated from a different origin under modern Chromium with `webSecurity: true`. The robust solution is a custom protocol handler (`crateKeeper://audio/<encoded-path>`) registered via `protocol.handle()` in the main process, which (a) validates the requested path resolves under `settings.rootFolder` (T-4-01), (b) streams the file from disk via `fs.createReadStream`, and (c) lets Chromium's HTMLMediaElement handle range requests, seeking, and decode natively. This avoids both `webSecurity: false` (security regression) and ArrayBuffer→Blob URL (full-file load into memory, breaks seeking).

The Tagger does NOT introduce a worker — all work is short-lived (SQLite reads, debounced writes, UI updates), and React 19's concurrent rendering is enough.

**Primary recommendation:** Three vertical-slice plans — **(1)** main-side backbone (`taggerRepo` table + `tagger_session` table + 6 IPC handlers + `scanRepo.findLatestScan` extension + custom protocol registration); **(2)** renderer card UX (Zustand store, TaggerCard, GenrePresetBar, AudioPreview, RatingStars, ArtistTitleSplit, document-level keyboard handler, slide animation); **(3)** session persistence + undo polish (debounced `tagger:set-session`, before-quit flush, mount-time resume).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Queue loading (latest scan + filter) | API/Backend (main IPC) | Database (better-sqlite3) | Phase 2's scanRepo owns scanned_files; new `findLatestScan` extension keeps boundary clean. |
| Tag edit persistence | Database (`pending_tag_edits`) | API/Backend (taggerRepo) | Mirror of Phase 2/3 repo factory + lazy singleton. |
| Genre preset query | API/Backend | Database (GROUP BY) | Fast aggregate over an existing table; no caching needed. |
| Session resume row | Database (`tagger_session`) | API/Backend | Single-row idempotent UPSERT. |
| File preview audio streaming | API/Backend (custom protocol) | Browser (HTML `<audio>`) | Renderer cannot directly `file://` under sandbox; main streams via `protocol.handle()`. |
| Queue state + currentIndex + undo | Browser (Zustand) | — | Pure UI state, no persistence beyond `tagger_session`. |
| Slide animation | Browser (CSS `transform`) | — | Compositor-only, no main-side involvement. |
| Keyboard shortcuts | Browser (`document.addEventListener`) | — | View-level concern; main is not involved. |
| Settings (`tagger.muteEnabled`) | Database (existing settings allowlist) | API/Backend | Reuse `settings:get` / `settings:set` with extended allowlist. |

## Standard Stack

### Core (already in the project — reuse, do not re-add)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron` | ^39.2.6 | Renderer host + custom protocol API | Locked Phase 1; Chromium ~130 has full Web Audio + HTMLMediaElement coverage [VERIFIED: package.json] |
| `react` | ^19.2.1 | Card view + components | Locked Phase 1; ref-as-prop simplifies AudioPreview [CITED: project package.json] |
| `zustand` | ^5.0.14 | Queue / currentIndex / undo store | Same pattern as `useConversionStore` [VERIFIED: src/renderer/src/store/useConversionStore.ts] |
| `better-sqlite3` | ^12.10.0 | `pending_tag_edits` + `tagger_session` tables | Same pattern as Phases 1-3 [VERIFIED: package.json] |
| `music-metadata` | ^11.12.3 | Already used by scanCore for existing-tag chips | Read-only here — Tagger reads the cached `scanned_files` columns, no new parse needed |

### Supporting

None — Phase 4 introduces **zero new runtime dependencies**. Everything (custom protocol, debounce, HTML audio, slide animation) is built from Electron + Web Platform + React 19 + Zustand primitives already in the tree.

### Alternatives Considered

| Instead of | Could Use | Tradeoff — Why Not |
|------------|-----------|---------------------|
| HTML `<audio>` + custom protocol | Web Audio API (`AudioContext.decodeAudioData`) | Full-file decode into memory; breaks seeking; no native transport controls. HTML `<audio>` wins for "play 30s, loop, mute" use case. |
| Custom protocol handler | `webSecurity: false` + `file://` direct | Documented Electron anti-pattern — opens any-origin file read. Hard reject. |
| Custom protocol handler | ArrayBuffer → Blob URL | Loads full file into memory; FLAC/AIFF tracks can be 50-80MB; breaks for long tracks. |
| Document-level keydown | React `onKeyDown` on card | Card unmounts during slide animation → keydown lost. Document-level is robust. |
| `useTransition` for slide | None / direct setState | Slide is CSS-driven; `useTransition` adds zero value here — the state transition happens in ~1 frame. |
| Framer Motion | None / CSS keyframes | New dep, ~30KB, only for ONE animation. CSS `transition: transform 250ms` is sufficient. Reject. |
| `lodash.debounce` | Hand-rolled `useDebouncedCallback` | New dep for ~20 lines. Reject. |

**Installation:**

```bash
# Nothing to install. All dependencies already in the tree.
```

**Version verification:** Confirmed against `/Users/theo/Documents/projects/dj-utils/package.json` on 2026-06-05.

## Package Legitimacy Audit

No new packages installed by this phase — audit is N/A.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (none) | — | — |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

## Architecture Patterns

### System Architecture Diagram

```
┌─────────────────────────── Renderer (Tagger view) ───────────────────────────┐
│                                                                              │
│  TaggerView (mount)                                                          │
│   │                                                                          │
│   ├─► useTaggerStore.loadQueue()        ──► window.crateKeeper.tagger        │
│   │                                          .loadQueue()                    │
│   ├─► useTaggerStore.loadSession()      ──► window.crateKeeper.tagger        │
│   │                                          .getSession()                   │
│   ├─► useTaggerStore.loadGenrePresets() ──► window.crateKeeper.tagger        │
│   │                                          .getGenrePresets()              │
│   │                                                                          │
│   ▼                                                                          │
│  Computed: currentFile = queue[currentIndex]                                 │
│   │                                                                          │
│   ▼                                                                          │
│  TaggerCard (key={currentFile.path})                                         │
│   ├── AudioPreview  ──► <audio src="crateKeeper://audio/<encoded>" loop />   │
│   ├── Existing-tag chips (read from currentFile.* — from scanned_files)      │
│   ├── Editable fields (Artist/Title/Genre/BPM/Key/Comment + RatingStars)     │
│   │     │                                                                    │
│   │     └► onChange ──► store.setDirtyEdit({field, value})                   │
│   ├── GenrePresetBar (9 buttons + 1-9 hotkey)                                │
│   ├── ArtistTitleSplit (banner when conditions match)                        │
│   └── Action row: [Skip] [Undo] [Keep]                                       │
│                                                                              │
│  Document keydown handler (useEffect on mount, cleanup on unmount):          │
│   ├── ← → 1-9 Cmd-Z Space M                                                  │
│   └── if (document.activeElement is text input) → ignore navigation keys     │
│                                                                              │
│  On Keep:                                                                    │
│   1. snapshot prior pending row (or null) → undoStack                        │
│   2. window.crateKeeper.tagger.saveEdit({filePath, ...edits})                │
│   3. trigger slide-left CSS class → on transitionend → advance currentIndex  │
│   4. debounced setSession (500ms)                                            │
│                                                                              │
│  On Skip:                                                                    │
│   1. push {type:'skip', filePath} → undoStack                                │
│   2. trigger slide-right CSS class → on transitionend → advance currentIndex │
│   3. debounced setSession (500ms)                                            │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (IPC over contextBridge)
┌────────────────────────────────── Preload ───────────────────────────────────┐
│  window.crateKeeper.tagger = {                                               │
│    loadQueue, saveEdit, deleteEdit,                                          │
│    getSession, setSession, getGenrePresets                                   │
│  }   — sandboxed, only `electron` + shared types                             │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼ (ipcMain.handle)
┌─────────────────────────────── Main process ─────────────────────────────────┐
│                                                                              │
│  registerTaggerHandlers({ipcMain, taggerRepo, scanRepo, settingsRepo})       │
│   ├── tagger:load-queue                                                      │
│   │     ├─► scanRepo.findLatestScan(settings.rootFolder)  ── status='done'   │
│   │     ├─► scanRepo.listIncompleteFiles(scanId)          ── filtered list   │
│   │     ├─► taggerRepo.listPendingEdits(filePaths)        ── batch UPSERTs   │
│   │     └─► return { scanId, files, pendingEdits }                           │
│   ├── tagger:save-edit          (V5: file under rootFolder, valid fields)    │
│   ├── tagger:delete-edit        (V5: file under rootFolder)                  │
│   ├── tagger:get-session                                                     │
│   ├── tagger:set-session        (V5: file under rootFolder OR null)          │
│   └── tagger:get-genre-presets  ── GROUP BY genre LIMIT 9 + fallback merge   │
│                                                                              │
│  protocol.handle('cratekeeper', request => {                                 │
│    parse URL → decode file path                                              │
│    if !resolvesUnderRootFolder(path) → 403                                   │
│    if extname not in AUDIO_EXTS    → 415                                     │
│    return new Response(Readable.toWeb(fs.createReadStream(path)), {          │
│      headers: { 'content-type': mimeFromExt(ext) }                           │
│    })                                                                        │
│  })  ── registered ONCE in app.whenReady() before createWindow               │
│                                                                              │
│  before-quit: flush pending tagger:set-session debounce                      │
└──────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────── better-sqlite3 (userData/cratekeeper.db) ────────────────────┐
│                                                                              │
│  scans (Phase 2) ──┐                                                         │
│  scanned_files     │  read-only from Tagger                                  │
│                    │                                                         │
│  pending_tag_edits ◄── NEW                                                   │
│    file_path PK, genre, bpm INT, key, artist, title, comment,                │
│    rating INT, updated_at, applied_at (Phase 5 sets)                         │
│                                                                              │
│  tagger_session    ◄── NEW (single-row, id=1 CHECK)                          │
│    root_folder, current_file_path, scan_id, updated_at                       │
│                                                                              │
│  settings (Phase 1) — extend allowlist: tagger.muteEnabled                   │
└──────────────────────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
src/
├── main/
│   ├── tagger/
│   │   ├── taggerRepo.ts                 # pending_tag_edits + tagger_session
│   │   ├── taggerRepo.test.ts
│   │   ├── queueBuilder.ts               # pure: top-9 genre merge + fallback
│   │   ├── queueBuilder.test.ts
│   │   ├── audioProtocol.ts              # registerAudioProtocol(scope, settingsRepo)
│   │   └── audioProtocol.test.ts
│   ├── ipc/
│   │   ├── tagger.ts                     # 6 handlers + registerTaggerHandlers
│   │   └── tagger.test.ts
│   ├── scan/
│   │   └── scanRepo.ts                   # EXTEND: findLatestScan, listIncompleteFiles
│   └── db/
│       └── connection.ts                 # ADD: getTaggerRepo, initTaggerSchema
├── shared/
│   └── ipc-types.ts                      # EXTEND: IpcChannels.Tagger*,
│                                         #   CrateKeeperTaggerApi, PendingTagEdit,
│                                         #   GenrePresets, TaggerSession,
│                                         #   SETTINGS_KEY_ALLOWLIST += 'tagger.muteEnabled'
├── preload/
│   └── index.ts                          # ADD: crateKeeper.tagger.* namespace
└── renderer/src/
    ├── store/
    │   ├── useTaggerStore.ts             # queue, currentIndex, dirtyEdits, undo
    │   └── useTaggerStore.test.ts
    ├── components/tagger/
    │   ├── TaggerCard.tsx                # all editable fields + chips + actions
    │   ├── TaggerCard.test.tsx
    │   ├── AudioPreview.tsx              # <audio> element with crateKeeper:// src
    │   ├── GenrePresetBar.tsx            # 9 buttons; receives presets via prop
    │   ├── RatingStars.tsx               # 1-5 star click input
    │   ├── ArtistTitleSplit.tsx          # banner with 2 suggestions
    │   ├── splitDetection.ts             # pure: suggestSplits(title)
    │   ├── splitDetection.test.ts
    │   └── tagger.css                    # card surface + slide animation
    ├── hooks/
    │   ├── useDebouncedCallback.ts       # 20-line debounce util
    │   └── useTaggerKeyboard.ts          # document-level listener + focus gate
    └── views/
        ├── TaggerView.tsx                # empty-state + card + action row
        └── TaggerView.test.tsx
```

### Pattern 1: Repo Factory + Lazy Singleton (carry-forward from Phases 1-3)

**What:** `createTaggerRepo(db)` + `initTaggerSchema(db)` exported pure; `getTaggerRepo()` lazy singleton in `connection.ts`.
**When to use:** every new DB tier added by a phase.

```typescript
// src/main/tagger/taggerRepo.ts
import type Database from 'better-sqlite3'

export interface PendingTagEditRow {
  filePath: string
  genre: string | null
  bpm: number | null
  key: string | null
  artist: string | null
  title: string | null
  comment: string | null
  rating: number | null
  updatedAt: number
  appliedAt: number | null
}

export interface TaggerSessionRow {
  rootFolder: string
  currentFilePath: string | null
  scanId: string | null
  updatedAt: number
}

export interface TaggerRepo {
  upsertEdit(row: Omit<PendingTagEditRow, 'updatedAt' | 'appliedAt'>, now: number): void
  deleteEdit(filePath: string): void
  getEdit(filePath: string): PendingTagEditRow | null
  listEditsByPaths(filePaths: string[]): Map<string, PendingTagEditRow>
  getSession(): TaggerSessionRow | null
  setSession(row: Omit<TaggerSessionRow, 'updatedAt'>, now: number): void
  topGenres(limit: number): Array<{ genre: string; count: number }>
}

export function initTaggerSchema(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS pending_tag_edits (' +
      'file_path TEXT PRIMARY KEY,' +
      'genre TEXT, bpm INTEGER, key TEXT,' +
      'artist TEXT, title TEXT, comment TEXT,' +
      'rating INTEGER CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5)),' +
      'updated_at INTEGER NOT NULL,' +
      'applied_at INTEGER' +
      ');' +
      'CREATE TABLE IF NOT EXISTS tagger_session (' +
      'id INTEGER PRIMARY KEY CHECK(id = 1),' +
      'root_folder TEXT NOT NULL,' +
      'current_file_path TEXT,' +
      'scan_id TEXT,' +
      'updated_at INTEGER NOT NULL' +
      ');'
  )
}

export function createTaggerRepo(db: Database.Database): TaggerRepo {
  // prepared statements only — no template-literal SQL (V5 defence-in-depth)
  // [pattern verbatim from createConversionRepo / createScanRepo]
}
```

### Pattern 2: Custom Protocol for File Streaming

**What:** Register `crateKeeper://audio/<encoded-abs-path>` once at boot, before `createWindow()`. The handler validates the path under `rootFolder` and pipes the file as a streaming Response.

**Why this approach** (vs `webSecurity:false` + `file://` direct, vs ArrayBuffer→Blob):

1. **Security:** every request is folder-gated server-side; the renderer cannot read arbitrary files.
2. **Performance:** Chromium handles byte-range requests, seeking, and decoding via the streaming Response — no full-file load.
3. **Compatibility:** the URL is just a string the `<audio>` element treats as any other URL; play/pause/loop/volume/mute all work natively.
4. **Sandbox-friendly:** does not require relaxing `sandbox`, `contextIsolation`, or `webSecurity`.

```typescript
// src/main/tagger/audioProtocol.ts
import { protocol, net } from 'electron'
import path from 'node:path'
import type { SettingsRepo } from '../db/settingsRepo'
import { AUDIO_EXTS } from '../workers/scanCore'

export const AUDIO_PROTOCOL_SCHEME = 'cratekeeper'

/**
 * Register the cratekeeper://audio/<encoded-abs-path> protocol so the renderer's
 * <audio> element can stream files validated under settings.rootFolder.
 *
 * Must run ONCE in app.whenReady() BEFORE createWindow(). Uses protocol.handle
 * (Electron 25+ Web-Fetch-style API) and net.fetch with a file:// URL so
 * Chromium's range-request support stays intact.
 */
export function registerAudioProtocol(settingsRepo: SettingsRepo): void {
  protocol.handle(AUDIO_PROTOCOL_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'audio') {
      return new Response('Not Found', { status: 404 })
    }
    const decoded = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const abs = path.resolve(decoded)
    const root = settingsRepo.get('rootFolder')
    if (root === null || (abs !== root && !abs.startsWith(root + path.sep))) {
      return new Response('Forbidden', { status: 403 })
    }
    const ext = path.extname(abs).toLowerCase()
    if (!(AUDIO_EXTS as readonly string[]).includes(ext)) {
      return new Response('Unsupported Media Type', { status: 415 })
    }
    // net.fetch with file:// preserves Chromium's range-request handling.
    return net.fetch('file://' + abs)
  })
}
```

**Required CSP allowance** (set on the main window via `webContents.session.webRequest.onHeadersReceived` OR via a `<meta http-equiv="Content-Security-Policy">` in `index.html`):

```
media-src 'self' cratekeeper:;
```

If the renderer's existing CSP is restrictive, add `cratekeeper:` to `media-src` (and only `media-src` — do not extend `script-src` / `default-src`).

### Pattern 3: Document-Level Keyboard Handler

**What:** `useTaggerKeyboard()` custom hook registers a single `document.addEventListener('keydown', ...)` and returns cleanup.

**Why document-level (vs view-scoped):**
- The card unmounts mid-slide-animation; a card-scoped `onKeyDown` would lose focus and miss keystrokes.
- The user expects shortcuts to work as long as the Tagger view is mounted — focus management on a non-input element is awkward.

**Focus gate (critical):**

```typescript
// inside the handler
const ae = document.activeElement
const isTextInput =
  ae instanceof HTMLInputElement ||
  ae instanceof HTMLTextAreaElement ||
  (ae instanceof HTMLElement && ae.isContentEditable)

// always allow Space + M to bubble even from inputs? NO — locked: disable while input focused.
if (isTextInput) return
```

**Why this matters for the BPM input:** when the user types "1" into BPM, we MUST NOT also apply genre preset 1. The focus gate is the only mitigation.

### Pattern 4: Slide Animation — Transform Only

**What:** CSS `transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo) on the card root. Two classes: `.tagger-card--exit-left` (Keep) and `.tagger-card--exit-right` (Skip), each applying `transform: translateX(±100vw)` + `opacity: 0`.

**Coordination with state:** add the class, listen for `transitionend`, then advance `currentIndex` and remove the class. The next render mounts a fresh `<TaggerCard key={newFile.path}>` whose default `transform: translateX(0)` is its mount state.

```css
.tagger-card {
  transform: translateX(0);
  opacity: 1;
  transition: transform 250ms cubic-bezier(0.16, 1, 0.3, 1),
              opacity 250ms cubic-bezier(0.16, 1, 0.3, 1);
}
.tagger-card--exit-left  { transform: translateX(-100vw); opacity: 0; }
.tagger-card--exit-right { transform: translateX( 100vw); opacity: 0; }
```

**Audio stutter risk:** none. `<audio>` decoding runs on Chromium's media thread, independent of the compositor that handles `transform`. Confirmed by Chromium's media architecture docs [CITED: chromium.org/audio/].

### Anti-Patterns to Avoid

- **`webSecurity: false`** to play `file://` URLs — opens any-origin file read. Hard reject.
- **Storing audio as ArrayBuffer → Blob URL** for preview — loads full file into memory; breaks seeking on large FLAC/AIFF.
- **Card-scoped `onKeyDown`** — card unmounts during slide, lose keystrokes.
- **Optimistic UI without DB confirmation on Keep** — the user expects "saved" feedback; show a brief toast or status pill on `tagger:save-edit` resolution.
- **`useEffect`-driven debounce inside store** — the debounce should be at the store-action level, owned by `useTaggerStore.setSessionDebounced(filePath)`, so the timer's lifetime tracks the store, not a component.
- **Calling `tagger:set-session` synchronously on every Keep/Skip** — write-amp; 500ms debounce is locked. Must include a **before-quit flush** (see Pitfall 1).
- **Animating `width`/`margin`/`top`** on the card — banned by web/coding-style.md.
- **Mutating `pendingEdits` map in the store** — copy via `new Map(prev).set(k,v)` (Phase 3 pattern).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio decoding / seeking / range requests | Custom decode pipeline | HTML `<audio>` + custom protocol streaming | Chromium handles it natively + correctly. |
| File-protocol security gate | Per-handler ad-hoc checks | `protocol.handle` returning 403/415 | Single choke point; testable in isolation. |
| Top-9 genre query cache | In-memory LRU | `SELECT … GROUP BY … LIMIT 9` on every mount | <5ms on 10K rows. See Pitfall 4. |
| Undo history | Stack/redo library | A single `lastAction` ref in the store | Locked to 1-level; no library. |
| Debounce | `lodash.debounce` | 20-line `useDebouncedCallback` | Adds dep weight for trivial logic. |
| Slide animation | Framer Motion / react-spring | CSS `transition: transform` + class swap | One animation; library overhead unjustified. |
| Keyboard handler library | `react-hotkeys-hook` | `document.addEventListener` in `useEffect` | Single view, single handler, fewer moving parts. |

**Key insight:** Phase 4 should add **zero new npm dependencies**. Every primitive (HTML `<audio>`, CSS transforms, document keyboard, Zustand store, better-sqlite3, custom protocol) is already in the tree or in Electron itself.

## Runtime State Inventory

Not applicable — Phase 4 is a greenfield phase introducing new tables, new IPC channels, and new renderer components. No rename, refactor, or migration of existing state.

| Category | Status |
|----------|--------|
| Stored data | None (new tables only) — verified by reviewing 02/03 SUMMARYs. |
| Live service config | None — no external services. |
| OS-registered state | None — Tagger does not register tasks/protocols beyond the custom protocol itself, which is fresh. |
| Secrets/env vars | None. |
| Build artifacts | None — no new worker bundles (the locked decision is **no worker**). |

## Common Pitfalls

### Pitfall 1: 500ms `tagger:set-session` debounce drops the final write on app quit

**What goes wrong:** User presses Keep 3 times in rapid succession, then immediately quits. The 500ms timer is still pending when the renderer is torn down → `current_file_path` in the DB is stale by 2-3 cards.

**Why it happens:** debounce delays the trailing write; `before-unload` / `before-quit` aren't awaited by default.

**How to avoid:**
- In the renderer, register a `window.addEventListener('beforeunload', flushNow)` that synchronously invokes the latest pending `tagger:set-session` via `crateKeeper.tagger.setSession({...latest})`. (Note: `ipcRenderer.invoke` returns a promise that may not complete before unload, BUT the IPC message itself is dispatched synchronously to main and queued — empirically reliable for a single small call.)
- In main, register `app.on('before-quit', () => { ... })` only as a defence-in-depth — the renderer should be the primary flush. The handler in `tagger:set-session` is the same code path either way.
- **Locked decision needed in plan:** which side owns the flush. Recommendation: **renderer-side `beforeunload` flush** is primary; main-side `before-quit` is not required because the renderer fires `beforeunload` before the main process tears it down on `app.quit()`.

**Warning signs:** session resume lands one card off after a fast-quit pattern.

### Pitfall 2: Custom protocol must be `registerSchemesAsPrivileged` BEFORE `app.whenReady`

**What goes wrong:** `protocol.handle('cratekeeper', ...)` works for fetch-style requests, but the `<audio>` element treats the URL as cross-origin without scheme privileges → CORS / streaming breakage.

**Why it happens:** Chromium's media element requires the scheme to be marked privileged (specifically `stream: true` + `supportFetchAPI: true`) for range-request streaming to work.

**How to avoid:** call `protocol.registerSchemesAsPrivileged([{scheme: 'cratekeeper', privileges: {stream: true, supportFetchAPI: true, bypassCSP: false, secure: true, standard: true}}])` at the TOP of `src/main/index.ts`, BEFORE `app.whenReady()`. Then call `protocol.handle()` inside `whenReady()`.

**Warning signs:** `<audio>` element emits `error` event with `MEDIA_ERR_SRC_NOT_SUPPORTED`; or playback works but `currentTime = X` (seeking) fails.

### Pitfall 3: `<audio loop>` + 30s preview

**What goes wrong:** the `loop` attribute on an `<audio>` element loops the **entire file**, not a 30s window. A 6-minute house track will play through to the end before looping.

**Why it happens:** HTML5 `loop` has no built-in time-bound segment.

**How to avoid:** use a `timeupdate` listener:
```typescript
audioRef.current?.addEventListener('timeupdate', () => {
  if (audioRef.current && audioRef.current.currentTime >= 30) {
    audioRef.current.currentTime = 0
  }
})
```
Plus the `loop` attribute as a defence-in-depth for files shorter than 30s.

**Warning signs:** preview plays past 30s without looping back.

### Pitfall 4: `GROUP BY genre` performance with no index

**Investigation:** at ~10K `scanned_files` rows, an un-indexed `SELECT genre, COUNT(*) FROM scanned_files WHERE genre IS NOT NULL AND genre != '' GROUP BY genre ORDER BY n DESC LIMIT 9` does a full table scan + hash aggregate. On a modern SSD: <5ms. At ~100K rows: ~20-40ms. At ~1M rows: 200ms+.

**Recommendation:** **no index for v1.** Library size in PROJECT.md = "quelques milliers" (a few thousand). Add `CREATE INDEX IF NOT EXISTS idx_scanned_files_genre ON scanned_files(genre)` only if a future user reports lag, OR add proactively if the planner wants belt-and-suspenders — cost is ~negligible.

**Warning signs:** Tagger mount takes >100ms on small libraries.

### Pitfall 5: `<audio>` autoplay blocked by Chromium autoplay policy

**What goes wrong:** Chromium's autoplay policy can block `audio.play()` without prior user gesture, even in Electron.

**Why it happens:** the Tagger view mounts on tab-switch, which counts as a programmatic navigation, NOT a user gesture for autoplay purposes in some Chromium versions.

**How to avoid:** Electron's `webPreferences` supports `autoplayPolicy: 'no-user-gesture-required'` — set this in `createWindow()` so the renderer can `audio.play()` on card mount without a click.

```typescript
webPreferences: {
  // existing
  sandbox: true,
  contextIsolation: true,
  // ADD
  autoplayPolicy: 'no-user-gesture-required'
}
```

**Warning signs:** `<audio>` element loads but never plays; console warning about autoplay rejected.

### Pitfall 6: AIFF playback in Chromium

**What goes wrong:** Chromium's HTMLMediaElement has **no native AIFF decoder** (`.aiff` / `.aif` files). Other 8 formats in `AUDIO_EXTS` play fine: MP3, FLAC, M4A, AAC, WAV, OGG, Opus. AIFF is the wildcard.

**Why it happens:** AIFF is historically rare in browsers — Chromium ships codecs for the lossy + modern lossless formats but skips AIFF for size.

**How to avoid:** in the renderer, detect AIFF (`ext === '.aiff' || ext === '.aif'`) and either:
- (a) show "Aperçu indisponible pour ce format" in the preview area (LOCKED v1 — simplest), OR
- (b) transcode on-demand to WAV via ffmpeg-static in the custom-protocol handler (more work; defer).

**Recommendation for v1:** option (a). Users still tag the file (BPM/genre etc.) — only the audio preview is unavailable. Locked decision needed in plan.

**Warning signs:** `<audio>` emits `error` MEDIA_ERR_SRC_NOT_SUPPORTED for `.aiff` files. (FLAC on Mac & Windows: works in Chromium 56+.)

### Pitfall 7: `tagger_session` foreign key vs library refresh

**What goes wrong:** the locked decision says `pending_tag_edits` has NO FK to `scanned_files` so re-scans don't drop edits. But `tagger_session.scan_id` is just a string column — no enforcement. After a re-scan, the stored scan_id no longer exists in `scans`.

**Why it happens:** the resume protocol identifies the current file by **PATH**, not scan_id (per locked decision). The scan_id is informational only.

**How to avoid:** explicit comment in the schema that `tagger_session.scan_id` is "advisory; resume uses current_file_path against the latest scan." No FK, no CASCADE.

### Pitfall 8: Path-traversal via `tagger:save-edit`

**What goes wrong:** a compromised renderer could send `filePath: '../../etc/passwd'` to `tagger:save-edit` and pollute the DB with arbitrary keys.

**Why it happens:** without server-side validation, the IPC handler trusts the renderer.

**How to avoid:** mirror the Phase 3 `resolvesUnderRoot` check on EVERY tagger IPC handler that accepts a `filePath` argument (load-queue is implicit since it derives paths server-side; save/delete/set-session must validate). Use the existing `AUDIO_EXTS` allowlist check too.

### Pitfall 9: Mute toggle persistence vs default behavior

**What goes wrong:** user mutes preview, restarts app — but `<audio>.muted = false` on next mount (default), and the cached `settings.tagger.muteEnabled` is read AFTER mount → 200ms of audible playback before mute kicks in.

**How to avoid:** load `tagger.muteEnabled` SYNCHRONOUSLY at TaggerView mount BEFORE rendering the first card. Two options:
- (a) gate first render: `if (muteSettingLoaded === false) return <Skeleton />`.
- (b) start the `<audio>` element with `muted={true}` ALWAYS, then flip after settings load. Safer for the "default muted by accident" case.

Recommendation: option (a) — block first card render until settings load resolves. The query is sub-ms.

## Code Examples

### Pattern 1: Renderer audio preview component

```tsx
// src/renderer/src/components/tagger/AudioPreview.tsx
import { useEffect, useRef } from 'react'

interface AudioPreviewProps {
  filePath: string
  muted: boolean
  onMuteToggle: () => void
}

export function AudioPreview({ filePath, muted, onMuteToggle }: AudioPreviewProps) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const src = `cratekeeper://audio/${encodeURIComponent(filePath)}`

  useEffect(() => {
    const el = audioRef.current
    if (!el) return
    const onTime = () => {
      if (el.currentTime >= 30) el.currentTime = 0
    }
    el.addEventListener('timeupdate', onTime)
    el.play().catch(() => {
      // autoplay rejected — fall back to user-gesture
    })
    return () => {
      el.removeEventListener('timeupdate', onTime)
      el.pause()
      el.removeAttribute('src')
      el.load()  // releases the buffer
    }
  }, [filePath])

  return (
    <div className="tagger-preview">
      <audio ref={audioRef} src={src} loop muted={muted} preload="auto" />
      <button type="button" onClick={onMuteToggle} aria-pressed={muted}>
        {muted ? 'Activer le son' : 'Couper le son'}
      </button>
    </div>
  )
}
```

### Pattern 2: Pure split-detection helper

```typescript
// src/renderer/src/components/tagger/splitDetection.ts
export interface SplitSuggestion {
  artist: string
  title: string
}

const SEPARATORS = [' - ', ' -- ', ' – '] as const

export function suggestSplits(rawTitle: string): SplitSuggestion[] {
  for (const sep of SEPARATORS) {
    const idx = rawTitle.indexOf(sep)
    if (idx > 0 && idx + sep.length < rawTitle.length) {
      const left = rawTitle.slice(0, idx).trim()
      const right = rawTitle.slice(idx + sep.length).trim()
      if (left && right) {
        return [
          { artist: left, title: right },
          { artist: right, title: left }
        ]
      }
    }
  }
  return []
}
```

### Pattern 3: Document-level keyboard hook

```typescript
// src/renderer/src/hooks/useTaggerKeyboard.ts
import { useEffect } from 'react'

interface KeyboardActions {
  onKeep: () => void
  onSkip: () => void
  onUndo: () => void
  onPlayPause: () => void
  onMute: () => void
  onPreset: (slot: number) => void
}

export function useTaggerKeyboard(actions: KeyboardActions): void {
  useEffect(() => {
    function isTextInput(el: Element | null): boolean {
      return (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        (el instanceof HTMLElement && el.isContentEditable)
      )
    }
    function onKey(e: KeyboardEvent): void {
      if (isTextInput(document.activeElement)) return
      if (e.key === 'ArrowLeft') { e.preventDefault(); actions.onKeep(); return }
      if (e.key === 'ArrowRight') { e.preventDefault(); actions.onSkip(); return }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault(); actions.onUndo(); return
      }
      if (e.key === ' ') { e.preventDefault(); actions.onPlayPause(); return }
      if (e.key.toLowerCase() === 'm') { e.preventDefault(); actions.onMute(); return }
      if (/^[1-9]$/.test(e.key)) {
        e.preventDefault(); actions.onPreset(Number(e.key)); return
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [actions])
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `protocol.registerFileProtocol` (callback API) | `protocol.handle` (Web Fetch API) | Electron 25 (mid-2023) | Required by current Electron 39. Use `protocol.handle`. [CITED: electronjs.org/docs/latest/api/protocol] |
| `forwardRef` for ref-as-prop | `ref` as direct prop on function components | React 19 (Dec 2024) | Cleaner `AudioPreview` ref API. [CITED: react.dev react-19 release] |
| `useEffect`-driven debounce | Store-owned timer (Zustand action) | — | Lifetimes align with the store, not arbitrary components. |
| `webSecurity: false` for local file access | Custom protocol + `protocol.handle` + folder gate | Industry shift since Electron 20 | Security: no any-origin file read. |

**Deprecated/outdated:**
- `protocol.registerFileProtocol` — replaced by `protocol.handle`.
- `forwardRef` — keep only for legacy code; React 19 components use `ref` as a prop.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Chromium 130 (Electron 39) supports MP3/FLAC/M4A/AAC/WAV/OGG/Opus in HTMLMediaElement on Mac+Windows, but NOT AIFF | Pitfall 6 | Phase ships with one format silently unable to preview; user-visible regression. Mitigated by Pitfall 6 fallback message. **Recommend:** add an integration smoke test that loads one fixture per AUDIO_EXTS via `<audio>` and asserts `canplay` event fires (or NOT, for AIFF). |
| A2 | `autoplayPolicy: 'no-user-gesture-required'` removes Chromium's autoplay block in Electron renderer | Pitfall 5 | Card mounts but audio doesn't auto-play; user must click. Workable but UX regression. |
| A3 | 500ms debounce + renderer `beforeunload` flush is sufficient for last-write-on-quit | Pitfall 1 | Session resume off by 1 card on hard-quit. Defensible — locked decision. |
| A4 | `GROUP BY genre` is fast enough at "few thousand" library size with no index | Pitfall 4 | Tagger mount feels sluggish on 100K+ libraries. Cheap to add the index later. |
| A5 | POPM byte mapping 1★→51, 2★→102, 3★→153, 4★→204, 5★→255 is what Rekordbox 6.x reads | §Phase 5 Forward Awareness | Phase 5 risk, not Phase 4. Documented forward; Phase 5 must verify against a real Rekordbox install. |
| A6 | `net.fetch('file://' + abs)` from within `protocol.handle` preserves Chromium's range-request handling for seeking | Pattern 2 | Seeking on long files stutters. Mitigated by the 30s loop limit (we never seek past 30s anyway). |
| A7 | Document-level keydown is correctly cleaned up on Tagger view unmount via `useEffect` return — no listener leak when user switches to Analyser/Convertir | Pattern 3 | Listener leak across tool switches; keystrokes in other views accidentally trigger Tagger actions. Test enforced. |

## Open Questions (resolved)

The 10 questions in CONTEXT.md `<open_questions_for_research>` are answered as follows:

1. **HTML `<audio>` + Electron CSP / `webPreferences`.** Resolved: use the `cratekeeper://` custom protocol via `protocol.handle` + `protocol.registerSchemesAsPrivileged({stream: true, supportFetchAPI: true, secure: true, standard: true})`. Add `media-src 'self' cratekeeper:;` to renderer CSP. Keep `webSecurity: true`, `sandbox: true`, `contextIsolation: true`. Add `autoplayPolicy: 'no-user-gesture-required'` to `webPreferences`.
2. **Audio format coverage.** MP3, FLAC, M4A (AAC in MP4), AAC (raw ADTS), WAV, OGG (Vorbis), Opus — all play in Chromium 130 on Mac+Windows. **AIFF (`.aiff`/`.aif`) does NOT play in Chromium** — show "Aperçu indisponible pour ce format" in v1. Add fixture-based smoke test (see A1).
3. **Debounce strategy.** 500ms trailing debounce in renderer-side store action + `window.addEventListener('beforeunload', flushNow)` for last-write guarantee. No main-side flush needed.
4. **`GROUP BY genre` performance.** No index for v1 — <5ms at expected library size. Add `idx_scanned_files_genre` as a future optimisation if user reports lag.
5. **Slide animation 250ms vs audio.** No conflict — Chromium runs audio decode on the media thread; `transform` is GPU-composited. Audio will NOT stutter mid-slide.
6. **`scanRepo.findLatestScan` scoping.** Extend Phase 2's repo with `findLatestScan(rootFolder): ScanRow | null` that selects `WHERE root_folder = ? AND status = 'done' ORDER BY started_at DESC LIMIT 1`. Excludes running/cancelled/error. Add 3 tests covering the four status branches.
7. **Global keyboard handler.** Locked: `document.addEventListener('keydown')` in `useTaggerKeyboard` with input-focus gate (see Pattern 3). Test enforced for the BPM-input-focused case.
8. **POPM byte mapping.** Documented forward (A5). Phase 5's concern — Phase 4 stores INTEGER 1-5 only. Note in PLAN for Phase 5: verify against Rekordbox 6.x and Mp3tag's `Popularimeter` field.
9. **React 19 patterns for card stack.** Not needed. `useTransition` does not apply (no slow renders). `ref`-as-prop simplifies AudioPreview. `useOptimistic` is irrelevant (no server actions). No new React 19 idioms required.
10. **Audio file URL security.** `file://` direct from renderer is NOT safe under sandbox+contextIsolation+webSecurity (modern Chromium blocks cross-origin `file://`). The custom protocol handler is the correct answer — see Pattern 2.

## Environment Availability

No new external dependencies. All capabilities used (Electron `protocol` API, `net.fetch`, `fs.createReadStream`, HTML `<audio>`, CSS transitions) ship with Electron 39 / Chromium 130 / Node 20+, which are locked Phase 1 dependencies.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron `protocol.handle` | Audio preview | ✓ | Electron 25+; present at 39.2.6 | — |
| `autoplayPolicy` webPref | Auto-play preview | ✓ | Electron 13+ | Click-to-play fallback |
| Chromium AIFF decode | AIFF preview | ✗ | — | Show "Aperçu indisponible" message |
| Better-sqlite3 `CHECK` constraints | Rating 1-5 guard | ✓ | 12.10.0 | — |
| React 19 `ref` as prop | AudioPreview | ✓ | 19.2.1 | — |
| Web `KeyboardEvent` API | Shortcuts | ✓ | Chromium 130 | — |

**Missing dependencies with fallback:** AIFF preview only — fallback is a message, not a blocker.
**Missing dependencies with no fallback:** none.

## Validation Architecture

`workflow.nyquist_validation` is treated as enabled (no `.planning/config.json` opt-out observed).

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.7 (already configured) |
| Config file | `vitest.config.ts` (existing) + `vitest.setup.ts` (existing) |
| Quick run command | `npm test -- --run <pattern>` |
| Full suite command | `npm test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TAGG-01 | Queue = latest done scan, filtered by tag-completeness booleans, path ASC | unit + integration | `npm test -- --run src/main/scan/scanRepo src/main/ipc/tagger` | ❌ Wave 0 |
| TAGG-01 | `findLatestScan` excludes running/cancelled/error scans | unit | `npm test -- --run src/main/scan/scanRepo` | ❌ Wave 0 (extend) |
| TAGG-02 | Card shows file name + existing tag chips | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/TaggerCard` | ❌ Wave 0 |
| TAGG-02 | AudioPreview wires `<audio src="cratekeeper://…">` with loop + timeupdate reset | unit (RTL + mocked audio element) | `npm test -- --run src/renderer/src/components/tagger/AudioPreview` | ❌ Wave 0 |
| TAGG-02 | Custom protocol rejects paths outside rootFolder (403) | unit | `npm test -- --run src/main/tagger/audioProtocol` | ❌ Wave 0 |
| TAGG-02 | Custom protocol rejects non-AUDIO_EXTS (415) | unit | `npm test -- --run src/main/tagger/audioProtocol` | ❌ Wave 0 |
| TAGG-02 | AIFF fallback message renders for `.aiff` / `.aif` files | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/AudioPreview` | ❌ Wave 0 |
| TAGG-02 | Audio playback smoke test — fixture per format `canplay` (manual or integration with electron-mocha) | manual checkpoint | playwright/electron-mocha later; v1 = checkpoint:human-verify | ❌ |
| TAGG-03 | ← Keep saves edit + advances; → Skip advances without save | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-03 | Buttons (Keep/Skip) call same store actions as keyboard | unit (RTL) | `npm test -- --run src/renderer/src/views/TaggerView` | ❌ Wave 0 |
| TAGG-03 | Keyboard shortcuts disabled while text input has focus | unit (RTL with `document.activeElement`) | `npm test -- --run src/renderer/src/hooks/useTaggerKeyboard` | ❌ Wave 0 |
| TAGG-04 | `tagger:get-genre-presets` returns top-9 from scanned_files | unit | `npm test -- --run src/main/tagger/queueBuilder` | ❌ Wave 0 |
| TAGG-04 | Fallback when library has <9 distinct genres — deduped, library-first | unit | `npm test -- --run src/main/tagger/queueBuilder` | ❌ Wave 0 |
| TAGG-04 | Fallback when library has zero tagged files — pure defaults | unit | `npm test -- --run src/main/tagger/queueBuilder` | ❌ Wave 0 |
| TAGG-04 | Pressing 1-9 applies preset N to dirtyEdits.genre | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-05 | BPM input accepts integer 1-300 | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/TaggerCard` | ❌ Wave 0 |
| TAGG-05 | Key input accepts free text (Camelot or sharps/flats) | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/TaggerCard` | ❌ Wave 0 |
| TAGG-06 | Genre/Artist/Title/Comment fields fire onChange → store update | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/TaggerCard` | ❌ Wave 0 |
| TAGG-07 | Clicking N stars sets rating=N in dirtyEdits | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/RatingStars` | ❌ Wave 0 |
| TAGG-07 | DB schema CHECK rejects rating outside 1-5 | unit | `npm test -- --run src/main/tagger/taggerRepo` | ❌ Wave 0 |
| TAGG-08 | `suggestSplits('Daft Punk - Around The World')` returns 2 suggestions | unit (pure) | `npm test -- --run src/renderer/src/components/tagger/splitDetection` | ❌ Wave 0 |
| TAGG-08 | Banner appears only when artist empty + separator in title | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/ArtistTitleSplit` | ❌ Wave 0 |
| TAGG-08 | One-click suggestion fills both artist + title fields | unit (RTL) | `npm test -- --run src/renderer/src/components/tagger/ArtistTitleSplit` | ❌ Wave 0 |
| TAGG-08 | Separator `--` without surrounding spaces does NOT trigger banner | unit (pure) | `npm test -- --run src/renderer/src/components/tagger/splitDetection` | ❌ Wave 0 |
| TAGG-09 | Undo after Keep restores prior pending row (or deletes if was null) | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-09 | Undo after Skip rewinds currentIndex by 1 | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-09 | Undo disabled when lastAction === null | unit (RTL) | `npm test -- --run src/renderer/src/views/TaggerView` | ❌ Wave 0 |
| TAGG-09 | Cmd-Z / Ctrl-Z triggers undo | unit (RTL) | `npm test -- --run src/renderer/src/hooks/useTaggerKeyboard` | ❌ Wave 0 |
| TAGG-10 | `tagger_session` upsert sets current_file_path | unit | `npm test -- --run src/main/tagger/taggerRepo` | ❌ Wave 0 |
| TAGG-10 | Mount resumes to row matching `current_file_path` | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-10 | Mount falls back to index 0 when stored path no longer in queue | unit (store) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |
| TAGG-10 | `beforeunload` triggers immediate setSession flush | unit (jsdom event) | `npm test -- --run src/renderer/src/store/useTaggerStore` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test -- --run <new-or-touched-file>` (sub-second per slice)
- **Per wave merge:** `npm test -- --run` (full suite — currently ~195 tests, +~50-80 from Phase 4)
- **Phase gate:** Full suite green + `npm run build` green + checkpoint:human-verify for the per-format audio playback smoke test

### Wave 0 Gaps

- [ ] `src/main/tagger/taggerRepo.test.ts` — covers TAGG-07 (CHECK), TAGG-10 (session)
- [ ] `src/main/tagger/queueBuilder.test.ts` — covers TAGG-04
- [ ] `src/main/tagger/audioProtocol.test.ts` — covers TAGG-02 protocol gate
- [ ] `src/main/ipc/tagger.test.ts` — covers TAGG-01, TAGG-02 (server side), TAGG-04, TAGG-10
- [ ] `src/main/scan/scanRepo.test.ts` — EXTEND for `findLatestScan` (TAGG-01)
- [ ] `src/renderer/src/store/useTaggerStore.test.ts` — covers TAGG-03, TAGG-04, TAGG-07, TAGG-09, TAGG-10
- [ ] `src/renderer/src/hooks/useTaggerKeyboard.test.ts` — covers TAGG-03 focus gate, TAGG-09 Cmd-Z
- [ ] `src/renderer/src/components/tagger/splitDetection.test.ts` — covers TAGG-08 (pure)
- [ ] `src/renderer/src/components/tagger/AudioPreview.test.tsx` — covers TAGG-02 (loop + AIFF fallback)
- [ ] `src/renderer/src/components/tagger/TaggerCard.test.tsx` — covers TAGG-02, TAGG-05, TAGG-06
- [ ] `src/renderer/src/components/tagger/RatingStars.test.tsx` — covers TAGG-07
- [ ] `src/renderer/src/components/tagger/ArtistTitleSplit.test.tsx` — covers TAGG-08
- [ ] `src/renderer/src/views/TaggerView.test.tsx` — covers TAGG-01 empty state, TAGG-03 button click, TAGG-09 disabled state
- [ ] Update `src/renderer/src/App.test.tsx` — add `tagger` namespace to `installCrateKeeperMock()` (Phase 3 pattern: every Api extension requires propagation here to keep typecheck green)

Framework install: none — Vitest, RTL, jsdom already configured.

## Security Domain

> `security_enforcement` defaults to enabled. This phase introduces a custom protocol handler that reads arbitrary local files — security review required.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A — local desktop app, no auth surface |
| V3 Session Management | no | N/A |
| V4 Access Control | **yes** | Folder allowlist gate on every Tagger IPC handler + custom protocol handler (mirrors T-3-01) |
| V5 Input Validation | **yes** | V5 validation at every IPC boundary: typeof checks, `resolvesUnderRoot`, AUDIO_EXTS filter, `rating IN 1..5`, BPM integer guard |
| V6 Cryptography | no | N/A — no secrets, no transit |
| V12 Files and Resources | **yes** | Custom protocol must reject path traversal AND non-AUDIO_EXTS; settings.rootFolder must be configured before protocol responds |

### Known Threat Patterns for Phase 4

| Threat ID | STRIDE | Pattern | Standard Mitigation |
|-----------|--------|---------|---------------------|
| T-4-01 | Information Disclosure | Path traversal via `cratekeeper://audio/<encoded>` reading `/etc/passwd` or `~/.ssh/id_rsa` | `protocol.handle` resolves path, asserts `abs === root || abs.startsWith(root + sep)`, returns 403 otherwise. Mirrors `resolvesUnderRoot` from `conversion.ts`. |
| T-4-02 | Information Disclosure | Path traversal via `tagger:save-edit` filePath argument writing edits keyed to `/etc/passwd` | V5 validation in handler: `resolvesUnderRoot(filePath, settings.rootFolder)` AND `path.extname(filePath) in AUDIO_EXTS`. |
| T-4-03 | Tampering | Compromised renderer writes garbage `rating` value (e.g. 999) | SQLite `CHECK(rating IS NULL OR (rating >= 1 AND rating <= 5))` + V5 integer guard in handler. |
| T-4-04 | Tampering | Compromised renderer sends arbitrary BPM (e.g. -1, 99999) | V5 integer guard (1-300) in handler. |
| T-4-05 | Denial of Service | Renderer sends an audio file URL that points to a multi-GB file → custom protocol streams it forever | Range-request streaming bounds memory; the 30s timeupdate reset in renderer bounds playback. Defence-in-depth: log slow reads via main-side `fs.stat` cap (e.g. reject files >500 MB). |
| T-4-06 | Tampering | Persisted session row references a stale rootFolder; resume jumps to a file outside current rootFolder | On `tagger:get-session`, validate the stored `root_folder` matches `settings.rootFolder`. If different, return `{ currentFilePath: null }` and overwrite the row on next save. |
| T-4-07 | Information Disclosure | CSP too permissive — `media-src` allowance leaks beyond what's needed | Strict scoping: only `media-src 'self' cratekeeper:;` — do NOT add `cratekeeper:` to `default-src`, `script-src`, or `connect-src`. |
| T-4-08 | DoS | Renderer spams `tagger:save-edit` (e.g. 1000 events/sec) | Same single-flight pattern not strictly needed (these are cheap SQLite UPSERTs), but main should not block on synchronous DB calls. better-sqlite3 is synchronous + fast enough — measure if needed. |

### Security Verification

- [ ] `audioProtocol.test.ts`: 403 for path outside root, 415 for non-audio extension, 200 for valid path
- [ ] `tagger.test.ts`: every handler V5-validates filePath under rootFolder
- [ ] `taggerRepo.test.ts`: CHECK constraint rejects rating=0, rating=6
- [ ] Grep gate: `grep -E "webSecurity\s*:\s*false" src/main/` returns empty
- [ ] Grep gate: every Tagger IPC handler that accepts filePath calls a function named `resolvesUnderRoot` or equivalent
- [ ] Manual: in DevTools, attempt `fetch('cratekeeper://audio/' + encodeURIComponent('/etc/passwd'))` — expect 403

## Phase 5 Forward Awareness

Phase 5 will write ID3v2.3 frames to files based on rows in `pending_tag_edits WHERE applied_at IS NULL`. To make that transition smooth:

- **POPM byte mapping (locked for Phase 5, documented here):** 1★→51, 2★→102, 3★→153, 4★→204, 5★→255. Email field in POPM = `"Windows Media Player 9 Series"` is the Rekordbox-blessed POPM email per Mp3tag convention. [ASSUMED — Phase 5 must verify against a real Rekordbox 6.x install with Mp3tag for cross-check.]
- **Frame mapping (Phase 5):** Artist→TPE1, Title→TIT2, Genre→TCON, BPM→TBPM (integer string), Key→TKEY (Camelot like "8A"), Comment→COMM (lang='eng', desc=''), Rating→POPM (with email above).
- **MP4 atoms:** Genre→©gen, BPM→tmpo, Key→initial-key freeform atom (more fragile — Phase 5 should use ffmpeg `-metadata` flags rather than direct atom writing).
- **Atomic write pattern (Phase 5):** write-to-temp + rename, per TAGS-02.
- **`pending_tag_edits` row stays after `applied_at` is set** — Phase 5 should set `applied_at` rather than delete, so we have an audit trail. Future Phase 7+ may add a "history" view.

## Sources

### Primary (HIGH confidence)

- Electron docs `protocol.handle` + `protocol.registerSchemesAsPrivileged` [CITED: electronjs.org/docs/latest/api/protocol]
- Electron `webPreferences.autoplayPolicy` [CITED: electronjs.org/docs/latest/api/browser-window]
- React 19 release notes (ref as prop) [CITED: react.dev/blog/react-19]
- Chromium media support matrix [CITED: chromium.org/audio-video/]
- Existing repo source (verified by Read tool): `scanRepo.ts`, `conversionRepo.ts`, `conversion.ts`, `useConversionStore.ts`, `connection.ts`, `index.ts`, `ipc-types.ts`, Phase 2-3 SUMMARYs

### Secondary (MEDIUM confidence)

- AIFF support in HTMLMediaElement is documented as absent across Blink-based browsers (multiple sources; the Mozilla AIFF support note + Chromium media issue tracker)
- POPM byte mapping (51/102/153/204/255) is Mp3tag's documented convention, widely cited as Rekordbox-compatible — **needs Phase 5 verification against a real install**

### Tertiary (LOW confidence — flag for validation)

- Exact Chromium autoplay policy behaviour for `protocol.handle`-streamed media in Electron 39 specifically — empirically Electron's `autoplayPolicy: 'no-user-gesture-required'` resolves it, but a smoke test in the plan's checkpoint:human-verify step is warranted.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every dep already in `package.json` at verified versions.
- Architecture: HIGH — mirrors Phases 2-3 patterns documented in SUMMARYs.
- Audio preview path: HIGH — `protocol.handle` is the industry standard for Electron 25+ local-file streaming.
- AIFF fallback: HIGH for the negative (Chromium doesn't support AIFF) — MEDIUM for the proposed UI message vs ffmpeg transcode tradeoff.
- POPM mapping: MEDIUM — locked but unverified against a real Rekordbox install; Phase 5 must verify.
- Performance estimates (GROUP BY at 10K rows): MEDIUM — based on better-sqlite3 benchmarks, not measured on this project's data.

**Research date:** 2026-06-05
**Valid until:** 2026-07-05 (30 days — stable stack, low churn).
