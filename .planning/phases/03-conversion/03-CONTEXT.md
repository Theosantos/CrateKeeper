# Phase 3 — FFmpeg Conversion Pipeline — Context

**Date:** 2026-06-02
**Phase:** 03-conversion
**Mode:** mvp
**Depends on:** Phase 2 (Scanning)
**Requirements:** CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06

---

<domain>

**What this phase delivers:**
The user can select files from a completed scan in the Analyser, configure a target format (preset or custom), and run a batch conversion with ffmpeg. The Convertir view shows per-file + global progress, errors are surfaced per-file without aborting the batch, original ID3/MP4 tags are preserved, and if the app is interrupted the user is prompted to resume on next launch.

The phase delivers a working end-to-end vertical slice: file selection → conversion config → batched ffmpeg execution in a worker → DB-backed progress → renderer UI. It does NOT include tag editing (Phase 5), Tagger queue (Phase 4), or distribution packaging (Phase 6).

</domain>

<canonical_refs>

Downstream agents (researcher, planner, executor) MUST read these:

- `.planning/PROJECT.md` — Tech stack lock (ffmpeg-static, fluent-ffmpeg, Worker Threads, Electron), constraints.
- `.planning/REQUIREMENTS.md` — CONV-01 through CONV-06 verbatim.
- `.planning/ROADMAP.md` — Phase 3 success criteria.
- `.planning/STATE.md` — Phase 1/2 decisions accumulator.
- `.planning/phases/02-scanning/02-01-SUMMARY.md` — IPC bridge, scanRepo, ScanController, scanWorker patterns to mirror.
- `.planning/phases/02-scanning/02-03-SUMMARY.md` — streamCsv pattern (constant-memory iteration) reusable for export-style flows.
- `src/main/ipc/scan.ts` — Typed IPC handler pattern (folder-allowlist gate, lazy `require('electron')`, makeRendererSender).
- `src/main/scan/controller.ts` — Single-active worker lifecycle, persist-then-forward ordering, terminal-event cleanup.
- `src/main/workers/scanWorker.ts` — Worker entry shape, batched buffer flush (BATCH_SIZE=50 / BATCH_MS=200), cancel signal handling.
- `src/main/scan/scanRepo.ts` — Repo factory pattern + `iterateFiles(scanId)` cursor.
- `src/shared/ipc-types.ts` — `IpcChannels` enum + `DjUtilsApi` bridge shape to extend with `conversion.*`.
- `./CLAUDE.md` — Project coding conventions.

</canonical_refs>

<code_context>

**Reusable from Phase 2 (do not rebuild):**

| Asset | Path | How Phase 3 reuses it |
|-------|------|------------------------|
| IPC namespace pattern | `src/main/ipc/scan.ts` | Mirror as `src/main/ipc/conversion.ts` with `conversion:start`, `conversion:cancel`, `conversion:list-resumable`, `conversion:resume` |
| Bridge shape | `src/shared/ipc-types.ts` | Extend `DjUtilsApi` with `conversion` namespace; add channels to `IpcChannels` |
| Controller pattern | `src/main/scan/controller.ts` | New `ConversionController` — single-active batch, persist-then-forward, ConversionWorker lifecycle |
| Worker pattern | `src/main/workers/scanWorker.ts` | New `conversionWorker.ts` — adaptive parallel ffmpeg execution, batched progress events |
| Repo factory | `src/main/scan/scanRepo.ts` | New `conversionRepo.ts` — `conversions` + `conversion_files` tables, `iterateConversions()`, `findResumable()` |
| Renderer store | `src/renderer/src/store/useScanStore.ts` | New `useConversionStore.ts` — same Zustand shape (status, progress array, error array, controls) |
| Virtualized table | `src/renderer/src/components/analyser/VirtualizedFileTable.tsx` | Add checkbox column; extract reusable selection logic if needed |
| Toolbar | `src/renderer/src/components/analyser/ScanToolbar.tsx` | Add "Convertir N fichiers" button (visible when N>0) that switches to Convertir view |
| ffmpeg binary | `node_modules/ffmpeg-static` (already a dep) | Path resolution via `require('ffmpeg-static')` — handle `app.asar` → `app.asar.unpacked` rewrite in production |

</code_context>

<decisions>

### Concurrency model

- **Batch-level: single-active.** Only one conversion batch runs at a time (mirror of scanning). Starting a new batch while one is active rejects with `BatchAlreadyActive`.
- **Intra-batch: adaptive parallel ffmpeg.** Up to `min(os.cpus().length - 1, 4)` ffmpeg processes in parallel within a batch. Saturates CPU on multicore machines while keeping a hard cap so non-tech users can't melt their laptop.
- Each ffmpeg process is a child_process spawned by the conversion worker; the worker manages its own pool (no electron `utility-process`).

### File selection + trigger UX

- **Selection lives in Analyser.** Add a checkbox column to `VirtualizedFileTable` (leftmost, ~32px). Header checkbox = select-all-in-current-scan.
- **Toolbar trigger.** When N>0 files selected, `ScanToolbar` shows a primary action button `Convertir N fichiers`. Clicking it switches the renderer view to Convertir with the selection pre-loaded into `useConversionStore`.
- **Convertir view** = config panel (format/preset/output) + Lancer button + live progress UI. No re-selection of files in Convertir (user goes back to Analyser to re-pick).
- Selection state lives in `useScanStore` (per-scan), persists across view switches but resets on new scan.

### Format / bitrate config

- **Presets (5):** MP3 320 CBR, MP3 V0 VBR, AAC 256, FLAC, WAV.
- **Custom option:** dropdown `Custom...` opens an inline form: codec select (`libmp3lame`, `aac`, `flac`, `pcm_s16le`, `libopus`), bitrate input (kbps, ignored for FLAC/WAV), sample rate (default: preserve source).
- **Default:** MP3 320 CBR.
- **Persistence:** the user's last-selected preset/custom is stored in the existing `settings` key-value table under key `conversion.lastPreset` (JSON-serialized). Each batch can override before launch — override is volatile, persistence updates on Lancer.
- **Validation:** if input format equals target format AND bitrate matches, warn user with a confirm dialog (`Convertir vers le même format ?`); allow proceed (use case: stripping/normalizing metadata).

### Output location + conflict policy

- **Output dir:** `{rootFolder}/converted/{preset-slug}/` — created on first batch with that preset (e.g. `converted/mp3-320/`, `converted/flac/`). Keeps source library untouched, separates outputs by preset for quick browsing.
- **Conflict policy: skip + log.** If `{outputDir}/{originalBasename}.{newExt}` already exists, the file is skipped and recorded in the batch's error rows with reason `output_exists`. CONV-04 surfaces it in the per-file error list.
- **Rationale:** auto-resume becomes trivial — re-running a batch on the same files naturally skips already-completed outputs.
- **Folder allowlist gate:** the conversion handler enforces `outputDir` resolves under `settings.rootFolder` (same gate as scanning, mirror of Threat T-2-01 mitigation).

### Resume after interruption (CONV-05)

- **Persistence:** new SQLite tables (managed via repo factory + `initConversionSchema`):
  - `conversions(id TEXT PRIMARY KEY, root_folder TEXT, preset_json TEXT, output_dir TEXT, status TEXT, started_at INTEGER, ended_at INTEGER NULLABLE)` — status ∈ `running | done | cancelled | crashed`.
  - `conversion_files(conversion_id TEXT, file_path TEXT, status TEXT, error_message TEXT NULLABLE, output_path TEXT NULLABLE, PRIMARY KEY(conversion_id, file_path))` — status ∈ `pending | running | done | error | skipped`.
- **Heartbeat / crash detection:** every N seconds the controller bumps `conversions.heartbeat_at`. On app boot, the controller queries `findResumable()` = any `conversions` row with `status='running'` AND `heartbeat_at` older than 30s → mark as `crashed` in-place.
- **Auto-detect + prompt UX:** on mount, `useConversionStore` calls `conversion.list-resumable`. If ≥1 crashed batch returned, the Convertir toolbar shows a banner `Reprendre la conversion de N fichiers ?` with `Reprendre` / `Ignorer (supprimer)` buttons.
- **Resume mechanics:** `conversion:resume` re-spawns the controller with the existing `conversion_id`, the worker re-queues only files where `status IN ('pending', 'running', 'error')`. Already-`done` files skipped. Already-existing output files skipped via the conflict policy above (defense in depth).
- **Cancel semantics:** user clicks Stop → controller marks pending files `cancelled` (not `pending`), batch status → `cancelled`. Cancelled batches are NOT resumable. Crashed batches ARE resumable.

### Tag preservation (CONV-06)

- ffmpeg flags: `-map_metadata 0 -id3v2_version 3` (when target supports ID3v2.3) or `-map_metadata 0` (for FLAC/WAV/MP4 family).
- For MP3 target: enforce `-id3v2_version 3` — Rekordbox-compat lock from PROJECT.md / Phase 5 carry-forward.
- Pre-flight: read source tags via `music-metadata` (already a dep) for the progress UI label only — actual preservation happens via ffmpeg flags, not pre-read/post-write (Phase 5's job).
- Researcher: validate that `-map_metadata 0 -id3v2_version 3` round-trips Genre / BPM / Key / Comment intact across MP3 → MP3 320 and FLAC → MP3 320 on the sample fixtures.

### Error semantics (CONV-04)

- Error row shape (per `conversion_files`):
  - `file_path` (source)
  - `error_message` (one-line, French, user-readable: "ffmpeg exited with code 1", "Le fichier de sortie existe déjà", "Format non supporté", etc.)
  - `status='error'` (or `'skipped'` for `output_exists`)
- Errors do NOT abort the batch. The batch transitions to `done` once every file is in a terminal state (`done | error | skipped | cancelled`).
- A batch with ≥1 error still surfaces the per-file list in the renderer; renderer shows a summary `N converti, M en erreur, K ignorés`.

### Worker buffering

- Mirror scan worker: BATCH_SIZE=20 progress events, BATCH_MS=200ms. Conversion is slower than metadata parse so fewer per-batch events are needed, but the same flush primitive applies.
- Each progress event = `{ conversionId, filePath, percent, phase: 'transcoding' | 'finalizing', status }`.
- Per-file completion events are flushed immediately (no batching) so the UI feels responsive.

### Carry-forward decisions (from Phases 1-2)

These are LOCKED — downstream agents must follow them without re-asking:

- **Sandboxed preload** — `src/preload/index.ts` may not require non-shared modules. Conversion bridge follows the same export pattern as `scan`.
- **Folder allowlist gate** — every conversion IPC handler validates source paths and output dir resolve under `settings.rootFolder`.
- **Single source of truth for IPC names** — extend `IpcChannels` in `src/shared/ipc-types.ts`; never hardcode strings.
- **Repo factory + lazy singleton** — mirror `connection.ts` getter pattern.
- **AUDIO_EXTS lock** — conversion input must be in the 9 supported extensions from Phase 2 (`scanCore.AUDIO_EXTS`). Other extensions are filtered out before reaching the worker.
- **ID3v2.3 enforcement** — when target is MP3, always `-id3v2_version 3`.
- **asarUnpack for native bins** — `ffmpeg-static` binary path must be rewritten from `app.asar/...` to `app.asar.unpacked/...` at runtime (electron-builder config — finalize in Phase 6, but runtime helper in Phase 3 is fine).
- **Editorial dark-studio design tokens** — Convertir view inherits the existing `:root` token system from `src/renderer/src/assets/main.css`. No new color/spacing tokens unless gap identified.
- **Worker = pure Node, no Electron import** — `conversionWorker.ts` may not import `electron`; only `child_process`, `path`, `fs`, `worker_threads`.

</decisions>

<deferred>

Captured during discussion but explicitly OUT of Phase 3 scope. Surface in roadmap backlog when phase 3 ships.

- **Multi-batch parallelism** — running multiple independent batches concurrently. Single-active for v1.
- **Per-batch output dir override** — currently `{rootFolder}/converted/{preset-slug}/` is implicit. A future "Export ailleurs..." option could expose `showSaveDialog`.
- **Conflict resolution UI** — current policy is auto-skip. A future enhancement could prompt overwrite/rename per-conflict.
- **Drag-and-drop conversion from outside the scanned library** — out of scope; everything goes through Analyser → selection.
- **Conversion presets editor UI** — users editing the preset list (add/remove/rename). v1 presets are hardcoded; custom covers escape-hatch.
- **Bitrate validation against codec** — friendlier client-side input validation in the Custom form. ffmpeg will reject invalid combos in v1.
- **GPU acceleration / hardware encoders** — ffmpeg software encoders only for v1.

</deferred>

<open_questions_for_research>

Things the researcher should investigate and lock before plans are written:

1. **ffmpeg-static path in production** — confirm the exact `app.asar.unpacked` rewrite formula for both Mac and Windows under electron-builder. Phase 6 finalizes distribution but Phase 3 needs the runtime helper now.
2. **Tag round-trip validation** — write a test fixture pass: MP3 → MP3 320 with all Rekordbox tags (Genre/TKEY/TBPM/COMM/TIT2/TPE1/TALB) and confirm bit-identical via `music-metadata`. Then FLAC → MP3 320 confirming tag map.
3. **child_process pool inside worker_threads** — confirm there is no electron-builder / asar conflict when a worker_threads child spawns ffmpeg child_process. Some Electron versions have had issues with nested process trees.
4. **Heartbeat / crash detection threshold** — confirm 30s is a sane default given that a single large FLAC → MP3 320 can take ~10s; heartbeat should fire ≥3x per file lifetime.
5. **MP4 / M4A tag preservation via remux** — for M4A inputs, confirm `-c:a copy -map_metadata 0` actually round-trips Rekordbox-relevant tags. If not, document the limitation and either skip M4A→M4A in v1 or apply transcode.
6. **Cancel propagation** — confirm `process.kill('SIGTERM')` on ffmpeg children produces a clean partial-output cleanup (no zombie files in `converted/`); add `fs.unlink` of partials in the cancel path if needed.

</open_questions_for_research>

---

## Summary of decisions captured

| Area | Decision |
|------|----------|
| Selection UX | Checkbox column in Analyser table; toolbar "Convertir N fichiers" switches view |
| Format config | 5 presets (MP3 320, MP3 V0, AAC 256, FLAC, WAV) + Custom; persisted in settings; volatile override per-batch |
| Default format | MP3 320 CBR |
| Output dir | `{rootFolder}/converted/{preset-slug}/` |
| Conflict policy | Skip + log as error |
| Concurrency (batch) | Single-active (one batch at a time) |
| Concurrency (intra-batch) | Adaptive: `min(cpus-1, 4)` ffmpeg parallel |
| Resume | Auto-detect crashed batches on launch → prompt user; cancelled batches NOT resumable |
| Persistence | `conversions` + `conversion_files` SQLite tables; heartbeat for crash detection |
| Tag preservation | ffmpeg `-map_metadata 0 -id3v2_version 3` (Rekordbox lock) |
| Worker buffering | BATCH_SIZE=20, BATCH_MS=200; per-file completion flushed immediately |

## Next up

`/gsd-plan-phase 3` to break this into vertical-slice plans.
