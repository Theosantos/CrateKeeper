---
phase: 03-conversion
verified: 2026-06-04T00:42:00Z
status: human_needed
score: 6/6 must-haves verified at code level
overrides_applied: 0
human_verification:
  - test: "Real-FS conversion of ≥50 mixed-format files (CONV-01..04 end-to-end UX)"
    expected: "Selection → Convertir → Lancer produces live per-file + global progress, errors per-file don't abort batch, summary line in French, output files in `{root}/converted/{slug}/`"
    why_human: "Visual/UX behavior: live progress animation, French copy accuracy, real ffmpeg throughput, no UI freeze, Annuler stops cleanly with no orphan ffmpeg in `ps aux`. Cannot be observed via grep."
    plan: "03-01 Task 10 + 03-02 Task 5"
  - test: "Tag preservation visual check in Rekordbox (CONV-06)"
    expected: "Genre / BPM / Key (TKEY in Camelot) visible in Rekordbox after MP3→MP3 and FLAC→MP3 conversion"
    why_human: "Empirical Rekordbox interop. tagRoundtrip.test.ts proves music-metadata round-trip; only a human can confirm Rekordbox actually displays the fields correctly."
    plan: "03-01 Task 10"
  - test: "Crash-resume simulation (CONV-05)"
    expected: "kill -9 mid-batch → no orphan ffmpeg → reboot after >30s → ResumeBanner appears above PresetSelector with correct pendingCount → Reprendre resumes only non-terminal files with original preset → Ignorer drops the row"
    why_human: "Multi-process timing (heartbeat ≥30s threshold), force-kill flow, SQLite inspection, and renderer banner appearance/disappearance must be observed live. Code-level invariants verified (boot-sweep ordering smoke test, controller resume guards, SQL excludes cancelled), but the full crash→reboot→resume cycle is a human protocol."
    plan: "03-03 Task 4"
  - test: "Single-active rejection on resume + start"
    expected: "Starting a second batch while one is active rejects with French 'Une conversion est déjà en cours'; Reprendre while running also rejects"
    why_human: "Toast/error UX surface"
    plan: "03-01 Task 10 + 03-03 Task 4"
  - test: "Conflict policy (skip + log) on re-run"
    expected: "Re-running the exact same selection produces `0 converti, 0 en erreur, N ignorés` summary"
    why_human: "Renderer summary line correctness across a full real batch"
    plan: "03-02 Task 5"
  - test: "Preset persistence across app restarts"
    expected: "Restart `npm run dev` → ConvertirView shows the last-picked preset (e.g. FLAC instead of MP3 320 default)"
    why_human: "Multi-session UX; `settings:get/set` allowlist confirmed in code, but visual confirmation needed"
    plan: "03-02 Task 5"
---

# Phase 3: FFmpeg Conversion Pipeline — Verification Report

**Phase Goal:** Users can select files from the library and convert them in batch to a configurable format/bitrate, with per-file progress, error reporting, resume capability, and tag preservation.

**Verified:** 2026-06-04T00:42:00Z
**Status:** human_needed (code-level PASS; 6 manual UAT protocols deferred to end-of-phase per `human_verify_mode: end-of-phase`)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (mapped to ROADMAP Success Criteria + CONV-NN requirements)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 / CONV-01, CONV-02: User can select files in library and start a batch conversion to MP3 320kbps (or custom format/bitrate) | ✓ VERIFIED (code) — needs human UX confirmation | `src/renderer/src/components/analyser/VirtualizedFileTable.tsx` (checkbox col), `ScanToolbar.tsx` (Convertir N action), `ConvertirView.tsx` (PresetSelector + CustomPresetForm + Lancer), `useScanStore.selectedFilePaths` + `useConversionStore.seedFilePaths` wiring, `IpcChannels.ConversionStart` + `conversionStartHandler` validates and forwards to `controller.start`. `PRESETS` registry exports exactly 5 entries (mp3-320 / mp3-v0 / aac-256 / flac / wav) verified in `presets.ts:10-58`; custom escape hatch validated in `conversionStartHandler` |
| 2 | SC2 / CONV-03: Per-file and global progress update in real time | ✓ VERIFIED (code) | Worker emits `{type:'progress', percent}` events batched at BATCH_SIZE=20 / BATCH_MS=200 (`conversionWorker.ts:41-42, 148-153`); `fileDone` flushed immediately; `parseFfmpegTimeProgress` returns rightmost match for chunk-boundary safety (`conversionCore.ts`); `ConversionProgress.tsx` renders per-file via @tanstack/react-virtual; `selectGlobalProgress` derives from `pendingFilePaths.length` |
| 3 | SC3 / CONV-04: One file fails → error shown, rest of batch continues | ✓ VERIFIED (code) | Controller test asserts `fileDone status:'error'` does NOT trigger `repo.complete`; batch only completes on terminal `done`/`cancelled`. `conversion_files.status` enum includes `error` + `skipped`. Summary line `N converti, M en erreur, K ignorés` rendered in `ConversionProgress.tsx` |
| 4 | SC4 / CONV-05: User interrupts mid-batch, relaunches, resumes from where stopped | ✓ VERIFIED (code) — needs human crash-simulation | Boot-sweep `controller.markStaleAsCrashed({thresholdMs:30_000})` runs in `src/main/index.ts:119-122` BEFORE `mainWindow = createWindow()` (line 134); source-line-order smoke test in `conversion.test.ts:351`. `findResumable()` SQL excludes cancelled (`WHERE c.status = 'crashed'`); `getResumablePending` returns only `status IN ('pending','running','error')` excluding `cancelled`. `controller.resume` reuses original preset from `repo.getConversion(id).preset`, single-active guard before any writes. `ResumeBanner.tsx` rendered as first child of `.convertir__body`. `useConversionStore.resumeBatch` order: reset → restore siblings → subscribeEvents → conversion.resume |
| 5 | SC5 / CONV-06: Converted files retain original ID3/MP4 tags | ✓ VERIFIED (real ffmpeg) — needs Rekordbox visual confirm | `buildFfmpegArgs` appends `-map_metadata 0` always; appends `-id3v2_version 3` ONLY for `.mp3` targets (Rekordbox lock, `presets.ts:89-91`). `tagRoundtrip.test.ts` runs the REAL bundled ffmpeg-static binary and asserts via `music-metadata.parseFile`: MP3→MP3 hard-asserts title/artist/album/genre/BPM/Key/Comment; FLAC→MP3 + M4A→MP3 hard-assert title/artist/album/genre + soft-warn BPM/Key (known mapping gaps documented) |
| 6 | Worker bundling (Pitfall 1 carry-forward) | ✓ VERIFIED | `out/main/workers/conversionWorker.js` exists (5088 bytes); `electron.vite.config.ts` declares the 3rd rollup input; `npm run build` green |

**Score:** 6/6 truths verified at code level. 6 human-verify protocols deferred (see frontmatter `human_verification`).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/conversion/presets.ts` | PRESETS (5 entries), buildFfmpegArgs, getPresetBySlug | ✓ VERIFIED | 5 slugs correct; `-id3v2_version 3` MP3-only; aac codec='aac' (Pitfall 2 lock) |
| `src/main/conversion/ffmpegPath.ts` | resolveFfmpegPath asar → asar.unpacked rewrite | ✓ VERIFIED | path.sep-aware split/join in `ffmpegPath.ts:27` |
| `src/main/conversion/conversionRepo.ts` | tables + heartbeat + findResumable + markStaleAsCrashed + getResumablePending + updateConversionStatus + deleteConversion | ✓ VERIFIED | CHECK constraints on both status enums; FK CASCADE; cancelled excluded from resumable |
| `src/main/conversion/controller.ts` | single-active, persist-then-forward, SIGTERM-first cancel, heartbeat, real resume | ✓ VERIFIED | BatchAlreadyActive thrown on start AND resume; cancel sequence postMessage → await settle (5s) → terminate → repo.complete; resume rejects when `row.status !== 'crashed'` |
| `src/main/workers/conversionCore.ts` | pure helpers, no worker_threads/child_process imports | ✓ VERIFIED | Only `node:path` import; `g` regex with lastIndex=0 reset |
| `src/main/workers/conversionWorker.ts` | child_process pool, SIGTERM, fs.unlink partials, BATCH_SIZE=20/BATCH_MS=200 | ✓ VERIFIED | `live.add(child)`/`SIGTERM`/`fs.unlink(out).catch` all present; no electron/conversionRepo imports |
| `src/main/ipc/conversion.ts` | 5 channels, folder allowlist, AUDIO_EXTS filter, custom preset codec allowlist | ✓ VERIFIED | `resolvesUnderRoot` + AUDIO_EXTS check on every filePath; preset.slug ∈ PRESETS ∪ {'custom'}; codec allowlist; BatchAlreadyActive → French toast |
| `src/main/ipc/settings.ts` | generic K/V bridge with SETTINGS_KEY_ALLOWLIST | ✓ VERIFIED | Plan-02 addition; allowlist + 8 KiB size cap |
| `src/renderer/src/store/useConversionStore.ts` | status/progress/errors/preset/resumable + IPC subscription lifecycle | ✓ VERIFIED | reset → seed → subscribe order; checkResumable/resumeBatch/discardBatch wired |
| `src/renderer/src/components/convertir/*` | ConvertirView + PresetSelector + CustomPresetForm + ConversionProgress + ResumeBanner | ✓ VERIFIED | All 5 components present; ResumeBanner rendered above PresetSelector; @tanstack/react-virtual on per-file list |
| `out/main/workers/conversionWorker.js` | Bundled worker output | ✓ VERIFIED | 5088 bytes alongside scanWorker.js + index.js |

### Key Link Verification

| From | To | Via | Status |
|------|----|----|--------|
| preload (`window.djUtils.conversion.*`) | `src/main/ipc/conversion.ts` | `ipcRenderer.invoke('conversion:start'\|'cancel'\|'list-resumable'\|'resume'\|'discard')` + `ipcRenderer.on('conversion:event')` | ✓ WIRED |
| `src/main/ipc/conversion.ts` | `controller.start/cancel/resume` | direct call after V5 validation + allowlist | ✓ WIRED |
| `controller` | `conversionWorker.ts` | `new Worker(path.join(__dirname, 'workers/conversionWorker.js'), { workerData })` in `index.ts` | ✓ WIRED |
| `controller` | `conversionRepo` | createConversion / insertFileBatch (transaction) / updateFile / bumpHeartbeat / complete / findResumable / markStaleAsCrashed / getResumablePending / updateConversionStatus / deleteConversion | ✓ WIRED |
| `connection.ts` | conversionRepo | `initConversionSchema(db)` + `getConversionRepo()` lazy singleton | ✓ WIRED |
| `controller` | `ffmpegPath.resolveFfmpegPath` | `deps.resolveFfmpegPath({rawPath: require('ffmpeg-static'), isPackaged: app.isPackaged})` resolved in main, passed via workerData | ✓ WIRED |
| `ConvertirView` | `useConversionStore.checkResumable` | `useEffect(() => { void checkResumable() }, [])` one-shot on mount | ✓ WIRED |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|--------------------|--------|
| `ConversionProgress.tsx` | `fileStatuses` Map | useConversionStore.subscribeEvents → IPC `conversion:event` → worker stderr | Yes (real ffmpeg progress events; test suite asserts batched flush) | ✓ FLOWING |
| `ResumeBanner.tsx` | `resumableBatches` | useConversionStore.checkResumable → `conversion:list-resumable` → `repo.findResumable()` (real SQL aggregate over `conversions` JOIN `conversion_files`) | Yes | ✓ FLOWING |
| `PresetSelector.tsx` | `selectedPreset` | settings:get('conversion.lastPreset') on mount + PRESETS registry mirror | Yes | ✓ FLOWING |
| `ConvertirView.tsx` selection | `pendingFilePaths` | seeded from `useScanStore.selectedFilePaths` Set via ScanToolbar action | Yes | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite passes | `npm test -- --run` | 275 passed (21 files) | ✓ PASS |
| Build emits bundled worker | `npm run build && test -f out/main/workers/conversionWorker.js` | exists, 5088 bytes | ✓ PASS |
| Tag round-trip integration test runs real ffmpeg | `npm test -- --run src/main/conversion/tagRoundtrip` | included in 275/275 | ✓ PASS |
| All conversion test files green | `npm test -- --run src/main/conversion src/main/workers/conversionCore src/main/ipc/conversion` | included in 275/275 | ✓ PASS |
| Convertir UI tests green | `npm test -- --run src/renderer/src/components/convertir src/renderer/src/store/useConversionStore` | included in 275/275 | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| CONV-01 | 03-01, 03-02 | Selection → batch conversion | ✓ SATISFIED (code) | Checkbox + toolbar + ConvertirView + start handler all wired |
| CONV-02 | 03-01, 03-02 | Format/bitrate configurable; MP3 320 default | ✓ SATISFIED | 5 presets + Custom escape hatch; default MP3 320 |
| CONV-03 | 03-01, 03-02 | Per-file + global progress | ✓ SATISFIED | Batched progress events + react-virtual list |
| CONV-04 | 03-01, 03-02 | Per-file errors don't abort batch | ✓ SATISFIED | Controller test + summary line; conflict policy uses status='skipped' |
| CONV-05 | 03-03 | Resume after interruption | ✓ SATISFIED (code) — human UAT pending | Heartbeat sweep + ResumeBanner + controller.resume + cancelled-excluded SQL |
| CONV-06 | 03-01 | Tag preservation | ✓ SATISFIED (real ffmpeg) — Rekordbox visual UAT pending | tagRoundtrip.test.ts with real binary + `-id3v2_version 3` MP3 lock |

No orphaned requirements; REQUIREMENTS.md `CONV-01..06` all mapped to Phase 3 plans.

### Locked CONTEXT Decisions — Cross-check

| Locked Decision | Status | Code Evidence |
|-----------------|--------|---------------|
| Folder allowlist gate on every conversion handler | ✓ | `conversion.ts:69` `resolvesUnderRoot` + per-file check |
| AUDIO_EXTS server-side filter (SUGGESTION 1) | ✓ | `conversion.ts:9` import + filter in start handler |
| ID3v2.3 enforcement on MP3 targets | ✓ | `presets.ts:89-91` `-id3v2_version 3` only when extension==='.mp3' |
| asarUnpack helper for ffmpeg binary | ✓ | `ffmpegPath.ts` path.sep-aware rewrite; resolved in main, passed via workerData |
| Single-active batch (BatchAlreadyActive) | ✓ | `controller.ts:220 + :325` (start and resume) |
| Intra-batch pool min(cpus-1, 4) | ✓ | `controller.ts` parallelism computation; worker iterates `parallelism` slot-runners |
| Heartbeat 5s + sweep threshold 30s | ✓ | `controller.ts` setInterval + `markStaleAsCrashed({thresholdMs:30_000})` in `index.ts:119-122` |
| Cancelled NOT resumable | ✓ | `findResumable` SQL `WHERE c.status='crashed'`; `getResumablePending` excludes 'cancelled' |
| Persist-then-forward | ✓ | controller.test.ts invocationCallOrder asserts updateFile before send for fileDone |
| Worker = pure Node, no electron/conversionRepo imports | ✓ | grep verified — no offending imports in `conversionWorker.ts` |
| Boot sweep BEFORE createWindow | ✓ | `index.ts:121` precedes `index.ts:134`; source-line smoke test in `conversion.test.ts:351` |

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|------|---------|----------|--------|
| (none in shipped Phase 3 files) | grep `TBD\|FIXME\|XXX` over `src/main/conversion/`, `src/main/workers/conversionWorker.ts`, `src/main/workers/conversionCore.ts`, `src/main/ipc/conversion.ts`, `src/renderer/src/components/convertir/`, `src/renderer/src/store/useConversionStore.ts` | — | No debt markers; clean |

### Human Verification Required

See `human_verification` frontmatter for the 6 deferred protocols. The three load-bearing ones (planner-deferred per `human_verify_mode: end-of-phase`):

1. **03-01 Task 10** — Real-FS conversion + Rekordbox tag visual check + cancel/no-orphan-ffmpeg + allowlist rejection.
2. **03-02 Task 5** — Convertir UI live progress + Annuler + conflict policy + preset persistence across restarts.
3. **03-03 Task 4** — Crash simulation (`kill -9` mid-batch) → reboot after 30s → ResumeBanner appears → Reprendre/Ignorer; cancelled-not-resumable guard; single-active resume guard.

### Gaps Summary

None at the code level. All 6 success criteria, all 6 CONV-NN requirements, all 11 locked CONTEXT decisions verified against shipped code. Build green, 275/275 tests pass. The remaining surface is purely UAT — visual UX, multi-process timing (heartbeat ≥30s), Rekordbox interop, and orphan-process inspection — which cannot be observed via grep or test suite.

**Recommended next step:** User runs the three human-verify protocols above. If all pass → mark Phase 3 success criteria checked in ROADMAP.md and proceed to Phase 4 (Tagger Core).

---

_Verified: 2026-06-04T00:42:00Z_
_Verifier: Claude (gsd-verifier)_
