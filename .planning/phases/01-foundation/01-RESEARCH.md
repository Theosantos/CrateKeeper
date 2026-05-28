# Phase 1: Foundation - Research

**Researched:** 2026-05-28
**Domain:** Electron desktop app scaffolding — electron-vite + React/TS, typed contextBridge IPC, better-sqlite3 persistence, ffmpeg-static path wiring
**Confidence:** HIGH

## Summary

Phase 1 is the Walking Skeleton for DJ Utils: scaffold an electron-vite + React + TypeScript project, stand up the three-tool navigation shell (Analyser / Convertir / Tagger), wire a typed `window.djUtils` contextBridge IPC bridge, set up `better-sqlite3` at `app.getPath('userData')` for persistence, implement a native folder picker via `dialog.showOpenDialog`, and persist the selected root folder across sessions. Two pitfalls must be baked in now even though their features arrive later: `contextIsolation: true` / `nodeIntegration: false` (retrofitting is expensive) and the `ffmpeg-static` asarUnpack path helper (so Phase 3 conversion does not require rework).

Version reality has moved substantially since the project-level research (training-data only). Verified against the npm registry on 2026-05-28: **electron-vite 5.0.0**, **electron 42**, **better-sqlite3 12.10.0** (ships Node 24 prebuilds), **vite 7** (NOT 8 — see critical constraint below), **React 19**, **zustand 5**, **electron-builder 26**. The `@quick-start/electron` scaffold (template `react-ts`) produces the correct main/preload/renderer split and pins a compatible version set.

**Primary recommendation:** Scaffold with `npm create @quick-start/electron@latest dj-utils -- --template react-ts`, accept the scaffold's pinned versions (do NOT manually bump Vite to 8 or `@vitejs/plugin-react` to 6 — they break electron-vite 5's peer range). Use simple state-based tab switching (Zustand) for navigation, not React Router. Persist the root folder in a `settings` key/value table in better-sqlite3 (single store for the whole app, no electron-store). Wire the ffmpeg path helper and asarUnpack config in this phase.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| 3-tool navigation (FOUND-01) | Renderer | — | Pure UI state; no Node access needed. Tab switch is in-renderer. |
| Folder picker dialog (FOUND-02) | Main (Node) | Renderer (trigger) | `dialog.showOpenDialog` is a main-process API; renderer invokes via IPC. |
| Folder persistence (FOUND-03) | Main (Node) | — | SQLite write at `userData`; renderer never touches the DB directly. |
| IPC bridge (`window.djUtils`) | Preload | Main (handlers) | contextBridge runs in isolated preload context; handlers live in main. |
| ffmpeg path resolution (future) | Main (Node) | — | Binary path logic is main-only; wired now, used in Phase 3. |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `electron-vite` | ^5.0.0 | Build tool / scaffold (main+preload+renderer split, HMR) | Community default for new Electron+Vite+React projects; verified latest 5.0.0 published 2026-04-12 `[VERIFIED: npm registry]` |
| `electron` | ^42 (scaffold-pinned) | Runtime | Electron 42 ships Chromium 13x + Node 22; stable Worker Threads + Web Audio `[VERIFIED: npm registry]` |
| `react` + `react-dom` | ^19.2 | UI framework | Widest ecosystem for swipe/card UI (Framer Motion); locked by project research `[VERIFIED: npm registry]` |
| `typescript` | scaffold-pinned (~5.x) | Types | First-class in electron-vite template. **Do not force TS 6** — let scaffold pin a version the toolchain supports `[ASSUMED]` |
| `vite` | ^7 (scaffold-pinned) | Bundler under electron-vite | electron-vite 5 peer range is `^5 \|\| ^6 \|\| ^7` — Vite 7 is the current ceiling `[VERIFIED: npm registry]` |
| `@vitejs/plugin-react` | ^5.1 | React Fast Refresh in renderer | v5.1+ supports Vite 7; v6 requires Vite 8 (incompatible) `[VERIFIED: npm registry]` |
| `better-sqlite3` | ^12.10 | Persistence (settings + later queue) | Synchronous, ACID, crash-safe; engines `20.x..26.x`, ships prebuilds `[VERIFIED: npm registry]` |
| `@types/better-sqlite3` | ^7.6 | TS types for better-sqlite3 | Types package (better-sqlite3 has no bundled types) `[VERIFIED: npm registry]` |
| `zustand` | ^5.0 | Renderer state (active tool, root folder) | Lightweight; handles nav + cached settings without Redux `[VERIFIED: npm registry]` |
| `ffmpeg-static` | ^5.3 | Bundled ffmpeg binary (path wired now) | Path helper + asarUnpack must exist from Phase 1 per project pitfalls `[VERIFIED: npm registry]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@electron-toolkit/preload` | ^3.0 | Helper for exposing typed APIs in preload | Optional — provides `electronAPI` base; can roll bridge by hand `[VERIFIED: npm registry]` |
| `@electron-toolkit/utils` | ^4.0 | `is.dev`, `optimizer`, window helpers | Bundled in scaffold; convenience only `[VERIFIED: npm registry]` |
| `@electron-toolkit/tsconfig` | ^2.0 | Base tsconfigs for node/web split | Bundled in scaffold `[VERIFIED: npm registry]` |
| `@electron/rebuild` | ^4.0 | Rebuild native modules for Electron ABI | Fallback if better-sqlite3 prebuild does not match Electron 42's ABI `[VERIFIED: npm registry]` |
| `electron-builder` | ^26 | Packaging (.dmg/.exe) — config stubbed now | Add `asarUnpack` for ffmpeg-static now; full packaging is Phase 6 `[VERIFIED: npm registry]` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| State-based tab nav | React Router (`react-router-dom`) | Router adds URL/history semantics a 3-tab desktop app does not need. State switch is simpler and matches the walking-skeleton goal. Use Router only if deep-linking emerges. |
| better-sqlite3 `settings` table | `electron-store` (^11) | electron-store is simpler for pure key/value, BUT the project already needs SQLite for the tagger queue (Phase 4). Two persistence layers = drift. Use one SQLite store from day 1. |
| `@quick-start/electron` scaffold | Manual electron-vite setup | Scaffold pins a known-good version matrix and the correct main/preload/renderer layout. Manual setup risks the Vite 7-vs-8 peer conflict below. |

**Installation:**

```bash
# Scaffold (pins compatible electron-vite 5 + vite 7 + plugin-react 5 + React 19)
npm create @quick-start/electron@latest dj-utils -- --template react-ts
cd dj-utils

# Persistence + state (runtime deps — keep in "dependencies" so externalizeDepsPlugin externalizes them)
npm install better-sqlite3 zustand ffmpeg-static
npm install -D @types/better-sqlite3

# Native module rebuild fallback (only if better-sqlite3 prebuild ABI mismatch occurs)
npm install -D @electron/rebuild
```

**Version verification (run 2026-05-28):**
- `electron-vite` → 5.0.0 (published 2026-04-12)
- `electron` → 42.3.0
- `better-sqlite3` → 12.10.0 (engines: node 20.x–26.x; `install` script: `prebuild-install || node-gyp rebuild`)
- `ffmpeg-static` → 5.3.0
- `zustand` → 5.0.14
- `react` / `react-dom` → 19.2.6
- `vite` → 7.x is the compatible line (registry latest is 8.0.14 — do NOT use)
- `@vitejs/plugin-react` → 5.2.0 latest in the 5-line (Vite 7 compatible); 6.0.2 requires Vite 8

## Package Legitimacy Audit

slopcheck 0.6.1 was installed and run against all phase packages on npm (2026-05-28). All 15 returned `[OK]`.

| Package | Registry | slopcheck | Disposition |
|---------|----------|-----------|-------------|
| react | npm | OK | Approved |
| react-dom | npm | OK | Approved |
| better-sqlite3 | npm | OK | Approved |
| zustand | npm | OK | Approved |
| @tanstack/react-virtual | npm | OK | Approved (Phase 2, listed for completeness) |
| ffmpeg-static | npm | OK | Approved |
| framer-motion | npm | OK | Approved (Phase 4) |
| electron-vite | npm | OK | Approved |
| electron | npm | OK | Approved |
| electron-builder | npm | OK | Approved |
| @electron-toolkit/tsconfig | npm | OK | Approved |
| @electron/rebuild | npm | OK | Approved |
| @electron-toolkit/preload | npm | OK | Approved |
| @electron-toolkit/utils | npm | OK | Approved |
| @vitejs/plugin-react | npm | OK | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

**Postinstall note:** `better-sqlite3`'s install script runs `prebuild-install || node-gyp rebuild --release`. This is the expected native-module prebuild flow, not a network/exfil concern — but it means a C++ toolchain must be available if the prebuild ABI does not match Electron 42 (see Pitfall 3).

## Architecture Patterns

### System Architecture Diagram

```
                         RENDERER (Chromium, no Node)
  ┌──────────────────────────────────────────────────────────────┐
  │  App shell                                                     │
  │   ├─ NavBar  →  setActiveTool('analyser'|'convertir'|'tagger') │
  │   ├─ <AnalyserView/> | <ConvertirView/> | <TaggerView/>        │
  │   └─ RootFolderPicker → "Choisir dossier" button               │
  │                                                                │
  │  Zustand store: { activeTool, rootFolder }                     │
  │        │  reads window.djUtils.* (typed)                       │
  └────────┼───────────────────────────────────────────────────────┘
           │  contextBridge (preload, isolated context)
           │  ipcRenderer.invoke('settings:get-folder' | 'dialog:pick-folder' | 'settings:set-folder')
           ▼
                         MAIN PROCESS (Node.js)
  ┌──────────────────────────────────────────────────────────────┐
  │  ipcMain.handle handlers                                       │
  │   ├─ dialog:pick-folder → dialog.showOpenDialog({properties:   │
  │   │                         ['openDirectory']}) → string|null  │
  │   ├─ settings:set-folder(path) → settingsRepo.set('rootFolder')│
  │   └─ settings:get-folder()     → settingsRepo.get('rootFolder')│
  │                                                                │
  │  SettingsRepo  →  better-sqlite3 db at                         │
  │                   app.getPath('userData')/dj-utils.db          │
  │                   table settings(key TEXT PK, value TEXT)      │
  │                                                                │
  │  ffmpegPath helper (wired now, unused until Phase 3)           │
  │   resolve: app.isPackaged ? path.replace('app.asar',          │
  │            'app.asar.unpacked') : ffmpeg-static path            │
  └──────────────────────────────────────────────────────────────┘
```

Flow for FOUND-02 + FOUND-03: user clicks "Choisir dossier" → renderer `invoke('dialog:pick-folder')` → main opens native dialog → returns path → renderer `invoke('settings:set-folder', path)` → main writes SQLite row → Zustand updates. On next launch, app boot calls `invoke('settings:get-folder')` → hydrates Zustand → folder persists across sessions.

### Recommended Project Structure

The `@quick-start/electron` react-ts scaffold produces this (organize new code by feature within it):

```
dj-utils/
├── electron.vite.config.ts      # main/preload/renderer config + externalizeDepsPlugin
├── electron-builder.yml         # add asarUnpack for ffmpeg-static NOW
├── src/
│   ├── main/
│   │   ├── index.ts             # app lifecycle, BrowserWindow (secure webPreferences)
│   │   ├── ipc/
│   │   │   ├── settings.ts      # settings:get-folder / settings:set-folder handlers
│   │   │   └── dialog.ts        # dialog:pick-folder handler
│   │   ├── db/
│   │   │   ├── connection.ts    # open better-sqlite3 at userData, run migrations
│   │   │   └── settingsRepo.ts  # get/set key-value
│   │   └── ffmpeg/
│   │       └── path.ts          # resolveFfmpegPath() — wired now
│   ├── preload/
│   │   └── index.ts             # contextBridge.exposeInMainWorld('djUtils', {...})
│   ├── renderer/
│   │   └── src/
│   │       ├── App.tsx          # nav shell + tool switch
│   │       ├── components/
│   │       │   ├── nav/NavBar.tsx
│   │       │   └── folder/RootFolderPicker.tsx
│   │       ├── views/
│   │       │   ├── AnalyserView.tsx   # placeholder
│   │       │   ├── ConvertirView.tsx  # placeholder
│   │       │   └── TaggerView.tsx     # placeholder
│   │       └── store/useAppStore.ts   # Zustand: activeTool, rootFolder
│   └── shared/
│       └── ipc-types.ts         # shared types for window.djUtils API + channel names
└── package.json
```

### Pattern 1: Secure BrowserWindow (bake in from day 1)

**What:** Create the main window with security defaults explicitly set, even though they are Electron defaults — explicitness prevents regressions.
**When to use:** Always, in `src/main/index.ts`.

```typescript
// Source: Electron docs — Process Sandboxing / contextIsolation [CITED: electronjs.org/docs/latest/tutorial/context-isolation]
const win = new BrowserWindow({
  width: 1100,
  height: 720,
  webPreferences: {
    preload: path.join(__dirname, '../preload/index.js'),
    contextIsolation: true,   // default true since Electron 12 — keep explicit
    nodeIntegration: false,   // default false — keep explicit
    sandbox: true,
  },
})
```

### Pattern 2: Typed contextBridge IPC bridge

**What:** Expose a minimal, typed `window.djUtils` from preload; renderer never imports Node.
**When to use:** All renderer↔main communication.

```typescript
// src/shared/ipc-types.ts
export interface DjUtilsApi {
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
}
declare global { interface Window { djUtils: DjUtilsApi } }

// src/preload/index.ts
// Source: Electron docs — contextBridge [CITED: electronjs.org/docs/latest/api/context-bridge]
import { contextBridge, ipcRenderer } from 'electron'
const api: DjUtilsApi = {
  pickFolder: () => ipcRenderer.invoke('dialog:pick-folder'),
  getRootFolder: () => ipcRenderer.invoke('settings:get-folder'),
  setRootFolder: (p) => ipcRenderer.invoke('settings:set-folder', p),
}
contextBridge.exposeInMainWorld('djUtils', api)

// src/main/ipc/dialog.ts
import { ipcMain, dialog } from 'electron'
ipcMain.handle('dialog:pick-folder', async () => {
  const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
})
```

### Pattern 3: better-sqlite3 settings store at userData

**What:** Single SQLite file, key-value `settings` table, synchronous repo.
**When to use:** Folder persistence now; tagger queue reuses the same DB later.

```typescript
// src/main/db/connection.ts
// Source: better-sqlite3 docs [CITED: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]
import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'

const db = new Database(path.join(app.getPath('userData'), 'dj-utils.db'))
db.pragma('journal_mode = WAL')
db.exec(`CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT)`)
export default db

// src/main/db/settingsRepo.ts
const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
const setStmt = db.prepare(
  'INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
)
export const settingsRepo = {
  get: (k: string): string | null => (getStmt.get(k) as { value: string } | undefined)?.value ?? null,
  set: (k: string, v: string) => { setStmt.run(k, v) },
}
```

### Pattern 4: ffmpeg-static path helper (wire now, use Phase 3)

**What:** Centralize the asar-unpacked path fix so Phase 3 imports a ready helper.
**When to use:** Create the helper + electron-builder asarUnpack entry in Phase 1.

```typescript
// src/main/ffmpeg/path.ts
// Source: project PITFALLS.md §1 + ffmpeg-static issues [CITED: github.com/eugeneware/ffmpeg-static]
import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'   // string path
export function resolveFfmpegPath(): string {
  const p = ffmpegStatic as unknown as string
  return app.isPackaged ? p.replace('app.asar', 'app.asar.unpacked') : p
}
```

```yaml
# electron-builder.yml — add now even though packaging is Phase 6
asarUnpack:
  - "**/node_modules/ffmpeg-static/**"
  - "**/node_modules/better-sqlite3/**"   # native .node must be unpacked too
```

### Anti-Patterns to Avoid

- **`nodeIntegration: true` / disabling contextIsolation** — breaks the security model and macOS notarization; retrofitting forces an IPC rewrite (project pitfall #5).
- **Importing better-sqlite3 in the renderer** — native module + Node API; must stay in main, accessed via IPC only.
- **Bundling better-sqlite3 / ffmpeg-static into the Vite output** — they must be externalized (`externalizeDepsPlugin`, default in scaffold) and asar-unpacked, never bundled.
- **Two persistence systems (electron-store + SQLite)** — causes state drift; use one SQLite store.
- **Manually bumping Vite to 8 or plugin-react to 6** — breaks electron-vite 5's peer range (ERESOLVE).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Native folder selection | Custom file-browser UI | `dialog.showOpenDialog({properties:['openDirectory']})` | OS-native, handles permissions/network volumes |
| Key-value persistence | JSON file read/modify/write | better-sqlite3 `settings` table | Atomic, crash-safe, already needed for queue |
| userData directory resolution | Hardcoded `~/Library/...` paths | `app.getPath('userData')` | Cross-platform (macOS/Windows) correct dirs |
| IPC type safety | Stringly-typed channels everywhere | Shared `ipc-types.ts` + typed `window.djUtils` | Compile-time channel/payload checks |
| ffmpeg path in packaged app | Ad-hoc path strings in Phase 3 | `resolveFfmpegPath()` helper + asarUnpack now | Project pitfall #1 — invisible in dev, fatal in prod |

**Key insight:** Electron ships native APIs for every Phase 1 need (dialogs, paths, IPC). The only "build" here is the thin typed bridge and the SQLite repo — everything else is configuration of existing, battle-tested primitives.

## Runtime State Inventory

Not applicable — this is a greenfield phase (new project, no existing code or stored state). Verified: working directory contains only `CLAUDE.md` and `.planning/`; no `package.json`, no `src/`, no database.

## Common Pitfalls

### Pitfall 1: Vite 7-vs-8 peer dependency conflict

**What goes wrong:** Installing `vite@latest` (8.x) or `@vitejs/plugin-react@latest` (6.x) manually produces `npm ERESOLVE` — electron-vite 5 peers `vite ^5||^6||^7`, and plugin-react 6 peers `vite ^8`.
**Why it happens:** Registry "latest" tags moved ahead of electron-vite 5's support window.
**How to avoid:** Accept the scaffold's pinned versions. If adding deps, keep `vite@^7` and `@vitejs/plugin-react@^5.1`. Verified incompatibility reproduced via slopcheck install dry-run on 2026-05-28.
**Warning signs:** `Conflicting peer dependency: vite@7.x.x` during `npm install`.

### Pitfall 2: contextIsolation retrofitting

**What goes wrong:** Building IPC assuming Node access in the renderer, then having to rewrite everything for the secure model later.
**Why it happens:** Tutorials still show `nodeIntegration: true`.
**How to avoid:** Set `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true` in Phase 1 and route all access through the preload bridge (Pattern 1 + 2).
**Warning signs:** `require is not defined` in renderer; temptation to enable nodeIntegration to "fix" it.

### Pitfall 3: better-sqlite3 native module ABI mismatch with Electron

**What goes wrong:** `npm install` fetches a prebuild compiled for the system Node ABI; Electron 42 bundles a different Node ABI. Loading throws `NODE_MODULE_VERSION` / ABI mismatch at runtime.
**Why it happens:** `prebuild-install` matches the running Node, not Electron's.
**How to avoid:** Run `electron-rebuild` (via `@electron/rebuild`) after install, or use electron-builder's built-in rebuild on package. better-sqlite3 12.x publishes Electron prebuilds, so the default may "just work" — but verify by launching the dev app and reading/writing the settings table. Add `"postinstall": "electron-rebuild -f -w better-sqlite3"` if a mismatch appears.
**Warning signs:** App boots but throws `The module was compiled against a different Node.js version` on first DB call.

### Pitfall 4: ffmpeg-static binary not executable / not unpacked

**What goes wrong:** Wiring the helper but forgetting the `asarUnpack` entry means Phase 3 fails in packaged builds with `spawn ENOENT`.
**Why it happens:** Native binaries cannot execute from inside `app.asar`.
**How to avoid:** Add both the `asarUnpack` glob and `resolveFfmpegPath()` in Phase 1 (Pattern 4). Even though conversion is Phase 3, the config belongs here per project decision (STATE.md: "FFmpeg binary path must be handled via asarUnpack from Phase 1 onwards").
**Warning signs:** Helper returns a path containing `app.asar/` in a packaged build.

## Code Examples

See Patterns 1–4 above — each is a verified, copy-ready snippet for the four Phase 1 capabilities (secure window, typed bridge, SQLite settings, ffmpeg path).

### App boot → hydrate persisted folder (FOUND-03)

```typescript
// src/renderer/src/store/useAppStore.ts
import { create } from 'zustand'   // zustand 5 API
type Tool = 'analyser' | 'convertir' | 'tagger'
interface AppState {
  activeTool: Tool
  rootFolder: string | null
  setActiveTool: (t: Tool) => void
  loadRootFolder: () => Promise<void>
  pickRootFolder: () => Promise<void>
}
export const useAppStore = create<AppState>((set) => ({
  activeTool: 'analyser',
  rootFolder: null,
  setActiveTool: (activeTool) => set({ activeTool }),
  loadRootFolder: async () => set({ rootFolder: await window.djUtils.getRootFolder() }),
  pickRootFolder: async () => {
    const p = await window.djUtils.pickFolder()
    if (p) { await window.djUtils.setRootFolder(p); set({ rootFolder: p }) }
  },
}))
// Call loadRootFolder() in App.tsx useEffect on mount → folder persists across sessions.
```

## State of the Art

| Old Approach (project research, training data) | Current Approach (verified 2026-05-28) | Impact |
|-----------------------------------------------|----------------------------------------|--------|
| electron-vite ^3.x | electron-vite **5.0.0** | Newer scaffold; Vite 7 peer ceiling |
| electron ^30–32 | electron **42** | Newer Chromium/Node; confirm better-sqlite3 prebuild ABI |
| React 18 | React **19.2** | Scaffold ships React 19 |
| zustand ^4 | zustand **5** | `create` API stable; minor v5 typing changes |
| better-sqlite3 (unversioned) | **12.10.0**, engines node 20–26 | Ships prebuilds incl. Node 24 |
| Vite ^5 | **Vite 7** (8 exists but incompatible) | Do not use Vite 8 with electron-vite 5 |

**Deprecated/outdated:**
- electron-forge Webpack plugin — superseded by electron-vite (already decided).
- `electron-rebuild` standalone package → now `@electron/rebuild`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | TypeScript version pinned by scaffold (~5.x) is correct; do not force TS 6 | Standard Stack | Low — if scaffold ships TS 6 and it works, no action; if mismatch, pin TS 5.x |
| A2 | better-sqlite3 12.x prebuilds match Electron 42 ABI without rebuild | Pitfall 3 | Medium — may need `electron-rebuild` postinstall; mitigation documented |
| A3 | electron 42 is what the current scaffold pins | Standard Stack | Low — scaffold may pin a slightly different 4x; verify post-scaffold |

## Open Questions

1. **Does better-sqlite3 12.10 load cleanly under Electron 42 without electron-rebuild?**
   - What we know: better-sqlite3 publishes Electron prebuilds; engines cover Node 20–26.
   - What's unclear: Whether the specific Electron 42 ABI has a matching prebuild.
   - Recommendation: First Phase 1 task after scaffold — launch dev app, write+read the settings table. If ABI error, add `"postinstall": "electron-rebuild -f -w better-sqlite3"`.

2. **Exact versions the `@quick-start/electron` react-ts scaffold pins.**
   - What we know: It targets electron-vite 5 and produces the main/preload/renderer split.
   - What's unclear: Precise pinned electron/react/typescript versions until scaffolded.
   - Recommendation: Run the scaffold first, then `cat package.json` to confirm before adding deps.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Scaffold + build | ✓ | v24.16.0 | — (meets electron-vite 5 req: node 20.19+/22.12+) |
| npm | Install | ✓ | 11.13.0 | — |
| C/C++ toolchain (for better-sqlite3 fallback build) | better-sqlite3 if prebuild ABI mismatch | unknown | — | Use prebuild (default); install Xcode CLT on macOS if `node-gyp` path triggers |

**Missing dependencies with no fallback:** none — Node 24 + npm 11 are present and sufficient.
**Missing dependencies with fallback:** C++ toolchain only needed if better-sqlite3 prebuild fails (Pitfall 3); prebuild is the primary path.

## Validation Architecture

> `.planning/config.json` was not present at research time; nyquist_validation treated as enabled (default).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | Vitest (Vite-native; pairs with electron-vite/Vite 7) — none installed yet, see Wave 0 `[ASSUMED]` |
| Config file | none — Wave 0 |
| Quick run command | `npx vitest run` (after setup) |
| Full suite command | `npx vitest run` |

Note: Per user's `web/testing.md`, Playwright is the standard for E2E/visual. For Phase 1 (a walking skeleton), unit tests on the SettingsRepo (pure SQLite logic) carry the most signal. Electron E2E via Playwright (`_electron`) is possible but heavier than this phase warrants — recommend one smoke E2E that launches the app and asserts the nav renders, deferred or minimal.

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| FOUND-01 | Nav switches between 3 tools | unit (store) + smoke E2E | `npx vitest run src/renderer/src/store` | ❌ Wave 0 |
| FOUND-02 | Folder picker returns a path | unit (IPC handler, mocked dialog) | `npx vitest run src/main/ipc` | ❌ Wave 0 |
| FOUND-03 | Folder persists across sessions | unit (SettingsRepo round-trip) | `npx vitest run src/main/db` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npx vitest run <touched dir>`
- **Per wave merge:** `npx vitest run`
- **Phase gate:** Full suite green + manual launch confirming folder survives an app restart.

### Wave 0 Gaps
- [ ] Install Vitest: `npm install -D vitest` (Vite 7 compatible)
- [ ] `src/main/db/settingsRepo.test.ts` — covers FOUND-03 (set then get returns same value; survives reopen via in-memory or temp-file DB)
- [ ] `src/main/ipc/dialog.test.ts` — covers FOUND-02 (handler returns first path / null on cancel, with `dialog` mocked)
- [ ] `src/renderer/src/store/useAppStore.test.ts` — covers FOUND-01 (setActiveTool transitions)
- [ ] (Optional) Playwright `_electron` smoke test — launches app, asserts 3 nav items visible

## Security Domain

> `security_enforcement` absent → treated as enabled. This is a local desktop app with no network/auth surface in Phase 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No accounts/auth in app |
| V3 Session Management | no | No web sessions |
| V4 Access Control | no | Single local user |
| V5 Input Validation | yes | Validate IPC payloads in main handlers — treat renderer as untrusted; verify folder path is a string before SQLite write |
| V6 Cryptography | no | No secrets stored in Phase 1 |
| V14 Configuration | yes | Electron hardening: contextIsolation, sandbox, nodeIntegration off, no remote URLs in BrowserWindow |

### Known Threat Patterns for Electron

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer RCE via nodeIntegration | Elevation of Privilege | `nodeIntegration:false` + `contextIsolation:true` + `sandbox:true` (Pattern 1) |
| Untrusted IPC arguments | Tampering | Validate/type every `ipcMain.handle` arg; never `eval` or path-concat raw input |
| Path traversal via stored folder | Tampering | Folder comes from native `showOpenDialog` (OS-validated); still type-check string before persisting |
| Loading remote content in main window | Spoofing/RCE | Load only local bundle; use `shell.openExternal` for links |

## Sources

### Primary (HIGH confidence)
- npm registry via `npm view` (2026-05-28) — all version/peer/engines/install-script data
- slopcheck 0.6.1 `install --ecosystem npm` dry-run (2026-05-28) — 15/15 packages `[OK]`
- electron-vite.org/guide — scaffold command, electron-vite 5.0.0, Vite 5+ requirement, main/preload/renderer config
- Electron docs (contextBridge, context-isolation, dialog, app.getPath) — security model + APIs
- better-sqlite3 docs (WiseLibs) — synchronous API, WAL, prepare/run

### Secondary (MEDIUM confidence)
- Project research files (STACK.md, ARCHITECTURE.md, PITFALLS.md, SUMMARY.md) — patterns + decisions (note: their versions are training-data and superseded by registry checks above)

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every version verified against npm registry today; peer conflicts reproduced.
- Architecture: HIGH — Electron process model + contextBridge are stable, well-documented platform features.
- Pitfalls: HIGH — Vite peer conflict reproduced; contextIsolation + ffmpeg + native-module risks confirmed against project pitfalls and registry install scripts.

**Research date:** 2026-05-28
**Valid until:** 2026-06-27 (fast-moving toolchain — re-verify electron-vite/vite peer ranges before scaffolding if past this date)
