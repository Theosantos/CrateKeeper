# Phase 2: File Scanning & Library View — Research

**Researched:** 2026-05-29
**Domain:** Electron main-process worker scan pipeline, audio metadata parsing, streaming IPC, virtualized list rendering, CSV export
**Confidence:** HIGH

## Summary

Phase 2 turns the Phase-1 walking skeleton into a working Analyser: the user picks a folder (already persisted in `settings.rootFolder`), triggers a scan, and a live-updating table of every audio file appears showing format/bitrate/size/sample-rate/duration plus a Genre/BPM/Key completeness badge — even on a multi-thousand-file library, without the UI freezing. SCAN-04 adds a CSV export.

The whole pipeline lives in the **main process** (renderer remains sandboxed, contextIsolated, no Node). Walk → parse → persist runs on a single **Node `worker_threads.Worker`** spawned by main. Results stream back to main via `worker.postMessage`, are persisted in batches to the existing better-sqlite3 DB (new `scans` + `scanned_files` tables), and are forwarded to the renderer as **batched `webContents.send` events** through new typed channels on the existing `window.djUtils` bridge. Renderer accumulates rows in Zustand and renders them in a virtualized list (`@tanstack/react-virtual`) to keep React off the critical path.

**Primary recommendation:** one worker (not a pool); `readdirp` for traversal; `music-metadata.parseFile` for audio reads; batched IPC (every 50 files OR 200ms, whichever first); `@tanstack/react-virtual` for the list; `csv-stringify` (sync API) streamed to a `showSaveDialog`-chosen path in main. Persist results to SQLite from day 1 because Phase 3 (conversion) and Phase 4 (tagger queue) both need to query the file list later.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|--------------|----------------|-----------|
| Folder traversal (SCAN-01,05) | Main → Worker | — | Node `fs` only; never in renderer |
| Audio metadata read (SCAN-01,02,03) | Worker | — | CPU-bound parse, must not block main event loop |
| Scan persistence | Main | — | Worker `postMessage`s batches; main owns the single SQLite connection |
| Streaming progress to UI | Main → Preload → Renderer | — | `webContents.send` over `ipcRenderer.on` via contextBridge listener |
| Live-updating row list | Renderer (Zustand + virtualized list) | — | UI state only; no Node |
| Tag-completeness badge (SCAN-03) | Worker computes booleans | Renderer renders | Booleans are part of the row payload, computed once during parse |
| CSV export (SCAN-04) | Main (build + save) | Renderer (trigger) | `dialog.showSaveDialog` + `fs.writeFile` are main-process APIs |
| Cancel scan | Main (cancel flag → worker observes) | Renderer (button → IPC) | Worker checks an `AbortController.signal` or a shared `SharedArrayBuffer` flag between batches |

## Standard Stack

### Core (new in Phase 2)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `music-metadata` | ^11.12 | Read tags + format/bitrate/sample-rate/duration from MP3/FLAC/AAC/M4A/AIFF/WAV/OGG | Pure JS (no native deps → no electron-rebuild headaches); covers every format DJs use; returns uniform `IAudioMetadata` `[VERIFIED: npm registry 2026-05-29]` `[CITED: github.com/borewit/music-metadata]` |
| `readdirp` | ^5.0 | Streaming recursive directory walk with extension allowlist | Streaming API (`for await`) is the right shape for a worker pushing batches; built-in `fileFilter` matches our `.mp3/.flac/...` allowlist; pure JS `[VERIFIED: npm registry 2026-05-29]` `[CITED: github.com/paulmillr/readdirp]` |
| `@tanstack/react-virtual` | ^3.13 | Virtualized list rendering for thousands of rows | Headless (we own the markup → no template look), TS-first, maintained by TanStack; cheaper than `react-window` for variable-height rows and aligns with React 19 `[VERIFIED: npm registry 2026-05-29]` |
| `csv-stringify` | ^6.7 | CSV string generation for SCAN-04 | Battle-tested (csv.js.org), sync + streaming APIs, zero deps; safer than hand-rolling escape rules for commas/quotes/newlines `[VERIFIED: npm registry 2026-05-29]` `[CITED: csv.js.org/stringify]` |

Node built-ins used: `node:worker_threads` (Worker, parentPort, MessagePort), `node:fs/promises` (createWriteStream for CSV), `node:path`, `node:crypto.randomUUID` (scan id).

### Alternatives Considered (rejected)

| Instead of | Could Use | Why rejected |
|------------|-----------|--------------|
| `readdirp` | `fast-glob` | Glob is overkill — we just need recursive walk + ext filter. fast-glob materialises matches; readdirp streams. |
| `readdirp` | hand-rolled `fs.opendir` recursion | Re-implements symlink-loop protection and ext filtering. YAGNI says use the lib. |
| Single Worker | `piscina` worker pool | Bottleneck is per-file `parseFile` (disk-bound on a single SSD/HDD). A pool adds disk contention without throughput. One worker is enough for "thousands of files". Revisit if profiling shows CPU saturation. `[VERIFIED: piscina 5.1.4 exists]` |
| `@tanstack/react-virtual` | `react-window` v2 | Both work; TanStack Virtual is already the React 19-friendly default and avoids react-window's 2.x API churn. |
| `csv-stringify` | `papaparse` / `fast-csv` | Papaparse is browser-oriented (we'd ship browser-only code in main); fast-csv has a heavier API. csv-stringify's sync `stringify(rows, opts)` is the smallest viable surface for SCAN-04. |
| SQLite persistence | Zustand-only in-memory | Phase 3 (conversion) selects from the list; Phase 4 (tagger) filters by "missing Genre OR BPM OR Key". Re-scanning every launch wastes minutes on big libraries. SQLite from day 1. |
| `parentPort.postMessage` per file | `MessageChannel` + SharedArrayBuffer | Premature optimization; postMessage with batched arrays is plenty fast for ~50 msgs/sec. |
| `AbortController` for cancel | SharedArrayBuffer flag | AbortController doesn't cross worker boundary cleanly; simpler is a `{type:'cancel'}` message + a `let cancelled = false` flag the worker checks between batches. |

### Installation

```bash
npm install music-metadata readdirp csv-stringify @tanstack/react-virtual
```

No new dev deps. No native modules → no rebuild required.

### Version verification (run 2026-05-29 via `npm view`)

| Package | Latest | Published | Engines |
|---------|--------|-----------|---------|
| music-metadata | 11.12.3 | 2026-03-12 | node >=18 (works on Node 22 / Electron 39's bundled Node) |
| readdirp | 5.0.0 | 2025-11-25 | node >=20.19 (matches our Node 24 dev + Electron 39 runtime) |
| csv-stringify | 6.7.0 | 2026-03-17 | — |
| @tanstack/react-virtual | 3.13.26 | 2026-05-25 | peer react >=17 (we have 19) |

## Package Legitimacy Audit

slopcheck 0.6.x run against all 4 new packages on 2026-05-29 (`slopcheck install music-metadata readdirp csv-stringify @tanstack/react-virtual`):

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| music-metadata | npm | 10+ yrs | ~1M/wk | github.com/borewit/music-metadata | OK | Approved |
| readdirp | npm | 10+ yrs | ~80M/wk (chokidar dep) | github.com/paulmillr/readdirp | OK | Approved |
| csv-stringify | npm | 10+ yrs | ~3M/wk | github.com/adaltas/node-csv | OK | Approved |
| @tanstack/react-virtual | npm | 3+ yrs | ~2M/wk | github.com/TanStack/virtual | OK | Approved |

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none
**Postinstall scripts:** none of the four declare a postinstall — all pure JS, no native build step.

## Architecture Patterns

### System Architecture Diagram

```
                                RENDERER (sandboxed, no Node)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  AnalyserView                                                                │
  │   ├─ "Scanner" button     → useScanStore.startScan()                         │
  │   ├─ progress strip       (scanned N / total ? / elapsed)                    │
  │   ├─ VirtualizedFileTable (@tanstack/react-virtual)                          │
  │   │     row = file path | format | bitrate | size | sampleRate | duration |  │
  │   │           [G][B][K] badges                                                │
  │   └─ "Exporter CSV" button → useScanStore.exportCsv()                        │
  │                                                                              │
  │  useScanStore (Zustand): { scanId, status, rows[], stats, error }            │
  │   ├─ window.djUtils.scan.start(folder)        → returns scanId               │
  │   ├─ window.djUtils.scan.cancel(scanId)                                      │
  │   ├─ window.djUtils.scan.exportCsv(scanId)    → returns saved path | null    │
  │   └─ window.djUtils.scan.onEvent(cb)          → unsubscribe fn               │
  └────────┬───────────────────────────────────────────────────────────────────┘
           │  contextBridge (preload, isolated)
           │  ipcRenderer.invoke('scan:start' | 'scan:cancel' | 'scan:export-csv')
           │  ipcRenderer.on('scan:event', batch | done | error)
           ▼
                                MAIN PROCESS (Node.js)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  ScanController (one instance, singleton)                                    │
  │   ├─ start(folder) → uuid; spawn Worker; remember sender webContents         │
  │   ├─ worker.on('message', batch)                                             │
  │   │     ↳ scanRepo.insertBatch(scanId, rows)        (one SQLite transaction) │
  │   │     ↳ webContents.send('scan:event', { type:'rows', scanId, rows })      │
  │   ├─ worker.on('message', done)  → mark scan complete, persist totals        │
  │   ├─ worker.on('message', error) → forward + cleanup                         │
  │   └─ cancel(scanId) → worker.postMessage({type:'cancel'}); .terminate() fbk  │
  │                                                                              │
  │  scanRepo (better-sqlite3)                                                   │
  │   ├─ scans(id PK, root_folder, started_at, ended_at, total_files, status)    │
  │   └─ scanned_files(scan_id FK, path PK_part, format, bitrate, size_bytes,    │
  │       sample_rate, duration_seconds, has_genre, has_bpm, has_key,            │
  │       parsed_ok, error_message NULL)                                         │
  │                                                                              │
  │  csvExportHandler(scanId)                                                    │
  │   ├─ dialog.showSaveDialog → user-chosen path                                │
  │   └─ fs.createWriteStream + csv-stringify (sync, in chunks) → write rows     │
  └────────┬───────────────────────────────────────────────────────────────────┘
           │  worker_threads.Worker (one per active scan; usually one at a time)
           ▼
                                SCAN WORKER (node:worker_threads)
  ┌────────────────────────────────────────────────────────────────────────────┐
  │  scanWorker.ts                                                              │
  │   ├─ readdirp(folder, {fileFilter: AUDIO_EXTS, type:'files'})                │
  │   ├─ for await entry of stream:                                              │
  │   │     if (cancelled) break                                                 │
  │   │     try { meta = await parseFile(entry.fullPath, {duration:true,         │
  │   │                                                   skipCovers:true}) }    │
  │   │     catch (e) { row = errorRow(entry, e.message) }                       │
  │   │     buffer.push(toRow(meta, entry))                                      │
  │   │     if (buffer.length >= BATCH_SIZE || elapsed >= BATCH_MS):             │
  │   │        parentPort.postMessage({type:'rows', rows: buffer.splice(0)})     │
  │   ├─ flush remainder                                                         │
  │   └─ parentPort.postMessage({type:'done', total})                            │
  └────────────────────────────────────────────────────────────────────────────┘
```

Primary use case trace: user clicks Scanner → renderer invokes `scan:start` → main returns scanId, spawns worker → worker streams entries → batches `{type:'rows', rows:[…50]}` to main → main persists in one `db.transaction(insertMany)(rows)` and `webContents.send('scan:event', batch)` → renderer appends to `rows[]` → virtualized list re-renders only visible rows. On `done`, button re-enables; user clicks "Exporter CSV" → `scan:export-csv(scanId)` → main `showSaveDialog` + `createWriteStream` + chunked `csv-stringify`.

### Recommended Project Structure (new files only)

```
src/
├── main/
│   ├── scan/
│   │   ├── controller.ts        # ScanController: spawn, lifecycle, IPC bridge
│   │   ├── controller.test.ts   # unit (mocked Worker + webContents)
│   │   ├── scanRepo.ts          # createScanRepo(db): insertBatch, complete, get, listFiles
│   │   ├── scanRepo.test.ts     # round-trip + batch insert
│   │   ├── csvExport.ts         # streamCsv(scanRepo, scanId, filePath)
│   │   └── csvExport.test.ts
│   ├── ipc/
│   │   └── scan.ts              # registerScanHandlers() — invoke handlers + event forwarder
│   └── workers/
│       ├── scanWorker.ts        # the worker entry; pure scan loop
│       └── scanCore.ts          # pure functions: toRow, hasGenreBpmKey, AUDIO_EXTS
│       └── scanCore.test.ts     # pure unit tests (no worker_threads import)
├── preload/
│   └── index.ts                 # extend djUtils with scan.{start,cancel,exportCsv,onEvent}
├── renderer/src/
│   ├── store/
│   │   └── useScanStore.ts      # Zustand: scanId, status, rows[], stats, listeners
│   │   └── useScanStore.test.ts
│   └── components/analyser/
│       ├── ScanToolbar.tsx      # start / cancel / export buttons + stats
│       ├── VirtualizedFileTable.tsx
│       └── TagBadge.tsx         # GBK badges
└── shared/
    └── ipc-types.ts             # extend IpcChannels + DjUtilsApi (Scan namespace)
```

### Pattern 1: Extending the typed IPC bridge (additive — preserves Phase 1 contract)

```typescript
// src/shared/ipc-types.ts (additions only)
export const IpcChannels = {
  PickFolder: 'dialog:pick-folder',
  GetRootFolder: 'settings:get-folder',
  SetRootFolder: 'settings:set-folder',
  // NEW
  ScanStart: 'scan:start',
  ScanCancel: 'scan:cancel',
  ScanExportCsv: 'scan:export-csv',
  ScanEvent: 'scan:event'                 // main → renderer push channel
} as const

export interface ScannedFile {
  path: string
  format: string                          // 'MP3' | 'FLAC' | 'M4A' | 'WAV' | 'AIFF' | 'OGG' | string
  bitrate: number | null                  // kbps
  sizeBytes: number
  sampleRate: number | null               // Hz
  durationSeconds: number | null
  hasGenre: boolean
  hasBpm: boolean
  hasKey: boolean
  parsedOk: boolean
  errorMessage: string | null
}

export type ScanEvent =
  | { type: 'rows'; scanId: string; rows: ScannedFile[] }
  | { type: 'done'; scanId: string; totalFiles: number; durationMs: number }
  | { type: 'error'; scanId: string; message: string }
  | { type: 'cancelled'; scanId: string }

export interface DjUtilsApi {
  // existing
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
  // NEW — `scan` namespace
  scan: {
    start(folder: string): Promise<string>                  // returns scanId
    cancel(scanId: string): Promise<void>
    exportCsv(scanId: string): Promise<string | null>       // saved path or null on cancel
    onEvent(cb: (e: ScanEvent) => void): () => void         // returns unsubscribe
  }
}
```

```typescript
// src/preload/index.ts (additions)
const scan = {
  start: (folder: string) => ipcRenderer.invoke(IpcChannels.ScanStart, folder),
  cancel: (scanId: string) => ipcRenderer.invoke(IpcChannels.ScanCancel, scanId),
  exportCsv: (scanId: string) => ipcRenderer.invoke(IpcChannels.ScanExportCsv, scanId),
  onEvent: (cb: (e: ScanEvent) => void) => {
    const handler = (_: unknown, e: ScanEvent) => cb(e)
    ipcRenderer.on(IpcChannels.ScanEvent, handler)
    return () => ipcRenderer.off(IpcChannels.ScanEvent, handler)
  }
}
contextBridge.exposeInMainWorld('djUtils', { ...existing, scan })
```

### Pattern 2: Pure scan worker (sketch)

```typescript
// src/main/workers/scanCore.ts — pure, importable from tests + worker
import { parseFile, type IAudioMetadata } from 'music-metadata'
import path from 'node:path'
import { stat } from 'node:fs/promises'

export const AUDIO_EXTS = ['.mp3', '.flac', '.m4a', '.aac', '.wav', '.aiff', '.aif', '.ogg', '.opus']

export function inferFormat(filePath: string, meta?: IAudioMetadata): string {
  return meta?.format?.container ?? path.extname(filePath).slice(1).toUpperCase() ?? 'UNKNOWN'
}

export function rowFromMetadata(filePath: string, sizeBytes: number, meta: IAudioMetadata): ScannedFile {
  const c = meta.common
  return {
    path: filePath,
    format: inferFormat(filePath, meta),
    bitrate: meta.format.bitrate ? Math.round(meta.format.bitrate / 1000) : null,
    sizeBytes,
    sampleRate: meta.format.sampleRate ?? null,
    durationSeconds: meta.format.duration ?? null,
    hasGenre: Array.isArray(c.genre) && c.genre.length > 0 && c.genre.some(g => g.trim() !== ''),
    hasBpm: typeof c.bpm === 'number' && c.bpm > 0,
    hasKey: typeof c.key === 'string' && c.key.trim() !== '',
    parsedOk: true,
    errorMessage: null
  }
}

export function errorRow(filePath: string, sizeBytes: number, msg: string): ScannedFile { /* … */ }
```

```typescript
// src/main/workers/scanWorker.ts — worker entry
import { parentPort, workerData } from 'node:worker_threads'
import { readdirp } from 'readdirp'         // v5 named export
import { stat } from 'node:fs/promises'
import { AUDIO_EXTS, rowFromMetadata, errorRow } from './scanCore'

const BATCH_SIZE = 50
const BATCH_MS = 200
const { folder, scanId } = workerData as { folder: string; scanId: string }
let cancelled = false
parentPort!.on('message', (m) => { if (m?.type === 'cancel') cancelled = true })

;(async () => {
  const startedAt = Date.now()
  const buffer: ScannedFile[] = []
  let lastFlush = Date.now()
  const flush = () => {
    if (buffer.length === 0) return
    parentPort!.postMessage({ type: 'rows', scanId, rows: buffer.splice(0) })
    lastFlush = Date.now()
  }
  try {
    const stream = readdirp(folder, {
      type: 'files',
      fileFilter: (e) => AUDIO_EXTS.includes(path.extname(e.basename).toLowerCase()),
      alwaysStat: true                  // we need size; saves a stat call
    })
    let total = 0
    for await (const entry of stream) {
      if (cancelled) break
      total++
      try {
        const meta = await parseFile(entry.fullPath, { duration: true, skipCovers: true })
        buffer.push(rowFromMetadata(entry.fullPath, entry.stats!.size, meta))
      } catch (e) {
        buffer.push(errorRow(entry.fullPath, entry.stats?.size ?? 0, (e as Error).message))
      }
      if (buffer.length >= BATCH_SIZE || Date.now() - lastFlush >= BATCH_MS) flush()
    }
    flush()
    if (cancelled) parentPort!.postMessage({ type: 'cancelled', scanId })
    else parentPort!.postMessage({ type: 'done', scanId, totalFiles: total, durationMs: Date.now() - startedAt })
  } catch (e) {
    parentPort!.postMessage({ type: 'error', scanId, message: (e as Error).message })
  }
})()
```

### Pattern 3: SQLite schema + batched insert (follows Phase 1 repo pattern)

```typescript
// src/main/scan/scanRepo.ts
export function initScanSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS scans (
      id TEXT PRIMARY KEY,
      root_folder TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER,
      total_files INTEGER,
      status TEXT NOT NULL                       -- 'running' | 'done' | 'cancelled' | 'error'
    );
    CREATE TABLE IF NOT EXISTS scanned_files (
      scan_id TEXT NOT NULL REFERENCES scans(id) ON DELETE CASCADE,
      path TEXT NOT NULL,
      format TEXT,
      bitrate INTEGER,
      size_bytes INTEGER NOT NULL,
      sample_rate INTEGER,
      duration_seconds REAL,
      has_genre INTEGER NOT NULL,                -- 0/1
      has_bpm INTEGER NOT NULL,
      has_key INTEGER NOT NULL,
      parsed_ok INTEGER NOT NULL,
      error_message TEXT,
      PRIMARY KEY (scan_id, path)
    );
    CREATE INDEX IF NOT EXISTS idx_scanned_files_scan ON scanned_files(scan_id);
  `)
}

export function createScanRepo(db: Database.Database) {
  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO scanned_files
    (scan_id, path, format, bitrate, size_bytes, sample_rate, duration_seconds,
     has_genre, has_bpm, has_key, parsed_ok, error_message)
    VALUES (@scan_id, @path, @format, @bitrate, @size_bytes, @sample_rate, @duration_seconds,
            @has_genre, @has_bpm, @has_key, @parsed_ok, @error_message)
  `)
  // Wrap in transaction — better-sqlite3 idiom: ~100x faster than per-row insert.
  const insertBatch = db.transaction((rows: ScannedFile[], scanId: string) => {
    for (const r of rows) insertStmt.run({
      scan_id: scanId, path: r.path, format: r.format, bitrate: r.bitrate,
      size_bytes: r.sizeBytes, sample_rate: r.sampleRate, duration_seconds: r.durationSeconds,
      has_genre: r.hasGenre ? 1 : 0, has_bpm: r.hasBpm ? 1 : 0, has_key: r.hasKey ? 1 : 0,
      parsed_ok: r.parsedOk ? 1 : 0, error_message: r.errorMessage
    })
  })
  return { /* createScan, insertBatch, complete, get, listFiles, deleteScan */ }
}
```

### Pattern 4: Renderer — Zustand store + virtualized table

```typescript
// src/renderer/src/store/useScanStore.ts
type ScanStatus = 'idle' | 'running' | 'done' | 'cancelled' | 'error'
interface ScanState {
  scanId: string | null
  status: ScanStatus
  rows: ScannedFile[]
  error: string | null
  durationMs: number | null
  unsubscribe: (() => void) | null
  start: (folder: string) => Promise<void>
  cancel: () => Promise<void>
  exportCsv: () => Promise<string | null>
}
// On start: clear rows[], subscribe via window.djUtils.scan.onEvent.
// On 'rows' event: setState(s => ({ rows: [...s.rows, ...e.rows] }))  // append
// (React 19's automatic batching covers the cost; even at 50 files / 200ms
//  that is ≤5 re-renders/sec, well below the budget.)
```

```tsx
// src/renderer/src/components/analyser/VirtualizedFileTable.tsx
import { useVirtualizer } from '@tanstack/react-virtual'
// fixed-height rows → estimateSize:()=>36; overscan:8
// Render only the visible window — 5000 rows costs the same as 50.
```

### Anti-Patterns to Avoid

- **Calling `setState` per file** in the renderer (re-render storm on 5000 files). Batch in main, append once per batch.
- **Inserting per row into SQLite** (~100× slower than `db.transaction(insertMany)`). Always batch.
- **Building the full CSV string in memory** for SCAN-04 — 50k rows × ~150 bytes = 7.5 MB string plus a copy for `fs.writeFile`. Use `createWriteStream` + chunked stringify.
- **Importing `worker_threads` from `scanCore.ts`** — keep parse/row logic pure so it's unit-testable without spinning a worker.
- **Spawning a worker pool** for the parse step — disk is the bottleneck on rotating media; CPU is rarely saturated by music-metadata.
- **Letting the renderer pass a folder path that isn't `settings.rootFolder`** — would re-introduce attack surface. Only accept the persisted folder (see Security).
- **Holding the SQLite connection open in the worker** — the worker has no DB access; it sends rows back and main writes them. One writer keeps WAL happy.
- **Forgetting `.terminate()` on cancel** — worker keeps draining `readdirp` until the directory is exhausted otherwise.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Recursive directory walk with symlink handling | `fs.readdir` recursion | `readdirp` | Symlink loops, ext filtering, streaming all solved |
| Audio container parsing | byte-poking MP3/M4A headers | `music-metadata.parseFile` | 6 formats × edge cases × tag versions = years of bugs |
| Bitrate/sample-rate/duration extraction | `ffprobe` subprocess | `music-metadata` | ffprobe spawn cost dwarfs parse cost at this scale |
| CSV escaping | `rows.map(r => r.join(',')).join('\n')` | `csv-stringify` | commas in filenames, embedded quotes, CRLF — all handled |
| Virtualized list | `rows.map(r => <Row/>)` + `overflow:scroll` | `@tanstack/react-virtual` | DOM nodes for 5k+ rows kills frame rate; virtualization gives O(viewport) |
| IPC channel typing | string literals everywhere | extend `IpcChannels` const + `DjUtilsApi` | Phase 1 already established this; do not regress |

**Key insight:** every primitive Phase 2 needs already has a battle-tested library — the only "build" work is wiring the worker, batching IPC, and persisting to the existing SQLite store. Anything more is YAGNI.

## Runtime State Inventory

Not applicable — Phase 2 is purely additive (new tables, new IPC channels, new files). No existing data is renamed, migrated, or replaced.

- **Stored data:** New `scans` + `scanned_files` tables added to existing `dj-utils.db`. Existing `settings` table untouched.
- **Live service config:** none — no external services.
- **OS-registered state:** none.
- **Secrets/env vars:** none.
- **Build artifacts:** new worker entry `src/main/workers/scanWorker.ts` must be configured in `electron.vite.config.ts` as a separate `build.lib.entry` so electron-vite emits it to `out/main/workers/scanWorker.js`. Without this, the `Worker` constructor will not find the compiled file at runtime. **Verify during Wave 0.**

## Common Pitfalls

### Pitfall 1 — SEVERITY: HIGH — Worker file path resolution after bundling

**What goes wrong:** `new Worker(path.join(__dirname, 'workers/scanWorker.js'))` works in dev (electron-vite serves a file tree) but throws `ERR_MODULE_NOT_FOUND` in packaged builds because the worker source was never registered as a bundle entry.
**Why:** electron-vite by default only emits `main/index.js` and `preload/index.js`. Workers need an explicit `lib.entry` so they get bundled with their deps.
**Avoid:** Add `workers/scanWorker` to `electron.vite.config.ts` under `main.build.lib.entry` (multi-entry array). Reference the compiled path via `import.meta.url` or `path.join(__dirname, '../workers/scanWorker.js')` from controller.ts.
**Warning sign:** scan works in `npm run dev` but fails in `npm run build:unpack`.

### Pitfall 2 — SEVERITY: HIGH — Per-row SQLite inserts during streaming

**What goes wrong:** Inserting rows one at a time as they arrive over IPC = thousands of fsyncs; scan UI updates fine but the DB write loop pegs a CPU core and slows everything.
**Avoid:** Always use `db.transaction(insertMany)(rows)` (the better-sqlite3 idiom). WAL is already on from Phase 1. One transaction per IPC batch (50 rows) is correct.
**Warning sign:** CPU spike on a core during scan; main-process event loop lag.

### Pitfall 3 — SEVERITY: MEDIUM — `music-metadata.parseFile` reads the whole file by default

**What goes wrong:** Calling `parseFile` without `{duration: true}` is fine for tags but may not return `duration` for some MP3s (relies on Xing/VBRI headers). Passing `{duration: true}` forces a full scan for VBR files lacking headers → slower but accurate.
**Avoid:** Use `{duration: true, skipCovers: true}`. `skipCovers` skips embedded album art parsing (saves memory and time; we don't need it for SCAN-01..05).
**Warning sign:** `durationSeconds: null` on many MP3s.
**Source:** `[CITED: github.com/borewit/music-metadata#options]`

### Pitfall 4 — SEVERITY: MEDIUM — Symlink loops and network volumes during traversal

**What goes wrong:** A symlink pointing to a parent dir = infinite walk. A mounted SMB share that goes offline = the worker blocks on `fs.stat` for tens of seconds per file.
**Avoid:** readdirp v5 follows symlinks but has built-in cycle protection (does not re-enter visited inodes). For network volumes, document as a known limitation for v1 — wrap `stat` in `Promise.race` with a per-file timeout only if user reports hang.
**Warning sign:** scan progress stalls; same file reported twice.
**Source:** `[CITED: github.com/paulmillr/readdirp README — symlink resolution]`

### Pitfall 5 — SEVERITY: MEDIUM — Renderer re-render storm on per-file events

**What goes wrong:** If the worker posts one message per file and Zustand `setState` runs per message, React 19 batches inside an event tick but cross-tick updates still queue. 50 files/sec × 5000 files = 100 seconds of constant re-render thrash.
**Avoid:** Batch in the worker (BATCH_SIZE=50 OR BATCH_MS=200, whichever first). Renderer appends one slice per IPC event. Virtualize the table so even a 50k `rows.length` does not blow up the DOM.
**Warning sign:** Chrome devtools shows 60+ render commits per second; scroll jank.

### Pitfall 6 — SEVERITY: LOW — Worker spawn cost on tiny folders

**What goes wrong:** Spawning a Node worker costs ~30–80 ms. On a folder of 5 files, the worker is overkill.
**Avoid:** Acceptable trade-off — keeping one code path simplifies things. If profiling shows it matters later, add a small-folder bypass. YAGNI for now.

### Pitfall 7 — SEVERITY: MEDIUM — CSV memory blowup on large libraries

**What goes wrong:** Calling `csv-stringify` synchronously on a 50k-row array produces a single huge string in memory before write.
**Avoid:** Stream from SQLite: open a `db.prepare('SELECT ... FROM scanned_files WHERE scan_id=?').iterate(scanId)` cursor, pipe through `csv-stringify`'s **streaming** API (`import { stringify } from 'csv-stringify'`), pipe into `fs.createWriteStream(savePath)`. Constant memory.
**Source:** `[CITED: csv.js.org/stringify/api/stream]`

### Pitfall 8 — SEVERITY: MEDIUM — Channel-name security: renderer-supplied folder path

**What goes wrong:** Accepting an arbitrary folder string from `scan:start` lets a compromised renderer scan any disk location.
**Avoid:** In `registerScanHandlers`, before spawning the worker: assert the requested folder equals `getSettingsRepo().get('rootFolder')`. Renderer never picks the folder; it just confirms a scan of the persisted one. This also matches the UX — there's only one root folder at a time.

### Pitfall 9 — SEVERITY: LOW — `music-metadata` is ESM-only since v8

**What goes wrong:** Direct `require('music-metadata')` from CommonJS code paths throws `ERR_REQUIRE_ESM`.
**Avoid:** electron-vite's main bundle is ESM-ready; just `import { parseFile } from 'music-metadata'`. If TS emits CommonJS for some path, switch tsconfig's `module` to `NodeNext` for main, or use dynamic `import()`.
**Source:** `[CITED: github.com/borewit/music-metadata#requirements]`

## Code Examples

All four `Pattern` snippets above are copy-ready. Additional one-liners worth pre-baking:

### Genre/BPM/Key presence detection from music-metadata

```typescript
// Source: music-metadata IAudioMetadata.common shape [CITED: github.com/borewit/music-metadata#api]
const c = meta.common
const hasGenre = Array.isArray(c.genre) && c.genre.some(g => g.trim() !== '')
const hasBpm   = typeof c.bpm === 'number' && c.bpm > 0      // ID3 TBPM frame
const hasKey   = typeof c.key === 'string' && c.key.trim() !== ''  // ID3 TKEY frame
```

music-metadata normalises ID3v2 TBPM → `common.bpm` and TKEY → `common.key` across MP3, FLAC, M4A. For MP4 atoms it maps `tmpo` → `bpm` and `\xa9key` if present.

### Streamed CSV export (avoids Pitfall 7)

```typescript
// src/main/scan/csvExport.ts
import { createWriteStream } from 'node:fs'
import { stringify } from 'csv-stringify'

export async function streamCsv(rowsIter: Iterable<ScannedFile>, savePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const out = createWriteStream(savePath)
    const stringifier = stringify({
      header: true,
      columns: ['path','format','bitrate','sizeBytes','sampleRate','durationSeconds','hasGenre','hasBpm','hasKey']
    })
    stringifier.on('error', reject)
    out.on('error', reject)
    out.on('finish', resolve)
    stringifier.pipe(out)
    for (const r of rowsIter) stringifier.write(r)
    stringifier.end()
  })
}
```

## State of the Art

| Old approach | Current | Impact |
|--------------|---------|--------|
| `fs.readdir` recursion + manual ext filter | `readdirp` v5 streaming | Symlink cycles + ext filter for free |
| `jsmediatags` | `music-metadata` 11.x | jsmediatags is read-only, less maintained, narrower format coverage |
| `react-window` | `@tanstack/react-virtual` v3 | Headless API + better TS + React 19 friendliness |
| Building CSV in-memory | `csv-stringify` streaming API | Constant memory regardless of row count |
| `child_process` for batch | `worker_threads` | Shared memory space, cheaper for thousands of small jobs |

Deprecated/outdated: jsmediatags, `node-id3` for **reading** (we use it only for writing in Phase 5), ad-hoc CSV string concatenation.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Single worker is enough throughput for "thousands of files" on typical DJ libraries | Standard Stack > Alternatives | Low — if profiling shows CPU saturation in Phase 3+, add Piscina then. Doesn't block SCAN-05. |
| A2 | music-metadata 11.12 reads TKEY/TBPM from MP3 + tmpo from M4A as `common.key`/`common.bpm` | Code Examples | Medium — if a format returns these in `native[...]` instead, badge logic needs a per-format fallback. Verify in Wave 0 with one file per format. |
| A3 | Default audio ext allowlist: mp3, flac, m4a, aac, wav, aiff, aif, ogg, opus | Open Questions | Low — user can clarify in `/gsd-discuss-phase`; defaults are safe DJ-format coverage. |
| A4 | Scan results persist between app runs (`scans` table not cleared on launch) | Open Questions | Medium — if user expects fresh-scan-every-time UX, store still works (just re-scan), but Phase 4 tagger queue assumes durable file list. |
| A5 | electron-vite supports a multi-entry `main.build.lib.entry` array for the worker | Pitfall 1 | Medium — verified pattern in electron-vite docs; if it fails, fall back to a manual rollup config for `out/main/workers/scanWorker.js`. |
| A6 | Renderer receives `ipcRenderer.on('scan:event', …)` events fine through sandboxed preload using a contextBridge-exposed subscribe function | Pattern 1 | Low — Phase 1 established that `contextBridge.exposeInMainWorld` works with function callbacks; the unsubscribe closure pattern is standard. |

## Open Questions (for `/gsd-discuss-phase` if used; otherwise planner decides)

1. **Audio extension allowlist:** propose `[mp3, flac, m4a, aac, wav, aiff, aif, ogg, opus]`. ALAC files are typically `.m4a`. Anything else? (User decides — default proposed is safe.)
2. **Recursive subfolder scan:** assume yes (music libraries are nested). No need to expose a toggle in v1.
3. **CSV save dialog:** default filename `dj-utils-scan-YYYYMMDD-HHmm.csv`, default location `app.getPath('downloads')`.
4. **Multiple concurrent scans:** assume no — `ScanController` enforces single-active-scan (start while running = cancel + restart). Simpler UX.
5. **Scan persistence policy:** keep all past scans? Cap at N most recent? Recommend "one scan per root folder, replaced on rescan" → at most a handful of rows in `scans` ever. Simpler and matches user intuition.
6. **Failed-parse rows:** still show them in the list (greyed out, "Erreur" badge)? Recommend YES so the user knows a file exists but its metadata couldn't be read.

## Environment Availability

No new external dependencies. All listed npm packages are pure-JS and bundle cleanly. Node `worker_threads` ships with the Electron 39 runtime.

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js (dev) | scaffold + build | ✓ | 24.16.0 | — |
| Electron's bundled Node (runtime) | worker_threads | ✓ | Node 22 (Electron 39) | — |
| better-sqlite3 native module | scan persistence | ✓ (Phase 1) | 12.10 | dual-ABI scripts already established |

## Validation Architecture

`.planning/config.json` not present → nyquist_validation treated as enabled.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4 (node + jsdom projects, already configured Phase 1) |
| Config file | `vitest.config.ts` (exists) |
| Quick run | `npm test -- --run <touched dir>` |
| Full suite | `npm test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SCAN-01 | rowFromMetadata returns format/bitrate/size for sample MP3 | unit (pure) | `npm test -- --run src/main/workers/scanCore` | ❌ Wave 0 |
| SCAN-02 | rowFromMetadata returns sampleRate + durationSeconds | unit (pure) | same | ❌ Wave 0 |
| SCAN-03 | hasGenre/hasBpm/hasKey true for tagged file, false for untagged | unit (pure) | same, with two fixture files | ❌ Wave 0 |
| SCAN-04 | streamCsv writes header + N rows; round-trips through parse | unit (fs.tmp) | `npm test -- --run src/main/scan/csvExport` | ❌ Wave 0 |
| SCAN-05 | ScanController spawns Worker, forwards batches to webContents, persists to repo | unit (mocked Worker + webContents.send + in-memory repo) | `npm test -- --run src/main/scan/controller` | ❌ Wave 0 |
| SCAN-05 | UI stays interactive during real 1000+ file scan | manual | human-verify checkpoint | n/a |

Pattern from Phase 1: handler/orchestrator logic is factored into pure functions (Pattern: `pickFolderHandler(dialogApi)`, `createSettingsRepo(db)`). Apply the same here — `ScanController` takes injectable `{ spawnWorker, repo, send }`, never touches `electron.app` directly. The worker is unit-tested via its pure core (`scanCore.test.ts`), not by spinning a real Worker.

### Sampling Rate

- Per task commit: `npm test -- --run <touched dir>`
- Per wave merge: `npm test -- --run`
- Phase gate: full suite green + human-verify checkpoint (scan 1000+ real files, UI stays interactive, CSV export opens cleanly in a spreadsheet)

### Wave 0 Gaps

- [ ] Add worker entry to `electron.vite.config.ts` under `main.build.lib.entry` — verify `out/main/workers/scanWorker.js` exists after `npm run build`
- [ ] Add fixture audio files: `src/main/workers/__fixtures__/tagged.mp3` (Genre+BPM+Key set), `src/main/workers/__fixtures__/untagged.mp3`, `src/main/workers/__fixtures__/sample.flac`. Keep <10 KB each — strip cover art with ffmpeg if needed.
- [ ] Extend `vitest.config.ts` node project's `include` if any new test dir is outside currently-globbed paths.

## Security Domain

`security_enforcement` absent → enabled. This is a local desktop app, no network/auth.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | no accounts |
| V3 Session Management | no | none |
| V4 Access Control | yes | renderer must NOT pass arbitrary paths to filesystem APIs — main asserts `folder === settings.rootFolder` |
| V5 Input Validation | yes | every IPC handler runtime-checks payloads (`typeof folder === 'string'`, scanId UUID shape); already-established Phase 1 idiom |
| V6 Cryptography | no | no secrets |
| V14 Configuration | yes | preserve `contextIsolation:true`, `sandbox:true`, `nodeIntegration:false`; do NOT add `nodeIntegrationInWorker` |

### Known Threat Patterns for this phase

| Pattern | STRIDE | Mitigation |
|---------|--------|------------|
| Renderer supplies attacker-chosen path to `scan:start` → reads anywhere on disk | Tampering / Info Disclosure | Main handler asserts requested folder matches persisted `rootFolder`; return error otherwise |
| Renderer supplies attacker-chosen path to `scan:export-csv` → writes anywhere | Tampering | Save path is chosen by main via `dialog.showSaveDialog` only; renderer never names it |
| Malformed audio file crashes worker → unhandled exception → main left with dangling Worker | DoS | `try/catch` per `parseFile`; emit `errorRow` and continue. Worker catches top-level rejection and posts `{type:'error'}` so main can clean up |
| ZIP-bomb-style deeply nested symlink loop | DoS | readdirp cycle protection (verified Phase 5 source) |
| Path traversal in scanned file paths bleeding into CSV / DB | Tampering | Paths are absolute strings from `fs`; treated as opaque data, never re-resolved |
| Worker process consumes unbounded memory parsing a huge file | DoS | `parseFile` is bounded by file size; `skipCovers:true` avoids loading large embedded images; document network-volume timeout as v1 limitation |
| New IPC channels expand attack surface | Elevation of Privilege | Every new channel registered in `IpcChannels` const, typed in `DjUtilsApi`, runtime-validated in handler |

No new attack surface that's not gated by main-process validation. Renderer remains sandboxed.

## Sources

### Primary (HIGH confidence)
- npm registry via `npm view` (2026-05-29) — all four package versions, engines, publish dates
- slopcheck install dry-run (2026-05-29) — 4/4 OK
- music-metadata README + API docs — `[CITED: github.com/borewit/music-metadata]` (parseFile options, common-tag normalisation)
- readdirp README — `[CITED: github.com/paulmillr/readdirp]` (fileFilter, alwaysStat, symlink cycle protection in v5)
- csv-stringify docs — `[CITED: csv.js.org/stringify]` (streaming API)
- better-sqlite3 docs — `[CITED: github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md]` (`db.transaction(fn)` ≈100× faster for batch insert)
- Phase 1 RESEARCH + SUMMARY files in `.planning/phases/01-foundation/` — established stack, IPC pattern, repo factory pattern, dual-ABI scripts
- Repo source: `src/shared/ipc-types.ts`, `src/main/{index,ipc,db}/*`, `src/preload/index.ts`, `src/renderer/src/store/useAppStore.ts` — confirmed conventions to extend

### Secondary (MEDIUM confidence)
- Electron worker_threads usage in main process — standard pattern; references in electron-vite GitHub issues for `lib.entry` multi-worker setups

### Tertiary (LOW confidence)
- none

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — every package version verified on npm today + slopcheck OK + 4 of 4 have multi-year track records and active maintenance.
- Architecture: HIGH — reuses Phase 1's IPC pattern, repo pattern, dual-ABI scripts; the only new shape is the worker + streaming events, both Node-built-in primitives.
- Pitfalls: HIGH — bundled-worker pathing, per-row SQLite inserts, ESM-only music-metadata, and renderer re-render storms are all well-documented gotchas confirmed against current docs.

**Research date:** 2026-05-29
**Valid until:** 2026-06-28 (re-verify music-metadata + readdirp publish dates if past)
