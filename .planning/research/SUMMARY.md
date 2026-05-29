# Research Summary — DJ Utils

## Recommended Stack

| Layer | Choice | Key Reason |
|-------|--------|------------|
| Scaffold | electron-vite + React + TypeScript | HMR, typed IPC, community default 2025 |
| Audio reading | music-metadata ^10 | Pure JS, all DJ formats, no native deps |
| MP3 tag writing | node-id3 ^0.2 | Pure JS, ID3v2.3, TBPM/TKEY/POPM frames |
| MP4 tag writing | ffmpeg `-c copy -metadata` | Pure-JS MP4 atom writing is fragile |
| Conversion | fluent-ffmpeg + ffmpeg-static | Bundled binary, no system ffmpeg required |
| Session persistence | better-sqlite3 | ACID, synchronous, crash-safe |
| Gestures/animation | Framer Motion ^11 | Best swipe gesture API for React |
| File list perf | @tanstack/virtual | Mandatory for 5,000-row libraries |
| Distribution | electron-builder ^24 | .dmg + NSIS .exe |

## Table Stakes Features

- File analysis (format, bitrate, sample rate, duration)
- Batch conversion with progress + per-file error reporting
- Resume / skip-already-converted
- Write Title, Artist, Album, Genre, BPM, Key, Comment to ID3v2 + MP4
- Audio snippet autoplay on card load
- Keep / Skip with keyboard shortcuts (→ / ←)
- Genre quick-tag buttons (configurable, one keypress)
- Inline BPM + Key entry
- Undo last action
- Persistent session (resume across days)

## Key Differentiators

- Tinder-style tagger — no existing DJ tool has this UX
- Keyboard-only tagging flow (3-5x faster for power users)
- "Untagged" smart queue
- Energy/rating via POPM (maps to Rekordbox star rating)
- Convert-then-tag pipeline

## Architecture in One Page

```
RENDERER (Chromium)
  TaggerUI (Framer Motion swipe) | LibraryUI (@tanstack/virtual) | AudioPlayer (Web Audio API)
  Zustand store
  window.djUtils (contextBridge typed API)
        ↕ ipcRenderer.invoke / ipcMain.on
MAIN PROCESS (Node.js)
  FileScanner (chunked 200) | AudioAnalyzer (music-metadata) | TagWriter (node-id3 / ffmpeg)
  SessionStore (better-sqlite3) | JobQueue → child_process.spawn(ffmpeg)
  ffmpeg-static binary (asar.unpacked)
```

Data flows:
- Scan → chunked IPC events → virtual list
- Convert → spawn ffmpeg → progress events
- Snippet → ffmpeg pipe → ArrayBuffer → Web Audio
- Tag → write-temp-rename → SQLite update → next card

## Critical Pitfalls to Avoid

1. **FFmpeg binary path in packaged app** — `asarUnpack` in electron-builder + `app.isPackaged` path fix; wire in Phase 1 or it will break every packaged build
2. **ID3v2.4 instead of v2.3 for Rekordbox** — force `{ version: 3 }` in node-id3, UTF-16 with BOM, BPM as integer string; validate against live Rekordbox before shipping
3. **Direct file write instead of atomic temp-rename** — write to temp on same filesystem, fsync, then rename; one corrupted track destroys trust
4. **Promise.all on large scan = OOM** — p-limit (10–20 concurrent), `skipCovers: true`, stream chunked results (200 per event)
5. **nodeIntegration: true** — keep Electron defaults; set contextIsolation in Phase 1, retrofitting is expensive
6. **macOS notarization not set up early** — FFmpeg binary must be signed with Developer ID; validate before any external distribution
7. **Rekordbox TKEY format** — Camelot notation (e.g. "8A") vs musical key; confirm what Rekordbox expects before implementing

## Open Questions Before Phase 1

- `ffmpeg-static` arm64 macOS binary — verify current npm version ships native arm64 before committing
- Rekordbox TKEY notation format (Camelot vs standard) — needs manual test with real Rekordbox
- POPM `email` field convention Rekordbox expects for star rating display
- MP4 tag round-trip via ffmpeg remux — test with real M4A + Rekordbox before Phase 5
- Code signing budget decision (Apple Developer ID + Windows EV cert) — needed before Phase 6

## Build Order Recommendation

1. **Foundation** — IPC bridge, contextBridge preload, SQLite, ffmpeg path wired correctly
2. **File Scanning + Library View** — chunked scan, music-metadata, virtual list
3. **FFmpeg Conversion Pipeline** — JobQueue, progress reporting, resume
4. **Tagger Core** — queue population, audio snippets via ffmpeg pipe, Web Audio, swipe UI, undo, session persistence
5. **Tag Writing + Metadata Editing** — node-id3 + ffmpeg MP4, all tag fields, POPM energy, atomic writes
6. **Polish + Distribution** — electron-builder, code signing, notarization, error states
