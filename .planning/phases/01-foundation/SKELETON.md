# Walking Skeleton — DJ Utils

**Phase:** 1
**Generated:** 2026-05-28

## Capability Proven End-to-End

A user launches the app, switches between the three tool areas (Analyser / Convertir / Tagger), picks a root folder via the native OS dialog, and on relaunch sees that folder still selected — exercising the full renderer → contextBridge → main → SQLite stack.

## Architectural Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Scaffold / build | electron-vite 5 via `@quick-start/electron` (template react-ts) | Community default for new Electron+Vite+React; pins a compatible version matrix (avoids the Vite 7-vs-8 peer conflict, RESEARCH Pitfall 1). |
| Runtime | Electron 42 (scaffold-pinned) | Chromium 13x + Node 22; stable Worker Threads + Web Audio for later phases. |
| UI framework | React 19 + TypeScript 5 | Widest ecosystem for the later swipe/card tagger UI (Framer Motion). |
| Process model | Strict main/preload/renderer split; contextIsolation:true, nodeIntegration:false, sandbox:true | Security baked in from day 1 — retrofitting forces an IPC rewrite (RESEARCH Pitfall 2). |
| IPC | Typed `window.djUtils` via contextBridge; shared channel constants in `src/shared/ipc-types.ts` | Compile-time channel/payload safety; renderer never imports Node. |
| Persistence | Single better-sqlite3 DB at `app.getPath('userData')/dj-utils.db`, `settings(key,value)` table | One synchronous, crash-safe store reused by the tagger queue (Phase 4) — NOT electron-store (avoids dual-store drift). |
| Navigation | State-based tab switch via Zustand 5 | A 3-tab desktop app needs no URL/history; simpler than React Router. |
| ffmpeg | `ffmpeg-static` + `resolveFfmpegPath()` helper + electron-builder `asarUnpack` wired now | Path logic + unpack config must exist from Phase 1 (STATE decision) so Phase 3 conversion needs no retrofit (RESEARCH Pitfall 4). |
| Directory layout | Feature folders inside the scaffold split: `src/main/{db,ipc,ffmpeg}`, `src/preload`, `src/renderer/src/{components,views,store}`, `src/shared` | Matches RESEARCH Recommended Project Structure; organize by feature within the main/preload/renderer split. |
| Test runner | Vitest (node project for main, jsdom + React Testing Library for renderer) | Vite-native; pairs with Vite 7. |

## Stack Touched in Phase 1

- [x] Project scaffold (electron-vite, build, Vitest test runner)
- [x] Routing — state-based three-tool view switching (no router)
- [x] Database — real write (settings:set-folder) AND real read (settings:get-folder) to SQLite at userData
- [x] UI — interactive folder-picker button wired through window.djUtils to the native dialog + main process
- [x] Deployment — runs via `npm run dev`; full packaging (.dmg/.exe) deferred to Phase 6, but asarUnpack config stubbed now

## Out of Scope (Deferred to Later Slices)

- File scanning / metadata read, library view, CSV export (Phase 2)
- FFmpeg conversion pipeline, progress, resume, tag preservation (Phase 3) — only the path helper + asarUnpack config land in Phase 1
- Tagger queue, audio preview, inline editing, undo, session resume (Phase 4)
- Tag writing (ID3v2.3 / MP4 atoms, atomic write-to-temp + rename, Rekordbox compatibility) (Phase 5)
- Signed installers, bundled FFmpeg distribution, notarization (Phase 6)
- Worker Threads (introduced when batch scan/conversion needs them, Phases 2/3)
- Any electron-store usage (explicitly rejected — single SQLite store)

## Subsequent Slice Plan

Each later phase adds one vertical slice on top of this skeleton without changing its architectural decisions (same IPC bridge, same SQLite store, same secure window):

- Phase 2: scan a folder → live-updating library list with metadata + tag-status badges (Worker Thread + streaming IPC), CSV export
- Phase 3: select files → batch FFmpeg conversion with per-file/global progress, error isolation, resume, tag preservation (uses `resolveFfmpegPath`)
- Phase 4: tagger queue of incomplete files → 30s preview, inline edit, quick-genre, undo, session resume (reuses SQLite for queue position)
- Phase 5: atomic tag writes to audio files, Rekordbox-compatible ID3v2.3 / MP4 atoms
- Phase 6: signed .dmg + .exe installers with bundled FFmpeg (consumes the asarUnpack config wired in Phase 1)
