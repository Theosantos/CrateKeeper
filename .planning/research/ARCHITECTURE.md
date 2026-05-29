# Architecture Research — DJ Utils

**Researched:** 2026-05-28
**Confidence:** HIGH (Electron process model and Node.js concurrency patterns are well-established)

---

## Component Map

| Component | Process | Responsibility |
|-----------|---------|---------------|
| `FileScanner` | Main | Walk directory tree, emit file metadata (path, size, format, bitrate) |
| `AudioAnalyzer` | Main / Worker | Read audio headers (format, duration, bitrate) via `music-metadata` or `ffprobe` |
| `FFmpegWorker` | Worker Thread(s) | Execute FFmpeg conversions, report progress over MessageChannel |
| `TagWriter` | Main | Write ID3v2 / MP4 tags to files using `node-taglib-sharp` or `music-tag` |
| `SessionStore` | Main | Persist tagger queue state to disk (SQLite or JSON file) |
| `IPC Bridge` | Main (handlers) | Expose all main-process capabilities to renderer via `ipcMain`/`ipcRenderer` |
| `TaggerUI` | Renderer | Swipe/button interface, audio snippet playback, inline metadata fields |
| `LibraryUI` | Renderer | File list view, analysis results, conversion queue controls |
| `AudioPlayer` | Renderer | Web Audio API playback of snippets loaded via ArrayBuffer |

---

## Process Architecture (Electron Main vs Renderer)

### Main Process — what lives here

The main process is a full Node.js runtime with filesystem access, child_process, and worker_threads. All operations that touch the filesystem, spawn subprocesses, or do CPU-heavy work belong here.

**File scanning**
Use Node's `fs.readdir` with `recursive: true` (Node 18+) or `fast-glob` for cross-platform glob patterns. Emit results in chunks of ~200 files at a time over IPC so the renderer can display progress without waiting for the full scan to finish.

**Audio metadata reading**
`music-metadata` is a pure-JS library that reads audio headers without spawning a process. Run it in the main process (not a worker) for the scan phase — it is I/O-bound, not CPU-bound, so it can run concurrently with chunked directory reads using async iteration.

**FFmpeg conversion**
Spawn FFmpeg via `child_process.spawn` (not `exec` — you need streaming stdout/stderr for progress). Each conversion job is a separate child process. Maintain a concurrency-limited job queue (max 2–4 parallel FFmpeg processes to avoid saturating disk I/O). Report progress back to the renderer via `ipcMain` events.

**Tag writing**
`node-taglib-sharp` provides bindings to TagLib, which handles ID3v2.3/2.4 (MP3) and MP4 atoms correctly. Writing runs in the main process synchronously per file — each write is fast (< 5ms for most files).

**Session persistence**
A single SQLite file (via `better-sqlite3`) or a JSON flat file for the tagger queue: which files are pending, which are tagged, which are skipped, and what tags were applied. SQLite is preferable for thousands of records because it supports atomic writes and partial reads. Use `better-sqlite3` (synchronous API) — it is safe from main process and does not require async coordination.

### Renderer Process — what lives here

The renderer is a Chromium web page. It has no Node.js APIs unless you explicitly expose them via the preload script with `contextBridge`. The renderer must not import Node modules directly — this was deprecated in Electron 12+ as a security hardening measure.

**All renderer ↔ main communication goes through `contextBridge`** in the preload script. Expose a typed `window.djUtils` API object that wraps `ipcRenderer.invoke` calls.

**Audio playback**
Load a snippet (first 30–60 seconds) via an IPC call that returns an ArrayBuffer. Decode and play with the Web Audio API (`AudioContext.decodeAudioData`). This is faster than creating an `<audio>` element pointed at a `file://` URL because:
- You control exactly which bytes to read (seek to offset, read N bytes)
- No CORS issues with `file://` URLs on Windows
- Waveform visualization is possible from the decoded AudioBuffer if you want it later

**File list virtualization**
For thousands of files, use a virtual list renderer. `@tanstack/virtual` (framework-agnostic) or the React-specific `react-window` will render only the visible rows. Without virtualization, rendering 5,000 `<tr>` elements will freeze the UI thread on the first paint.

**Tagger queue state**
Keep the in-memory queue state in the renderer using a simple reducer (Zustand or plain React context). Treat the main process SQLite store as the source of truth — sync on app load and write through on each tag action. Do not batch writes — each "keep/skip" action should persist immediately so session resumption after a crash is clean.

### Preload Script

The preload script is the bridge. It runs in an isolated context with access to both Node and browser APIs, but exposes only what the renderer needs:

```typescript
// preload.ts
contextBridge.exposeInMainWorld('djUtils', {
  scan: (dir: string) => ipcRenderer.invoke('scan:start', dir),
  onScanProgress: (cb) => ipcRenderer.on('scan:progress', (_, chunk) => cb(chunk)),
  convert: (jobs: ConvertJob[]) => ipcRenderer.invoke('convert:start', jobs),
  onConvertProgress: (cb) => ipcRenderer.on('convert:progress', (_, p) => cb(p)),
  loadSnippet: (path: string, startSec: number, durationSec: number) =>
    ipcRenderer.invoke('audio:snippet', { path, startSec, durationSec }),
  writeTags: (path: string, tags: AudioTags) => ipcRenderer.invoke('tags:write', { path, tags }),
  getQueue: () => ipcRenderer.invoke('queue:get'),
  updateQueue: (entry: QueueEntry) => ipcRenderer.invoke('queue:update', entry),
})
```

---

## Data Flow

### Scan + Analyze flow

```
User picks directory
  → renderer calls window.djUtils.scan(dir)
  → IPC invoke: main 'scan:start'
  → Main: async iterator walks directory tree
  → Every 200 files: ipcMain emits 'scan:progress' with chunk[]
    → Renderer updates file list incrementally
  → On complete: IPC invoke resolves with { total, errors[] }
```

### Conversion flow

```
User selects files + target format, clicks Convert
  → renderer calls window.djUtils.convert(jobs)
  → IPC invoke: main 'convert:start'
  → Main: JobQueue limits concurrency (default: 2 parallel)
  → Each job: child_process.spawn('ffmpeg', args)
    → stdout parsed for progress percentage (ffmpeg -progress pipe:1)
    → ipcMain emits 'convert:progress' { jobId, percent, status }
  → Renderer updates per-file progress bars
  → On job complete: status written to SessionStore
```

### Tagger flow

```
App load:
  → renderer calls window.djUtils.getQueue()
  → Returns pending entries from SQLite
  → Renderer loads first entry

Per card:
  → renderer calls window.djUtils.loadSnippet(path, 0, 45)
  → Main reads bytes from file, returns ArrayBuffer
  → Renderer: AudioContext.decodeAudioData(buffer) → plays snippet
  → User swipes / clicks Keep or Skip
  → renderer calls window.djUtils.writeTags(path, tags)
    → Main: node-taglib-sharp writes ID3/MP4 tags to file
  → renderer calls window.djUtils.updateQueue({ id, status: 'tagged' })
    → Main: better-sqlite3 updates row synchronously
  → Renderer advances to next card
```

---

## Concurrency Model for FFmpeg

Do NOT use worker_threads for FFmpeg. Worker threads run JavaScript; FFmpeg is a native binary. Use `child_process.spawn` with a semaphore-style job queue:

```typescript
// Pseudocode — JobQueue in main process
class JobQueue {
  private running = 0
  private queue: Job[] = []
  private maxConcurrent: number

  enqueue(job: Job) { this.queue.push(job); this.drain() }

  private async drain() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!
      this.running++
      this.run(job).finally(() => { this.running--; this.drain() })
    }
  }

  private run(job: Job): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('ffmpeg', job.args)
      proc.stdout.on('data', (d) => parseProgress(d, job.id))
      proc.on('close', (code) => code === 0 ? resolve() : reject(code))
    })
  }
}
```

Worker threads are appropriate only for CPU-bound JavaScript. If you later add audio analysis that requires significant JS computation (BPM detection, waveform rendering), put that in a worker thread.

---

## File List Performance

For 5,000+ files in the library view:

1. **Virtual list** — render only ~20 visible rows at any time. `@tanstack/virtual` is framework-agnostic and lightweight.
2. **Chunked IPC** — never send all 5,000 file records in one IPC message. Chunk scan results to 200 records per IPC event. Large IPC payloads serialize to JSON and block the IPC bridge.
3. **Lazy metadata** — send only `{ path, name, size }` in the initial scan chunk. Fetch `{ bitrate, duration, format }` lazily as rows scroll into view, or as a secondary pass once the scan is complete.
4. **Avoid storing Buffers in IPC** — send file paths, not file contents, for metadata operations. Only send ArrayBuffers for actual audio snippet playback, and keep those to ≤ 5MB per snippet.

---

## Audio Snippet Architecture

**Recommended approach: partial file read + Web Audio API**

1. Main process receives `(path, startSec, durationSec)` from renderer
2. Main runs `ffmpeg -ss {startSec} -t {durationSec} -i {path} -f mp3 pipe:1` and collects stdout into a Buffer
3. Returns the Buffer as a serialized ArrayBuffer over IPC
4. Renderer: `audioCtx.decodeAudioData(buffer)` → `AudioBufferSourceNode.start()`

This avoids:
- `<audio src="file://...">` CORS/permission issues on Windows
- Loading entire large files into memory
- Any dependency on Electron's custom protocol handling

Keep snippet duration to 30–45 seconds. At MP3 128kbps, 45s = ~720KB — well within IPC budget.

For the initial snippet load on card display, target < 500ms total latency (ffmpeg decode of 45s at 128kbps is typically 50–150ms).

---

## Session Persistence

Use `better-sqlite3` with a single `queue` table:

```sql
CREATE TABLE queue (
  id       INTEGER PRIMARY KEY,
  path     TEXT NOT NULL UNIQUE,
  status   TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'tagged' | 'skipped'
  tags     TEXT,          -- JSON blob of applied tags
  added_at INTEGER,       -- unix timestamp
  done_at  INTEGER
);
```

On app start: `SELECT * FROM queue WHERE status = 'pending' ORDER BY added_at`.
On tag/skip: `UPDATE queue SET status = ?, tags = ?, done_at = ? WHERE path = ?`.

This schema survives app crashes and supports resuming mid-session across days. It also makes it trivial to export a "what I tagged today" report later.

Store the database file at `app.getPath('userData')/dj-utils.db` — Electron's platform-appropriate data directory (`~/Library/Application Support/dj-utils/` on macOS, `%APPDATA%\dj-utils\` on Windows).

---

## Suggested Build Order

Build in dependency order — each phase unblocks the next.

**Phase 1 — Foundation (IPC bridge + scaffolding)**
- Electron + Vite/React boilerplate with contextBridge preload
- Typed IPC channel definitions shared between main and renderer
- `app.getPath('userData')` wiring and `better-sqlite3` setup
- Basic window shell

*Why first:* Every other component depends on the IPC layer being correct. Getting this right early prevents architecture debt.

**Phase 2 — File scanning + library view**
- `FileScanner` with chunked async iteration
- `music-metadata` integration for header reading
- Virtual list renderer for file table
- Scan progress UI

*Why second:* This produces the file list that feeds both conversion and the tagger queue. Also the easiest path to a working demo.

**Phase 3 — FFmpeg conversion pipeline**
- `JobQueue` with `child_process.spawn`
- FFmpeg progress parsing (`-progress pipe:1`)
- Per-file progress bars in LibraryUI
- Output path + format configuration

*Why third:* Conversion is independent of tagging. DJs may use conversion alone initially. Validates the concurrency model before the more complex tagger.

**Phase 4 — Tagger core (playback + keep/skip)**
- SQLite queue population from file list
- `loadSnippet` IPC handler (ffmpeg pipe + ArrayBuffer return)
- Web Audio API playback in renderer
- Swipe UI with keep/skip buttons
- Queue persistence

*Why fourth:* Depends on the file list from Phase 2. Audio playback is the hardest piece to get right — isolated in its own phase.

**Phase 5 — Tag writing + metadata editing**
- `node-taglib-sharp` integration
- Inline BPM, key, genre, artist, title fields on tagger card
- `writeTags` IPC handler
- Validation (BPM is numeric, required fields)

*Why fifth:* Tag writing is straightforward once playback and queue are working. Keeping it separate lets you validate the UX before adding the write layer.

**Phase 6 — Polish + distribution**
- `electron-builder` config for `.dmg` (macOS) and `.exe` (Windows)
- Auto-bundled FFmpeg binary (avoid requiring user to install FFmpeg separately)
- Error handling, empty states, loading skeletons
- App icon, About dialog

*Why last:* Distribution packaging requires knowing the final binary dependencies. FFmpeg bundling is the trickiest packaging concern.

---

## Key Findings

**1. Process split is non-negotiable for performance.**
All filesystem, FFmpeg, and tag-writing work must live in the main process. Putting any of it in the renderer risks blocking the UI thread and violates Electron's security model. The contextBridge/IPC boundary is the correct abstraction.

**2. FFmpeg via child_process, not worker_threads.**
Worker threads execute JavaScript. FFmpeg is a native binary invoked via spawn. A semaphore-based JobQueue in the main process with 2–4 concurrent FFmpeg children is the correct concurrency model. Increasing beyond 4 concurrent conversions typically degrades throughput due to disk I/O contention.

**3. Virtual list is mandatory for large libraries.**
Without virtualization, a 3,000-file library will produce a DOM with 3,000+ rows and will noticeably freeze on first render. `@tanstack/virtual` adds ~3KB gzipped and is framework-agnostic.

**4. Audio snippets via FFmpeg pipe + Web Audio API.**
This sidesteps all `file://` URL issues on Windows, avoids loading full files, and gives you frame-accurate seeking. The latency (< 200ms for a 45s snippet at 128kbps) is acceptable for a card-load UX.

**5. SQLite (better-sqlite3) for queue persistence.**
JSON file persistence is fragile under concurrent writes and crashes mid-write. `better-sqlite3`'s synchronous API is safe from the main process and provides ACID guarantees with zero configuration. The synchronous API is a feature here, not a limitation — it keeps the main process flow simple.

**6. Bundle FFmpeg with the app.**
Do not require DJs to install FFmpeg themselves. `ffmpeg-static` (npm package) provides pre-built FFmpeg binaries for macOS and Windows that electron-builder can include in the installer. This is the single biggest DX improvement for a non-developer user base.

**7. Chunk IPC messages — never send thousands of records at once.**
IPC serializes to JSON on both ends. A single message with 5,000 file records will block the IPC thread for hundreds of milliseconds. Emit chunks of 100–200 records and stream them into the renderer's virtual list incrementally.

---

## Risks and Mitigations

| Risk | Likelihood | Mitigation |
|------|------------|-----------|
| FFmpeg binary not found at runtime (packaged app) | HIGH if not addressed | Use `ffmpeg-static` and resolve path via `app.isPackaged` check |
| `better-sqlite3` native module fails to load after packaging | MEDIUM | Pin to a version with prebuilt binaries; configure `electron-builder` `extraResources` for `.node` files |
| IPC payload too large (full file list) | MEDIUM | Chunk all scan results; never send full library in one message |
| Web Audio context suspended on macOS (requires user gesture) | LOW-MEDIUM | Resume `AudioContext` on first user interaction (card tap or button click) |
| Tag writing corrupts file on crash mid-write | LOW | `node-taglib-sharp` writes atomically (temp file + rename); validate this behavior |

---

## Sources

- Electron documentation: process model, contextBridge, ipcMain/ipcRenderer (HIGH confidence — core platform docs)
- Node.js `child_process.spawn` documentation (HIGH confidence)
- `better-sqlite3` documentation — synchronous SQLite for Node/Electron (HIGH confidence)
- `music-metadata` npm package — pure-JS audio metadata reader (HIGH confidence)
- `@tanstack/virtual` — virtual list for large DOM lists (HIGH confidence)
- `ffmpeg-static` npm package — pre-built FFmpeg binaries for packaging (MEDIUM confidence — verify current version supports arm64 macOS)
- Web Audio API spec — `decodeAudioData`, `AudioBufferSourceNode` (HIGH confidence)
