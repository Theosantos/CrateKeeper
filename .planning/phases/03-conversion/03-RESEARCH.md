# Phase 3: FFmpeg Conversion Pipeline — Research

**Researched:** 2026-06-03
**Domain:** Electron 39 main-process batch ffmpeg conversion (worker_threads → child_process pool → ID3-preserving transcode → SQLite resume)
**Confidence:** HIGH (stack pinned by PROJECT.md; patterns established by Phase 2)

## Summary

Phase 3 ships the Convertir vertical slice: Analyser-selected files flow through a new `conversion.*` IPC namespace into a `ConversionController` that owns a single-active batch, spawns a `conversionWorker.ts` (Node `worker_threads`), which runs an internal child_process pool of `min(cpus-1, 4)` ffmpeg processes against the bundled `ffmpeg-static` binary. Persistence lives in two new SQLite tables (`conversions`, `conversion_files`); a heartbeat column drives crash detection so the user can resume crashed batches on next launch. Tag preservation is delegated to ffmpeg flags (`-map_metadata 0 -id3v2_version 3` for MP3 targets), not pre-read/post-write.

The architecture is a near-perfect mirror of Phase 2 scanning. Every shape (typed IPC, lazy-require electron, persist-then-forward, batched progress, repo factory + lazy singleton, V5 input validation, folder allowlist gate, worker bundled via `electron.vite.config.ts`) carries forward unchanged. The only structurally new concept is the **intra-batch ffmpeg pool** living inside the worker — a pull-based queue draining a list of pending files at `parallelism` slots, with each slot spawning ffmpeg via `child_process.spawn()` and parsing stderr `time=HH:MM:SS.MS` lines for per-file progress.

**Primary recommendation:** Spawn ffmpeg directly via `child_process.spawn` from the worker (no fluent-ffmpeg). Phase 2's hand-rolled-stream pattern carries forward; adding fluent-ffmpeg's promise wrapper buys nothing here and obscures the cancel/SIGTERM path that Phase 3 needs to be explicit about.

## User Constraints (from CONTEXT.md)

### Locked Decisions

| Area | Decision |
|------|----------|
| Selection UX | Checkbox column in Analyser table; toolbar "Convertir N fichiers" switches view |
| Format config | 5 presets (MP3 320 CBR, MP3 V0 VBR, AAC 256, FLAC, WAV) + Custom; persisted in `settings` table under `conversion.lastPreset`; volatile override per-batch |
| Default format | MP3 320 CBR |
| Output dir | `{rootFolder}/converted/{preset-slug}/` |
| Conflict policy | Skip + log as error row (`output_exists`) |
| Concurrency (batch) | Single-active (mirror of scan) — second start rejects with `BatchAlreadyActive` |
| Concurrency (intra-batch) | Adaptive: `min(os.cpus().length - 1, 4)` parallel ffmpeg processes |
| Resume | Auto-detect crashed batches on launch via 30s heartbeat threshold → prompt user; cancelled batches NOT resumable |
| Persistence | `conversions` + `conversion_files` SQLite tables; `conversions.heartbeat_at` for crash detection |
| Tag preservation | ffmpeg `-map_metadata 0 -id3v2_version 3` (Rekordbox lock) when target is MP3; `-map_metadata 0` otherwise |
| Worker buffering | BATCH_SIZE=20 progress events, BATCH_MS=200ms; per-file completion events flushed immediately |
| Worker boundary | Pure Node — no `electron` import. Only `child_process`, `path`, `fs`, `worker_threads`, `node:os` |
| IPC namespace | `conversion.*` (start, cancel, list-resumable, resume, event) mirroring `scan.*` |

### Claude's Discretion

- Internal worker pool implementation shape (Promise.all of N slot-runners vs explicit queue object)
- Exact stderr regex for progress parsing (recommendation below)
- Whether to add a `progress_percent` column to `conversion_files` or keep it volatile in renderer state (recommendation: volatile; DB stores only terminal state)
- Convertir view UI shape — see Open Question 11 below; researcher recommendation: include minimal UI scope in PLAN, do not branch to `/gsd-ui-phase`

### Deferred Ideas (OUT OF SCOPE)

- Multi-batch parallelism (concurrent batches)
- Per-batch output dir override (`showSaveDialog`)
- Conflict resolution UI (overwrite/rename per-conflict)
- Drag-and-drop conversion from outside Analyser
- Conversion presets editor UI (user-editable preset list)
- Client-side bitrate-against-codec validation in Custom form
- GPU / hardware encoders

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| CONV-01 | User can select files from analysis and launch a batch conversion | Selection lives in `useScanStore` (checkbox column in `VirtualizedFileTable`); toolbar button switches view; `conversion:start` IPC accepts `{ filePaths: string[], preset: Preset, rootFolder: string }` — see Code Examples §1. |
| CONV-02 | Target format + bitrate configurable (MP3 320kbps default) | 5 presets + Custom form. Preset → ffmpeg arg array mapping table in §Code Examples §2. Persistence via existing `settings` k/v table under `conversion.lastPreset`. |
| CONV-03 | Per-file + global progress bars during conversion | Worker parses ffmpeg stderr `time=HH:MM:SS.MS`; emits `{ type: 'progress', conversionId, filePath, percent, phase }` events batched 20/200ms. Renderer derives global % = `done_count / total_count`. See §Code Examples §3. |
| CONV-04 | Per-file errors listed without aborting batch | Per-file try/catch in worker's slot-runner emits `{ type: 'fileDone', status: 'error', errorMessage }`. Batch transitions to `done` once every file is terminal (`done | error | skipped | cancelled`). |
| CONV-05 | Conversion resumable after interruption | `conversions.heartbeat_at` bumped every 5s by controller; on app boot, `findResumable()` marks rows with `status='running' AND heartbeat_at < now-30s` as `crashed`; `conversion:resume` re-spawns with same `conversion_id`, worker re-queues files where `status IN ('pending', 'running', 'error')`. |
| CONV-06 | Existing ID3/MP4 tags preserved on conversion | ffmpeg `-map_metadata 0 -id3v2_version 3` flags. Verified mappings: FLAC Vorbis → ID3v2.3, MP3 ID3v2.3 → MP3 ID3v2.3 round-trip clean for TIT2/TPE1/TALB/TCON/TBPM/TKEY/COMM/APIC. See §Tag Preservation Matrix. |

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| File selection state | Renderer (Zustand) | — | Selection is UI-only until user clicks "Convertir N fichiers". Persists across view switches; resets on new scan. |
| Conversion config (preset/custom) | Renderer (Zustand) | Main (settings repo for last-used) | Per-batch config is volatile UI state; only the "last selected" preset is persisted. |
| Batch lifecycle orchestration | Main (ConversionController) | — | Single-active invariant + persist-then-forward + worker spawn must live in main, mirror of ScanController. |
| Persistence (`conversions`, `conversion_files`) | Main (conversionRepo) | — | better-sqlite3 native binding only lives in main; repo factory pattern locked in Phase 1/2. |
| ffmpeg process spawn + stderr parse | Worker (Node `worker_threads`) | — | CPU-bound work + subprocess management off the main event loop. Worker = pure Node, no electron import. |
| ffmpeg binary path resolution | Main (at controller construction) | Worker (receives path via `workerData`) | `require('ffmpeg-static')` resolves in main where `app.isPackaged` is observable; worker receives the resolved path so it stays pure-Node. |
| Folder allowlist gate | Main (IPC handler) | — | Same Threat T-2-01 mitigation as scan: input file paths AND output dir must resolve under `settings.rootFolder`. |
| Progress UI | Renderer (React + Zustand) | — | Per-file + global progress is volatile UI state; DB stores only terminal status. |
| Crash detection | Main (ConversionController on boot) | — | Heartbeat threshold check happens before the renderer mounts; result is exposed via `conversion:list-resumable`. |

## Standard Stack

### Core

| Library | Version (verified) | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ffmpeg-static` | ^5.3.0 (already in deps; `npm view ffmpeg-static version` confirms 5.x is current stable) `[VERIFIED: package.json + npm registry]` | Bundled ffmpeg binary for Mac (arm64+x64) and Windows x64; resolved via `require('ffmpeg-static')` returning path string | Industry standard for Node-based Electron apps; the only realistic way to ship ffmpeg without a system dep. `[CITED: PROJECT.md]` |
| `better-sqlite3` | ^12.10.0 (already wired in `connection.ts`) `[VERIFIED: package.json]` | New `conversions` + `conversion_files` tables via repo factory | Locked in Phase 1; repo factory pattern (`createConversionRepo(db) + initConversionSchema(db)`) carries forward unchanged. `[VERIFIED: src/main/scan/scanRepo.ts]` |
| Node `worker_threads` | built-in (Node 20+ ships with Electron 39) `[VERIFIED: package.json electron ^39.2.6]` | `conversionWorker.ts` host | Mirror Phase 2; bundled via existing `electron.vite.config.ts` rollup input pattern. `[VERIFIED: electron.vite.config.ts]` |
| Node `child_process` | built-in | Spawn ffmpeg processes inside the worker; parse stderr | Direct `spawn()` is the canonical Node pattern; fluent-ffmpeg adds promise sugar but obscures the SIGTERM/cleanup path Phase 3 needs to own. `[CITED: nodejs.org docs]` |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `node:os` | built-in | `os.cpus().length` for parallelism cap | Worker startup, deriving `min(cpus-1, 4)` slot count |
| `node:crypto` `randomUUID` | built-in | Generate `conversion_id` | Same usage as `scanId` in controller.ts |
| `music-metadata` | ^11.12.3 (already a dep) `[VERIFIED: package.json]` | Read source tags ONLY for the progress UI label ("Converting: Artist - Title") | Pre-flight UI nicety; actual preservation is ffmpeg's job |
| `electron-builder` | ^26.0.12 (already a dep) | `asarUnpack` config for `ffmpeg-static` | Already installed; Phase 6 finalizes the config but Phase 3 emits the runtime resolver |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Direct `child_process.spawn` | `fluent-ffmpeg` ^2.1 | fluent-ffmpeg wraps spawn with a chainable API and built-in progress events. Rejected because (a) we already own equivalent stderr parsing for scan-style streaming; (b) explicit SIGTERM control matters for cancel; (c) fluent-ffmpeg adds 200KB and a runtime dep with no upside on this surface. PROJECT.md lists it as the "recommended" wrapper but Phase 2's worker pattern is simpler without it. |
| `node-id3` for explicit re-tagging post-convert | ffmpeg `-map_metadata 0` flag | Pure-JS post-write tools are fragile across formats; ffmpeg's mapping is battle-tested. node-id3 is reserved for Phase 5 (TAGS-01) where deliberate writes happen. |
| `mp4tag.js` for MP4 tag writes | ffmpeg remux `-c:a copy -map_metadata 0` | PROJECT.md explicitly defers MP4 tag writes to ffmpeg remux. Pure-JS atom writers are fragile. |
| Heartbeat in worker | Heartbeat in controller | Controller is the right tier — it owns the persistence layer and survives worker crashes. Worker death is one of the things heartbeat detects. |

**Installation (already complete — verify with `npm ls`):**

```bash
# All already in package.json:
#   ffmpeg-static ^5.3.0
#   music-metadata ^11.12.3
#   better-sqlite3 ^12.10.0
# No new runtime deps for Phase 3.
```

## Package Legitimacy Audit

slopcheck was not available in this session; per protocol all packages are tagged `[ASSUMED]` for legitimacy purposes. However, all packages below are already pinned in `package.json` and have been used in Phases 1 and 2 — registry existence + ecosystem use is corroborating evidence beyond slopcheck.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| `ffmpeg-static` | npm | ~9 yrs | ~1M/wk | github.com/eugeneware/ffmpeg-static | [ASSUMED] | Approved (already in deps, used industry-wide) |
| `music-metadata` | npm | ~13 yrs | ~2M/wk | github.com/Borewit/music-metadata | [ASSUMED] | Approved (already in deps) |
| `better-sqlite3` | npm | ~9 yrs | ~3M/wk | github.com/WiseLibs/better-sqlite3 | [ASSUMED] | Approved (already wired) |

**Packages removed due to slopcheck [SLOP] verdict:** none.
**Packages flagged as suspicious [SUS]:** none.

No new packages introduced. Phase 3 reuses Phase 1/2 dependencies entirely. If discuss-phase yields a decision to add `fluent-ffmpeg`, a fresh slopcheck pass is required at that point.

## Architecture Patterns

### System Architecture Diagram

```
┌────────────────── Renderer (React + Zustand) ──────────────────┐
│                                                                  │
│  Analyser view              Convertir view                       │
│  ┌─────────────────┐        ┌────────────────────┐               │
│  │ Checkbox col +  │ ─sel─▶ │ Preset selector +  │               │
│  │ "Convertir N"   │        │ Lancer + progress  │               │
│  └────────┬────────┘        └─────────┬──────────┘               │
│           │                            │                          │
│           ▼  useScanStore.selectedPaths▼  useConversionStore      │
│                                                                   │
│  window.djUtils.conversion.{start,cancel,listResumable,resume,onEvent}
└─────────────────────────────┬─────────────────────────────────┘
                              │ contextBridge (sandboxed preload)
                              ▼
┌──────────────────── Main process ───────────────────────────────┐
│                                                                  │
│  IPC handlers (src/main/ipc/conversion.ts)                       │
│    - V5 input validation                                         │
│    - Folder allowlist gate (paths resolve under rootFolder)      │
│    - Lazy require('electron') pattern                            │
│         │                                                        │
│         ▼                                                        │
│  ConversionController (src/main/conversion/controller.ts)        │
│    - single-active invariant                                     │
│    - persist-then-forward batching                               │
│    - heartbeat tick every 5s                                     │
│    - terminal-event cleanup                                      │
│         │                          │                             │
│         ▼                          ▼                             │
│  conversionRepo            spawnConversionWorker(...)            │
│  (better-sqlite3)          {workerData: {convId, files,          │
│   - conversions             ffmpegPath, preset, outputDir,       │
│   - conversion_files        parallelism}}                        │
└─────────┬─────────────────────────────┬──────────────────────────┘
          │                              │
          │                              ▼
          │       ┌────── conversionWorker.ts (Node worker_threads) ────┐
          │       │                                                       │
          │       │  Pull-queue: N=min(cpus-1, 4) slot-runners            │
          │       │     ┌─slot 1─┐  ┌─slot 2─┐ ... ┌─slot N─┐             │
          │       │     │ ffmpeg │  │ ffmpeg │     │ ffmpeg │             │
          │       │     │ child  │  │ child  │     │ child  │             │
          │       │     └────────┘  └────────┘     └────────┘             │
          │       │           │                                            │
          │       │           ▼  stderr → time= parser → progress event   │
          │       │  batched 20/200ms → parentPort.postMessage            │
          │       └──────────────────┬───────────────────────────────────┘
          │                          │
          ◀──────────────────────────┘  ConversionEvent stream
          (persist-then-forward back through controller → renderer)
```

### Recommended Project Structure

```
src/
├── main/
│   ├── conversion/
│   │   ├── conversionRepo.ts          # conversions + conversion_files tables
│   │   ├── conversionRepo.test.ts
│   │   ├── controller.ts              # ConversionController (single-active + heartbeat)
│   │   ├── controller.test.ts
│   │   ├── presets.ts                 # PRESETS, presetToFfmpegArgs, presetSlug
│   │   ├── presets.test.ts
│   │   ├── ffmpegPath.ts              # resolveFfmpegPath() with asar.unpacked rewrite
│   │   └── ffmpegPath.test.ts
│   ├── workers/
│   │   ├── conversionWorker.ts        # worker entry (pure Node)
│   │   ├── conversionCore.ts          # pure helpers: parseTimeProgress, buildArgs, outputPath
│   │   └── conversionCore.test.ts
│   ├── ipc/
│   │   ├── conversion.ts              # handlers + registerConversionHandlers
│   │   └── conversion.test.ts
│   └── db/
│       └── connection.ts              # extend: initConversionSchema(db) + getConversionRepo()
├── shared/
│   └── ipc-types.ts                   # extend IpcChannels + DjUtilsApi.conversion
└── renderer/src/
    ├── store/
    │   └── useConversionStore.ts      # Zustand: status, fileProgress, errors, controls
    └── components/
        └── convertir/
            ├── ConvertirView.tsx       # toolbar + preset config + progress
            ├── PresetSelector.tsx      # 5 presets + Custom radio/dropdown
            ├── CustomPresetForm.tsx    # codec/bitrate/sample inline form
            ├── ConversionProgress.tsx  # per-file rows + global bar
            └── ResumeBanner.tsx        # "Reprendre la conversion de N fichiers ?"
```

### Pattern 1: Worker Internal ffmpeg Pool

**What:** Inside the worker, drain a pending-files queue across N parallel "slot-runners". Each runner spawns one ffmpeg child, awaits exit, then pulls the next file. Cancellation propagates via SIGTERM to all live children plus a `cancelled = true` flag that stops queue pulls.

**When to use:** Whenever a worker needs CPU-bound parallelism inside a single Node thread. The slot pattern is simpler than node:stream's `Transform` highWaterMark or third-party concurrency libs.

**Example:**

```typescript
// src/main/workers/conversionWorker.ts (sketch — pure Node, no electron)
import { parentPort, workerData } from 'node:worker_threads'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'
import { parseFfmpegTimeProgress, buildFfmpegArgs, computeOutputPath } from './conversionCore'

interface ConversionWorkerData {
  conversionId: string
  files: string[]              // pending file paths
  ffmpegPath: string
  preset: Preset               // codec, bitrate, sampleRate?, container
  outputDir: string
  parallelism: number
}

const data = workerData as ConversionWorkerData
const port = parentPort!
let cancelled = false
const live = new Set<ChildProcess>()

port.on('message', (m: unknown) => {
  if (m && typeof m === 'object' && (m as { type?: unknown }).type === 'cancel') {
    cancelled = true
    for (const child of live) {
      try { child.kill('SIGTERM') } catch { /* already exited */ }
    }
  }
})

async function convertOne(src: string): Promise<void> {
  if (cancelled) return
  const out = computeOutputPath(src, data.outputDir, data.preset)

  // Conflict policy — skip + log
  try {
    await fs.access(out)
    port.postMessage({
      type: 'fileDone',
      conversionId: data.conversionId,
      filePath: src,
      status: 'skipped',
      outputPath: out,
      errorMessage: 'output_exists'
    })
    return
  } catch { /* output does not exist — proceed */ }

  const args = buildFfmpegArgs(src, out, data.preset)
  const child = spawn(data.ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
  live.add(child)

  let durationSec: number | null = null
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => {
    // ffmpeg writes "Duration: HH:MM:SS.MS" once on stream open
    if (durationSec === null) {
      const m = chunk.match(/Duration:\s+(\d+):(\d+):(\d+\.\d+)/)
      if (m) durationSec = (+m[1] * 3600) + (+m[2] * 60) + parseFloat(m[3])
    }
    const t = parseFfmpegTimeProgress(chunk)
    if (t !== null && durationSec) {
      const percent = Math.min(100, Math.round((t / durationSec) * 100))
      // batched in real impl — sketch elides the buffer
      port.postMessage({
        type: 'progress',
        conversionId: data.conversionId,
        filePath: src,
        percent,
        phase: 'transcoding'
      })
    }
  })

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1))
  })
  live.delete(child)

  if (cancelled) {
    // best-effort cleanup of partial output
    await fs.unlink(out).catch(() => undefined)
    return  // do not emit fileDone for cancelled files; batch-level 'cancelled' covers it
  }

  if (exitCode === 0) {
    port.postMessage({
      type: 'fileDone', conversionId: data.conversionId,
      filePath: src, status: 'done', outputPath: out, errorMessage: null
    })
  } else {
    await fs.unlink(out).catch(() => undefined)  // clean partial on error
    port.postMessage({
      type: 'fileDone', conversionId: data.conversionId,
      filePath: src, status: 'error', outputPath: null,
      errorMessage: `ffmpeg exited with code ${exitCode}`
    })
  }
}

async function run(): Promise<void> {
  let idx = 0
  const next = (): string | null => (idx < data.files.length && !cancelled) ? data.files[idx++] : null

  async function slotRunner(): Promise<void> {
    while (true) {
      const f = next()
      if (f === null) return
      try {
        await convertOne(f)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        port.postMessage({
          type: 'fileDone', conversionId: data.conversionId,
          filePath: f, status: 'error', outputPath: null, errorMessage: message
        })
      }
    }
  }

  const slots = Array.from({ length: data.parallelism }, () => slotRunner())
  await Promise.all(slots)

  port.postMessage(
    cancelled
      ? { type: 'cancelled', conversionId: data.conversionId }
      : { type: 'done', conversionId: data.conversionId }
  )
}

void run()
```

`[CITED: Pattern derived from src/main/workers/scanWorker.ts + Node child_process docs]`

### Pattern 2: ffmpeg Binary Path Resolution (asar.unpacked rewrite)

**What:** `require('ffmpeg-static')` returns a string path. In dev it points to `node_modules/ffmpeg-static/ffmpeg`. In a packaged Electron app, electron-builder packs node_modules into `app.asar`, but ffmpeg can't execute from inside an asar archive. We unpack ffmpeg-static via `asarUnpack` in electron-builder.json5 and rewrite the path at runtime from `app.asar/...` to `app.asar.unpacked/...`.

**When to use:** At controller construction time (in main, where `app.isPackaged` is observable). The resolved path is passed into the worker via `workerData` so the worker stays pure-Node.

**Example:**

```typescript
// src/main/conversion/ffmpegPath.ts
import path from 'node:path'

/**
 * Resolve the ffmpeg-static binary path, rewriting the asar archive prefix
 * to its unpacked counterpart in production. electron-builder.json5 must
 * include `asarUnpack: ["**/node_modules/ffmpeg-static/**"]`.
 */
export function resolveFfmpegPath(opts: {
  rawPath: string             // = require('ffmpeg-static') as string
  isPackaged: boolean
}): string {
  if (!opts.isPackaged) return opts.rawPath
  return opts.rawPath.replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  )
}
```

`[CITED: alexandercleasby.dev/blog/use-ffmpeg-electron + electron-builder docs at electron.build/docs/contents]`

**electron-builder config (Phase 6 finalizes, but the runtime depends on this):**

```json5
{
  "asarUnpack": [
    "**/node_modules/ffmpeg-static/**"
  ]
}
```

### Pattern 3: Heartbeat + Crash Detection

**What:** Controller sets a `setInterval(5_000)` that writes `UPDATE conversions SET heartbeat_at = ? WHERE id = ?` while a batch is active. On app boot, the controller runs `findResumable()` which queries `WHERE status = 'running' AND heartbeat_at < (now - 30000)` and marks those rows `status = 'crashed'` in the same transaction that returns them.

**When to use:** Any long-running stateful job that needs to survive process death and resume. The same pattern can apply to Phase 4's tagger session resume.

**Example:**

```typescript
// inside ConversionController.start()
const heartbeatTimer = setInterval(() => {
  try { repo.bumpHeartbeat(conversionId, now()) }
  catch { /* race with terminal — ignore */ }
}, 5000)
// clear in clearActive(): clearInterval(heartbeatTimer)

// on boot, before any window is shown:
repo.markStaleAsCrashed({ thresholdMs: 30_000, now: now() })
// conversion:list-resumable then returns those + any pre-existing crashed rows
```

### Anti-Patterns to Avoid

- **Spawning ffmpeg from main process directly.** Would block the main event loop during stderr pumping. Spawn from inside the worker.
- **Using `fluent-ffmpeg`'s `.on('progress')` events as the source of truth.** It works but hides the parsing logic and complicates SIGTERM/cleanup. Direct stderr parsing is 20 lines and explicit.
- **Storing per-file `progress_percent` in SQLite.** Wastes writes (>10 per second per slot). Keep progress volatile in the renderer store; DB stores only terminal state.
- **Reading source tags with music-metadata then re-writing target tags with node-id3.** That's a tag-write pipeline (Phase 5 territory). For Phase 3, `-map_metadata 0` is one ffmpeg flag and is well-tested.
- **Letting the worker import `electron`.** Phase 2 locked this; worker must remain `node_modules/ffmpeg-static`-free at import time (path comes via `workerData`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Audio transcoding | Custom encoders | `ffmpeg-static` binary via spawn | 30+ years of edge cases (VBR headers, ID3 padding, FLAC seek tables) |
| Tag preservation across formats | Pre-read + post-write tag bridge | `ffmpeg -map_metadata 0 -id3v2_version 3` | ffmpeg's metadata-mapping table is the canonical Vorbis↔ID3v2↔MP4 atom translator `[CITED: wiki.multimedia.cx/index.php/FFmpeg_Metadata]` |
| asar path rewriting | Custom path detection | Simple `.replace('app.asar', 'app.asar.unpacked')` + electron-builder `asarUnpack` | Electron transparently redirects reads from app.asar.unpacked at the same logical path `[CITED: electron.build/docs/contents]` |
| ID3v2 frame writing for MP3 | node-id3 in Phase 3 | ffmpeg `-id3v2_version 3` | Defer node-id3 to Phase 5 (TAGS-01). Phase 3 only needs preservation, not deliberate writes. |
| Subprocess pool management | p-limit, async-pool, third-party queue libs | Hand-rolled slot-runner loop (10 LOC) | The pattern is simpler than the library API; fully testable; no dep churn |
| CSV/audio progress streaming | Hand-rolled batching | Carry forward Phase 2's BATCH_SIZE / BATCH_MS flush primitive | Already validated in 02-01 and 02-03 |

**Key insight:** Phase 3 is mostly orchestration of existing primitives. The only domain-specific code is the ffmpeg argv builder, the stderr `time=` parser, and the slot-runner loop — total ~150 LOC of new logic. Resist the urge to add fluent-ffmpeg, p-limit, or any other "helpful" wrapper.

## Common Pitfalls

### Pitfall 1: ffmpeg-static path is wrong in packaged builds

**What goes wrong:** `require('ffmpeg-static')` returns `/path/to/Resources/app.asar/node_modules/ffmpeg-static/ffmpeg`. Electron rejects execve on a path inside an asar archive. App silently fails on first conversion in production but works fine in dev.

**Why it happens:** electron-builder packs node_modules into app.asar by default; binaries can't execute from within the archive.

**How to avoid:** (1) electron-builder.json5: `asarUnpack: ["**/node_modules/ffmpeg-static/**"]`. (2) Runtime: rewrite path via `resolveFfmpegPath()` helper (Pattern 2). (3) Test by running `npm run build:unpack` and inspecting `out/...resources/app.asar.unpacked/node_modules/ffmpeg-static/`.

**Warning signs:** `ENOENT` on ffmpeg path in production; works in `npm run dev`; works in `electron-vite preview` (no asar). `[CITED: github.com/nklayman/vue-cli-plugin-electron-builder/issues/1504]`

### Pitfall 2: `libfdk_aac` not available in ffmpeg-static

**What goes wrong:** User picks AAC 256 preset, ffmpeg fails with `Unknown encoder 'libfdk_aac'`.

**Why it happens:** libfdk_aac is GPL-incompatible — pre-built ffmpeg distributions (including ffmpeg-static) ship only the native `aac` encoder. `[CITED: trac.ffmpeg.org/wiki/Encode/AAC]`

**How to avoid:** Use `-c:a aac -b:a 256k` (native encoder). It's the second-highest-quality AAC encoder available in ffmpeg and is acceptable for DJ use (DJs aren't audiophile-bitrate-comparing AAC). Document this in `presets.ts` as a comment.

**Warning signs:** `Unknown encoder` stderr on AAC preset launch. Verify ffmpeg-static encoder list at startup with `ffmpeg -encoders` if paranoid (one-time check, cache result).

### Pitfall 3: SIGTERM doesn't clean partial outputs

**What goes wrong:** User cancels mid-batch; ffmpeg writes a partial MP3 to disk; partial file accumulates and confuses the next batch's `output_exists` skip check.

**Why it happens:** SIGTERM is async; ffmpeg may have already flushed bytes to the output file before exit.

**How to avoid:** After `await child.on('exit', ...)`, if `cancelled || exitCode !== 0`, `fs.unlink(outputPath).catch(() => undefined)`. The catch is required because the partial may not exist (ffmpeg may have only written stderr).

**Warning signs:** Stale partial files in `converted/mp3-320/` after a cancelled batch. Add a unit test for the worker's `convertOne` that asserts unlink-on-error.

### Pitfall 4: stderr `time=` parsing breaks on chunked output

**What goes wrong:** ffmpeg emits `frame=4852 time=00:02:41.74 ...` as a single carriage-return-terminated line, but `data` events on a stream pipe arrive in arbitrary chunks. A regex on a chunk may miss `time=` because it spans two chunks.

**Why it happens:** Stream chunks are bytes, not lines. The `time=` token can be split across chunk boundaries.

**How to avoid:** Maintain a per-child `buffer` string; on every `data`, append to buffer, scan for last `time=` match, keep the trailing partial line in buffer. The last full `time=` match wins. (See `parseFfmpegTimeProgress` in conversionCore — keep it pure and unit-test it on multi-chunk inputs.)

**Warning signs:** Progress bar jumps in jagged steps or stalls at low percents while ffmpeg is clearly working.

### Pitfall 5: Worker `worker.terminate()` doesn't kill ffmpeg children

**What goes wrong:** Controller calls `worker.terminate()` on cancel; worker thread dies but its spawned ffmpeg children become orphans (re-parented to init / launchd).

**Why it happens:** `worker.terminate()` kills the Node thread; subprocess descriptors are not part of the worker's lifecycle from Node's perspective.

**How to avoid:** Cancel flow is **always**: (1) `worker.postMessage({ type: 'cancel' })` → worker iterates `live` Set and `child.kill('SIGTERM')` on each → worker awaits its slot-runners → worker posts `'cancelled'` event → controller calls `worker.terminate()` as a safety net. Never call `worker.terminate()` first.

**Warning signs:** `ps aux | grep ffmpeg` shows orphan ffmpeg processes after a cancel.

### Pitfall 6: Heartbeat threshold too tight for slow files

**What goes wrong:** A large FLAC → MP3 320 conversion takes 30+ seconds. Heartbeat threshold of 30s tags an in-progress batch as crashed.

**Why it happens:** Threshold ≤ slowest single-file conversion duration.

**How to avoid:** Heartbeat fires every **5s** from controller (not from worker, not per file). Threshold of **30s** therefore gives 6 missed heartbeats before crash detection — easily survives any single ffmpeg call. The worker doesn't need to "do" anything for heartbeat; controller bumps it via `setInterval` independent of worker progress events. ✓ This is safe by construction.

### Pitfall 7: MP4/M4A round-trip drops Rekordbox tags

**What goes wrong:** User converts M4A → M4A (remux) expecting tag preservation; output file is missing Genre/TKEY/TBPM.

**Why it happens:** ffmpeg's MP4 atom-to-atom metadata mapping is well-tested for iTunes-style atoms (©nam, ©ART, ©alb, ©gen, ©cmt, tmpo for BPM) but Rekordbox writes some keys to freeform `----:com.apple.iTunes:KEY` atoms which `-c:a copy -map_metadata 0` preserves but `-map_metadata 0` alone with a re-encode may drop. **For v1 scope:** M4A is an *input* format (read source). MP4 as a *target* preset is not in the 5 locked presets — all 5 targets are MP3/FLAC/WAV. Custom preset CAN target AAC but renderer's default container choice is `.aac` (ADTS), not `.m4a`. **Recommendation:** lock Custom container output to .aac (not .m4a) for v1; revisit in v2. Document in `presets.ts`.

**Warning signs:** Hypothetical — v1 doesn't ship M4A targets. Add an open question to the v2 backlog.

### Pitfall 8: Folder allowlist gate must accept file *paths*, not just folders

**What goes wrong:** Scan's gate validates `folder === settings.rootFolder`. Conversion's input is a list of file paths under that folder. A literal port of the gate rejects every conversion.

**Why it happens:** Scan accepts a single folder; conversion accepts a file list.

**How to avoid:** The conversion handler validates `every(filePath => path.resolve(filePath).startsWith(path.resolve(rootFolder) + path.sep))`. The output dir is composed in main from `rootFolder + preset.slug`, never renderer-supplied. `[CITED: src/main/ipc/scan.ts line 30-35 pattern]`

**Warning signs:** Path-traversal in renderer-supplied list (e.g., `../../etc/passwd`) reaching the worker. Add a unit test asserting rejection.

### Pitfall 9: Resume re-queues `running` files that are actually mid-flight

**What goes wrong:** App is alive but heartbeat is briefly stalled (GC pause, sleeping laptop). User opens a second window, sees "Resume?" prompt for the live batch.

**Why it happens:** Heartbeat threshold collides with the active batch's existence.

**How to avoid:** `findResumable()` runs **once on boot, before any window opens**. After boot, in-memory `activeConversionId` set is the source of truth. The resume prompt is a one-shot startup check, not a polling UI. Also: the controller is a single-instance singleton in main; there is no "second window" path in Electron 39 unless explicitly opened.

**Warning signs:** Resume banner appears mid-session. Add a guard: `useConversionStore.checkResumable()` only fires once on app mount.

## Runtime State Inventory

Not applicable — this is a greenfield phase that *adds* state (two new SQLite tables, new IPC channels). No existing runtime state being renamed or migrated.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — Phase 3 creates `conversions` + `conversion_files` from scratch | None |
| Live service config | None — no external services | None |
| OS-registered state | None | None |
| Secrets/env vars | None | None |
| Build artifacts | `out/main/workers/scanWorker.js` exists; **add** `out/main/workers/conversionWorker.js` via electron.vite.config.ts rollup input | Extend `electron.vite.config.ts` rollupOptions.input |

## Code Examples

Verified patterns from official sources and Phase 2 code:

### Example 1: IPC Channel Extension

```typescript
// src/shared/ipc-types.ts — additive extension
export const IpcChannels = {
  // ...existing scan + foundation channels...
  ConversionStart: 'conversion:start',
  ConversionCancel: 'conversion:cancel',
  ConversionListResumable: 'conversion:list-resumable',
  ConversionResume: 'conversion:resume',
  /** main → renderer push channel */
  ConversionEvent: 'conversion:event'
} as const

export interface Preset {
  slug: string                  // 'mp3-320', 'mp3-v0', 'aac-256', 'flac', 'wav', 'custom'
  label: string                 // user-facing French label
  codec: string                 // ffmpeg codec name (libmp3lame, aac, flac, pcm_s16le)
  bitrateKbps: number | null    // null for lossless
  vbrQuality: number | null     // null for CBR; 0-9 for libmp3lame -q:a
  sampleRate: number | null     // null = preserve source
  extension: string             // '.mp3', '.flac', '.wav', '.aac'
}

export type ConversionFileStatus = 'pending' | 'running' | 'done' | 'error' | 'skipped' | 'cancelled'

export type ConversionEvent =
  | { type: 'progress'; conversionId: string; filePath: string; percent: number; phase: 'transcoding' | 'finalizing' }
  | { type: 'fileDone'; conversionId: string; filePath: string; status: ConversionFileStatus; outputPath: string | null; errorMessage: string | null }
  | { type: 'done'; conversionId: string }
  | { type: 'cancelled'; conversionId: string }
  | { type: 'error'; conversionId: string; message: string }

export interface ResumableBatch {
  conversionId: string
  rootFolder: string
  preset: Preset
  outputDir: string
  pendingCount: number
  doneCount: number
  errorCount: number
  startedAt: number
}

export interface DjUtilsConversionApi {
  start(params: { rootFolder: string; filePaths: string[]; preset: Preset }): Promise<string>
  cancel(conversionId: string): Promise<void>
  listResumable(): Promise<ResumableBatch[]>
  resume(conversionId: string): Promise<void>
  onEvent(cb: (e: ConversionEvent) => void): () => void
}

export interface DjUtilsApi {
  // ...existing members...
  conversion: DjUtilsConversionApi
}
```

### Example 2: Preset → ffmpeg argv mapping (verified)

```typescript
// src/main/conversion/presets.ts
import type { Preset } from '../../shared/ipc-types'

export const PRESETS: ReadonlyArray<Preset> = [
  {
    slug: 'mp3-320',
    label: 'MP3 320 kbps (CBR)',
    codec: 'libmp3lame',
    bitrateKbps: 320,
    vbrQuality: null,
    sampleRate: null,
    extension: '.mp3'
  },
  {
    slug: 'mp3-v0',
    label: 'MP3 V0 (VBR ~245 kbps)',
    codec: 'libmp3lame',
    bitrateKbps: null,
    vbrQuality: 0,        // -q:a 0 → highest VBR quality, ~220-260 kbps
    sampleRate: null,
    extension: '.mp3'
  },
  {
    slug: 'aac-256',
    label: 'AAC 256 kbps',
    codec: 'aac',          // NOTE: native aac, not libfdk_aac (not in ffmpeg-static)
    bitrateKbps: 256,
    vbrQuality: null,
    sampleRate: null,
    extension: '.aac'
  },
  {
    slug: 'flac',
    label: 'FLAC (lossless)',
    codec: 'flac',
    bitrateKbps: null,
    vbrQuality: null,
    sampleRate: null,
    extension: '.flac'
  },
  {
    slug: 'wav',
    label: 'WAV 16-bit',
    codec: 'pcm_s16le',
    bitrateKbps: null,
    vbrQuality: null,
    sampleRate: null,
    extension: '.wav'
  }
]

/**
 * Build the ffmpeg argv for a given preset, source path, and output path.
 * Tag preservation flags are appended last for MP3 targets to lock id3v2.3.
 */
export function buildFfmpegArgs(src: string, out: string, preset: Preset): string[] {
  const args: string[] = ['-hide_banner', '-loglevel', 'error', '-stats', '-y', '-i', src]

  // Codec selection
  args.push('-c:a', preset.codec)

  // Bitrate vs VBR
  if (preset.bitrateKbps !== null) {
    args.push('-b:a', `${preset.bitrateKbps}k`)
  } else if (preset.vbrQuality !== null) {
    args.push('-q:a', String(preset.vbrQuality))
  }

  // Sample rate (preserve source if null)
  if (preset.sampleRate !== null) {
    args.push('-ar', String(preset.sampleRate))
  }

  // Tag preservation
  args.push('-map_metadata', '0')
  if (preset.extension === '.mp3') {
    args.push('-id3v2_version', '3')   // Rekordbox lock
  }

  args.push(out)
  return args
}
```

`[CITED: blog.thomasdamgaard.dk + ottverse.com — both confirm `-ab 320k -map_metadata 0 -id3v2_version 3` round-trips Vorbis↔ID3v2.3 cleanly for FLAC→MP3 320]`

### Example 3: ffmpeg stderr time parser (pure, unit-testable)

```typescript
// src/main/workers/conversionCore.ts
const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/g

/**
 * Pure: extract the LAST `time=HH:MM:SS.MS` from an ffmpeg stderr chunk and
 * return total seconds, or null if no match. Multiple matches in one chunk
 * are common — we want the most recent (rightmost) one.
 */
export function parseFfmpegTimeProgress(chunk: string): number | null {
  let match: RegExpExecArray | null
  let last: RegExpExecArray | null = null
  TIME_RE.lastIndex = 0
  while ((match = TIME_RE.exec(chunk)) !== null) {
    last = match
  }
  if (!last) return null
  return (+last[1] * 3600) + (+last[2] * 60) + parseFloat(last[3])
}

/**
 * Pure: compute the output path for a given source under a preset output dir.
 * Strips the source extension and replaces with preset.extension.
 */
export function computeOutputPath(srcPath: string, outputDir: string, preset: Preset): string {
  const path = require('node:path') as typeof import('node:path')
  const base = path.basename(srcPath, path.extname(srcPath))
  return path.join(outputDir, `${base}${preset.extension}`)
}
```

`[CITED: daily-blog.netlify.app/questions/2411495 + dev.to FFmpeg API NodeJS — regex pattern is the canonical ffmpeg stats line format since 2010]`

### Example 4: SQLite schema for conversions

```typescript
// src/main/conversion/conversionRepo.ts (schema excerpt)
export function initConversionSchema(db: Database.Database): void {
  db.exec(
    'CREATE TABLE IF NOT EXISTS conversions (' +
      'id TEXT PRIMARY KEY,' +
      'root_folder TEXT NOT NULL,' +
      'preset_json TEXT NOT NULL,' +
      'output_dir TEXT NOT NULL,' +
      "status TEXT NOT NULL CHECK(status IN ('running','done','cancelled','crashed'))," +
      'started_at INTEGER NOT NULL,' +
      'ended_at INTEGER,' +
      'heartbeat_at INTEGER NOT NULL' +
      ');' +
      'CREATE TABLE IF NOT EXISTS conversion_files (' +
      'conversion_id TEXT NOT NULL REFERENCES conversions(id) ON DELETE CASCADE,' +
      'file_path TEXT NOT NULL,' +
      "status TEXT NOT NULL CHECK(status IN ('pending','running','done','error','skipped','cancelled'))," +
      'error_message TEXT,' +
      'output_path TEXT,' +
      'PRIMARY KEY (conversion_id, file_path)' +
      ');' +
      'CREATE INDEX IF NOT EXISTS idx_conversion_files_conv ON conversion_files(conversion_id);'
  )
  db.pragma('foreign_keys = ON')
}
```

## Tag Preservation Matrix

Validated mappings (CONV-06). The `-map_metadata 0` flag maps the input container's metadata to the output container's native scheme. `-id3v2_version 3` locks ID3 version for Rekordbox compat.

| Source format | Target format | ffmpeg flags | Tags preserved (Rekordbox-relevant) | Confidence |
|---------------|---------------|--------------|--------------------------------------|------------|
| MP3 (ID3v2.3/v2.4) | MP3 320 CBR | `-c:a libmp3lame -b:a 320k -map_metadata 0 -id3v2_version 3` | TIT2, TPE1, TALB, TCON, TBPM, TKEY, COMM, APIC | HIGH `[CITED: blog.thomasdamgaard.dk]` |
| FLAC (Vorbis Comments) | MP3 320 CBR | same as above | TITLE→TIT2, ARTIST→TPE1, ALBUM→TALB, GENRE→TCON, BPM→TBPM, INITIALKEY→TKEY, COMMENT→COMM, picture→APIC | HIGH `[CITED: ottverse.com + cleverutils.com]` |
| M4A (iTunes atoms) | MP3 320 CBR | same as above | ©nam→TIT2, ©ART→TPE1, ©alb→TALB, ©gen→TCON, tmpo→TBPM, ©cmt→COMM. **TKEY**: M4A stores key in freeform atom — mapping is fragile, may need fallback. | MEDIUM `[CITED: wiki.multimedia.cx/index.php/FFmpeg_Metadata]` |
| WAV (limited tag support) | MP3 320 CBR | same as above | Mostly TITLE/ARTIST via INFO chunk if present | LOW (WAV has minimal tag support — most DJs don't tag WAV) |
| MP3 → FLAC | `-c:a flac -map_metadata 0` (no id3v2 flag) | TIT2→TITLE, TPE1→ARTIST, etc. | HIGH |
| MP3 → WAV | `-c:a pcm_s16le -map_metadata 0` (no id3v2 flag) | INFO chunk gets limited subset; expect loss | LOW (acceptable — DJs don't expect WAV to carry tags) |

**Verification approach for tests:** Use existing fixtures (`scanCore.test.ts` already has `tagged.mp3`, `sample.flac`). Add `tagged.m4a` fixture. Round-trip test: convert fixture → read output tags with `music-metadata` → assert each Rekordbox field matches source.

**Recommendation:** Phase 3 plan includes a `tag-roundtrip.test.ts` integration suite covering the three HIGH-confidence rows in the matrix (MP3→MP3, FLAC→MP3, M4A→MP3 — with M4A skipping TKEY assertion or flagging as expected-loss).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `child_process.exec` for ffmpeg | `spawn()` with stdio pipe | Always — exec buffers output to memory | exec breaks on long ffmpeg runs; spawn streams stderr |
| Polling job status from worker | postMessage event stream | Phase 2 locked this | Real-time progress; no polling overhead |
| fluent-ffmpeg `.run()` | direct spawn() with own pool | Phase 3 decision | More explicit cancel/cleanup; one fewer dep |
| `app.asar` for native binaries | `asarUnpack` + path rewrite | Electron 8+ | Required since Electron started using asar by default |

**Deprecated/outdated:**
- `child_process.exec` for any long-running ffmpeg — replaced by `spawn`
- ID3v2.4 for Rekordbox compat — Rekordbox reads v2.3 reliably; v2.4 has edge cases. Phase 5 locks v2.3 too.
- libfdk_aac on pre-built ffmpeg — not available; native `aac` encoder is the default for ffmpeg-static distributions

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `ffmpeg-static` v5.3.0 binary on Mac arm64 / Mac x64 / Win x64 includes the `flac`, `pcm_s16le`, `libmp3lame`, and native `aac` encoders | Standard Stack + Pitfall 2 | One or more presets will throw "Unknown encoder" on launch. **Mitigation:** Wave 0 task adds a startup check that runs `ffmpeg -encoders` once and caches the list; preset selector greys out unsupported presets. Empirically, ffmpeg-static has shipped these encoders for years. |
| A2 | M4A→MP3 via `-map_metadata 0` preserves Rekordbox-written TKEY freeform atom | Tag Preservation Matrix row 3 | Users converting M4A files (e.g., from Beatport AAC) lose key info. **Mitigation:** Plan includes a fixture-based round-trip test. If TKEY drops, downstream resolution = log a `tag_lost: ['TKEY']` warning per-file (non-fatal). |
| A3 | 30s heartbeat threshold is comfortable for any single ffmpeg call on a multi-thousand-file library | Decision (CONTEXT) + Pitfall 6 | A pathological 8-minute FLAC at 192kHz could exceed 30s on a slow CPU — but heartbeat fires every 5s independent of ffmpeg's progress, so this is safe by construction. ✓ Verified safe. |
| A4 | `worker.terminate()` after the worker has emitted `'cancelled'` is a no-op safety net (worker is already shutting down) | Pitfall 5 | If terminate races with child cleanup, orphan ffmpeg processes leak. Mitigation: explicit `await Promise.all(slots)` before posting 'cancelled' ensures children have exited. |
| A5 | The Convertir view UI fits within Phase 3 PLAN scope (no separate `/gsd-ui-phase` needed) | Open Question 11 (below) | If scope explodes, planner can split into 03-01 (backbone) + 03-02 (UI) + 03-03 (resume) as a 3-plan phase. Recommendation: planner makes this call at plan time. |
| A6 | The `child_process` calls inside `worker_threads` are not subject to any Electron 39 limitation | Open Question 3 | Electron's `utilityProcess` is for renderer-spawned processes; main-process worker_threads can freely spawn child_process. No documented Electron 39 conflict. Confidence: HIGH based on Node docs + ecosystem use (Discord, VS Code do this). |

**Discuss-phase should confirm A1, A2, A5 explicitly with the user before plan-phase locks them.**

## Open Questions

1. **UI scope (Open Question 11 from CONTEXT)** — Convertir view design.
   - What we know: UI-SPEC.md does not exist for the Convertir view. Editorial dark-studio tokens are locked, the toolbar pattern from Analyser is reusable.
   - What's unclear: Is the planner expected to produce a UI sketch in the PLAN or branch to `/gsd-ui-phase`?
   - **Recommendation: include UI in PLAN.md.** Convertir is a single view with 3 sub-components (PresetSelector, ConversionProgress, ResumeBanner) — far less complex than Analyser's VirtualizedFileTable, which was specced inline in 02-02. Pattern-match the depth: brief layout description, reuse existing tokens, no new design primitives needed. `ui_phase: true` config exists, but invoking it for ~3 components is overkill.

2. **AAC preset container choice** — `.aac` (ADTS raw) vs `.m4a` (MP4 container).
   - What we know: Locked preset list says "AAC 256". Default extension `.aac` is implied by Pitfall 7's analysis.
   - What's unclear: User expectation. DJs may expect `.m4a` because that's what they buy from Beatport.
   - Recommendation: Lock `.aac` for v1, document in preset label as "AAC 256 (ADTS)" so it's explicit. Plan-phase or discuss-phase can override.

3. **Custom preset persistence shape** — JSON-serialized in `settings.conversion.lastPreset`?
   - What we know: CONTEXT says "JSON-serialized" under that key.
   - What's unclear: One slot or per-preset (e.g., remember last custom AND last picked preset)?
   - Recommendation: One slot holding the full `Preset` object. Simpler; matches "last selected" semantics.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| ffmpeg-static binary | All conversions | ✓ (bundled npm package) | 5.3.0 | — (no fallback; this is the only conversion path) |
| Node `worker_threads` | conversionWorker.ts | ✓ (Node 20+ via Electron 39) | builtin | — |
| Node `child_process` | ffmpeg pool inside worker | ✓ | builtin | — |
| better-sqlite3 | Persistence | ✓ (already wired) | 12.10.0 | — |
| electron-builder `asarUnpack` | Production binary path | ✓ (^26.0.12 in devDeps) | 26.0.12 | — (Phase 6 finalizes config) |
| `music-metadata` | Source tag UI labels | ✓ (already in deps) | 11.12.3 | Skip the UI label if read fails (graceful degrade) |
| Existing audio fixtures (`tagged.mp3`, `sample.flac`) | Tag round-trip tests | ✓ | n/a | — |
| `tagged.m4a` fixture | M4A→MP3 round-trip test | ✗ | — | Wave 0 task: generate via `ffmpeg -i tagged.mp3 -c:a aac -b:a 256k tagged.m4a` then add Rekordbox-style tags via ffmpeg `-metadata` flags |

**Missing dependencies with no fallback:** None.
**Missing dependencies with fallback:** `tagged.m4a` fixture — generate in a Wave 0 task; PLAN should include this.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.7 (already configured) `[VERIFIED: package.json]` |
| Config file | `vitest.setup.ts` (already exists; vitest config inline via package.json scripts) |
| Quick run command | `npx vitest run src/main/conversion src/main/workers/conversionCore src/main/ipc/conversion` |
| Full suite command | `npm test -- --run` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CONV-01 | Selection → batch start | unit | `npx vitest run src/main/ipc/conversion -t "ConversionStart"` | ❌ Wave 0 |
| CONV-01 | Allowlist gate rejects path traversal | unit | `npx vitest run src/main/ipc/conversion -t "allowlist"` | ❌ Wave 0 |
| CONV-01 | Renderer: useConversionStore.startBatch | unit | `npx vitest run src/renderer/src/store/useConversionStore` | ❌ Wave 0 |
| CONV-02 | Preset → ffmpeg argv mapping | unit | `npx vitest run src/main/conversion/presets` | ❌ Wave 0 |
| CONV-02 | Custom preset persistence in settings | unit | `npx vitest run src/main/conversion/presets -t "custom persistence"` | ❌ Wave 0 |
| CONV-03 | parseFfmpegTimeProgress regex on real ffmpeg stderr | unit | `npx vitest run src/main/workers/conversionCore -t "parseFfmpegTimeProgress"` | ❌ Wave 0 |
| CONV-03 | Per-file + global progress events emit batched | unit | `npx vitest run src/main/conversion/controller -t "progress batching"` | ❌ Wave 0 |
| CONV-04 | One file fails → others continue | integration | `npx vitest run src/main/conversion/controller -t "error does not abort"` | ❌ Wave 0 |
| CONV-04 | Error row persisted to conversion_files | unit | `npx vitest run src/main/conversion/conversionRepo -t "error row"` | ❌ Wave 0 |
| CONV-04 | output_exists conflict → skipped row | unit | `npx vitest run src/main/workers/conversionCore -t "conflict skip"` | ❌ Wave 0 |
| CONV-05 | Heartbeat update + crash detection threshold | unit | `npx vitest run src/main/conversion/conversionRepo -t "heartbeat"` | ❌ Wave 0 |
| CONV-05 | findResumable returns crashed batches | unit | `npx vitest run src/main/conversion/conversionRepo -t "findResumable"` | ❌ Wave 0 |
| CONV-05 | Resume re-queues only pending/running/error files | integration | `npx vitest run src/main/conversion/controller -t "resume"` | ❌ Wave 0 |
| CONV-06 | Tag round-trip MP3→MP3 320 | integration | `npx vitest run src/main/conversion/tagRoundtrip -t "MP3 to MP3"` | ❌ Wave 0 |
| CONV-06 | Tag round-trip FLAC→MP3 320 | integration | `npx vitest run src/main/conversion/tagRoundtrip -t "FLAC to MP3"` | ❌ Wave 0 |
| CONV-06 | Tag round-trip M4A→MP3 320 (TKEY may be expected-loss) | integration | `npx vitest run src/main/conversion/tagRoundtrip -t "M4A to MP3"` | ❌ Wave 0 |
| Smoke | Cancel SIGTERMs all live children, unlinks partials | integration | `npx vitest run src/main/conversion/controller -t "cancel cleanup"` | ❌ Wave 0 |
| Smoke | resolveFfmpegPath rewrites app.asar in packaged | unit | `npx vitest run src/main/conversion/ffmpegPath` | ❌ Wave 0 |
| Manual | Full end-to-end packaged-build conversion of 20 mixed files | manual | `npm run build:unpack` + manual launch + Convertir 20 files + inspect output dir | checkpoint:human-verify |

### Sampling Rate

- **Per task commit:** Run the suite touched by that task (e.g., `npx vitest run src/main/conversion/presets` after a preset change).
- **Per wave merge:** `npx vitest run src/main/conversion src/main/workers/conversionCore src/main/ipc/conversion src/renderer/src/store/useConversionStore`
- **Phase gate:** Full suite green before `/gsd-verify-work`: `npm test -- --run` AND `npm run build`

### Wave 0 Gaps

- [ ] `src/main/workers/conversionCore.ts` + `.test.ts` — pure helpers (parseFfmpegTimeProgress, computeOutputPath, buildFfmpegArgs)
- [ ] `src/main/conversion/presets.ts` + `.test.ts` — PRESETS const + helpers
- [ ] `src/main/conversion/conversionRepo.ts` + `.test.ts` — repo factory + initSchema
- [ ] `src/main/conversion/controller.ts` + `.test.ts` — ConversionController with injected deps
- [ ] `src/main/conversion/ffmpegPath.ts` + `.test.ts` — resolveFfmpegPath helper
- [ ] `src/main/workers/conversionWorker.ts` — worker entry (test indirectly via controller)
- [ ] `src/main/ipc/conversion.ts` + `.test.ts` — handlers
- [ ] `src/main/workers/__fixtures__/tagged.m4a` — generated via ffmpeg from existing MP3
- [ ] `src/main/conversion/tagRoundtrip.test.ts` — integration test using ffmpeg-static + music-metadata
- [ ] `src/renderer/src/store/useConversionStore.ts` + `.test.ts` — Zustand store
- [ ] `src/renderer/src/components/convertir/*.tsx` — view components
- [ ] `electron.vite.config.ts` — add `workers/conversionWorker` rollup input
- [ ] `electron-builder.json5` (if exists) — add `asarUnpack: ["**/node_modules/ffmpeg-static/**"]` (Phase 6 may finalize)

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | n/a — local app, no users |
| V3 Session Management | no | n/a |
| V4 Access Control | yes | Folder allowlist gate — file paths AND output dir must resolve under `settings.rootFolder` (Threat T-2-01 carry-forward) |
| V5 Input Validation | yes | V5 input type-checking (typeof guards) on every IPC handler argument, mirror of scan.ts; preset shape validated against allowed codecs |
| V6 Cryptography | no | n/a — no secrets, no crypto |
| V12 Files & Resources | yes | File path traversal prevention (Pitfall 8); SIGTERM cleanup of partial outputs (Pitfall 3) |
| V14 Configuration | yes | ffmpeg binary path is resolved server-side only (renderer never names the binary path) |

### Known Threat Patterns for Electron 39 + Node `child_process`

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Renderer-supplied path escapes rootFolder (T-2-01 carry) | Tampering / Information disclosure | Allowlist gate: `every(p => path.resolve(p).startsWith(path.resolve(rootFolder) + sep))` |
| Renderer-supplied ffmpeg binary path | Elevation of Privilege | ffmpeg path is **never** accepted from renderer — resolved server-side via `require('ffmpeg-static')` + asar rewrite |
| Command injection via filename containing shell metacharacters | Tampering | `child_process.spawn(cmd, [args])` passes argv as array — no shell interpretation. Never use `spawn` with `shell: true`. |
| Path traversal via output dir | Tampering | Output dir is composed in main from `rootFolder + presetSlug` — never renderer-supplied |
| Worker exit leaks ffmpeg children | DoS (resource leak) | Cancel flow: postMessage('cancel') → worker SIGTERMs children → worker awaits → controller terminates worker as safety net |
| Heartbeat race confuses live batch with crashed | DoS (false positive resume) | `findResumable()` runs once on boot before any window opens — not during active session |
| Path traversal in preset slug | Tampering | Preset slugs are constants from PRESETS array — never renderer-supplied raw string. Custom slug = literal `'custom'`. |

## Sources

### Primary (HIGH confidence)

- Project codebase — `src/main/scan/controller.ts`, `src/main/workers/scanWorker.ts`, `src/main/scan/scanRepo.ts`, `src/main/ipc/scan.ts`, `src/shared/ipc-types.ts`, `electron.vite.config.ts`, `package.json` — the architectural template Phase 3 mirrors
- Phase 2 plan summaries (02-01-SUMMARY.md, 02-03-SUMMARY.md) — pattern provenance
- CONTEXT.md `<decisions>` block — locked decisions
- [ffmpeg wiki: Encode/AAC](https://trac.ffmpeg.org/wiki/Encode/AAC) — libfdk_aac unavailability and native aac as default
- [FFmpeg Metadata wiki](https://wiki.multimedia.cx/index.php/FFmpeg_Metadata) — metadata mapping table across containers

### Secondary (MEDIUM confidence)

- [Thomas Damgaard: Convert FLAC to MP3 with ffmpeg retaining metadata](https://blog.thomasdamgaard.dk/posts/2022/06/30/convert-flac-to-mp3-with-ffmpeg-keeping-all-metadata/) — `-ab 320k -map_metadata 0 -id3v2_version 3` confirmed for FLAC→MP3
- [OTTVerse: Convert FLAC to MP3 with FFmpeg With Metadata](https://ottverse.com/convert-flac-to-mp3-with-ffmpeg-with-metadata/) — same flags, secondary confirmation
- [CleverUtils: MP3 ID3 Tags Preservation](https://cleverutils.com/flac-to-mp3/metadata-and-tags) — tag mapping table for Vorbis→ID3v2
- [Alexander Cleasby: Include FFMPEG Binaries in your Electron App](https://alexandercleasby.dev/blog/use-ffmpeg-electron) — asar.unpacked rewrite pattern
- [electron-builder docs: Application Contents](https://www.electron.build/docs/contents/) — asarUnpack semantics
- [GitHub issue: ffmpeg-static path with vue-cli-plugin-electron-builder](https://github.com/nklayman/vue-cli-plugin-electron-builder/issues/1504) — production path issue case study

### Tertiary (LOW confidence — verified against primary where possible)

- [daily-blog.netlify.app: How to parse FFMpeg output in NodeJS](https://daily-blog.netlify.app/questions/2411495/index.html) — stderr parsing pattern; cross-verified against the time= format in ffmpeg source
- [dev.to: FFmpeg API with Node.js](https://dev.to/renderio/ffmpeg-api-with-nodejs-video-processing-in-10-lines-3jjo) — basic spawn pattern

## Metadata

**Confidence breakdown:**

- Standard stack: **HIGH** — every package already in `package.json`, used in Phase 1/2
- Architecture: **HIGH** — direct mirror of Phase 2 scanning, no new structural concepts beyond the slot-runner pool
- Pitfalls: **HIGH** — pitfalls 1-6 are documented in cited sources; pitfall 7 (M4A) flagged as MEDIUM because TKEY freeform atom round-trip is the weakest claim
- Tag preservation matrix: **HIGH** for MP3/FLAC sources (cited); **MEDIUM** for M4A (assumption A2 covers it)
- UI scope: **MEDIUM** — recommendation made (inline in PLAN), planner has discretion

**Research date:** 2026-06-03
**Valid until:** 2026-07-03 (30 days — stack is stable; ffmpeg API doesn't change)
