---
phase: 05-tag-writing-rekordbox-compatibility
verified: 2026-06-16T12:15:00Z
status: human_needed
score: 12/12 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Mp3tag tag visibility (SC #1, TAGS-01)"
    expected: "After a Keep action and clicking Appliquer in the UI, open the written MP3 in Mp3tag and confirm Artist, Title, Genre, BPM, Key, Comment, and star rating all show the edited values."
    why_human: "Requires the app running with a real audio file and an external tool (Mp3tag); cannot be verified by grep or unit test."
  - test: "Crash-safety under kill-mid-write (SC #2, TAGS-02)"
    expected: "Force-kill the app process mid-batch; relaunch; confirm no zero-byte or truncated source files exist and that the not-yet-written files still appear in the pending queue with their count unchanged."
    why_human: "Requires deliberate process termination at a specific moment and manual filesystem inspection — not automatable."
  - test: "Rekordbox import + POPM star scale (SC #3, TAGS-03)"
    expected: "Import a written 4-star MP3 into Rekordbox 6.x; confirm integer BPM, Camelot Key, Genre are shown correctly, and the star rating renders as 4 stars (validates the unverified POPM byte 204 -> 4-star assumption from A3). If Rekordbox shows a different star count, flag the POPM mapping for revision."
    why_human: "Requires a Rekordbox 6.x installation and a manually prepared test file; the POPM byte scale (51/102/153/204/255) is documented as UNVERIFIED against Rekordbox in the research (Assumption A3 open question)."
---

# Phase 5: Tag Writing & Rekordbox Compatibility — Verification Report

**Phase Goal:** As a DJ who has tagged files in the Tagger, I want to write those edits durably into the audio files in a Rekordbox-readable format, so that my library is clean and tagged without leaving the app or risking corruption.
**Verified:** 2026-06-16T12:15:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

#### Plan 01 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A pending edit for an MP3 is written into the file as ID3v2.3 frames; a music-metadata read-back confirms (D-04 non-destructive) | VERIFIED | `tagWriter.ts` writeMp3Tags: copies to `.ck-tmp`, calls `NodeID3.update(tags, tmp)` (merge, not overwrite), then `fs.rename`. 21 tagWriter tests green including ID3v2.3 round-trip and non-destructive album-survives-genre-write test. |
| 2 | A pending edit for an M4A is written via ffmpeg remux and the tmpo BPM atom reads back as common.bpm | VERIFIED | `tagWriter.ts` writeMp4Tags: builds args with `tmpo=${input.bpm}` (not `BPM` which is silently ignored), uses `-f ipod` for .m4a/.aac. MP4 round-trip test (green) confirms `common.bpm === 128` read-back. |
| 3 | If a write throws, the original audio file is left byte-identical (atomic temp+rename, TAGS-02) | VERIFIED | Both writeMp3Tags and writeMp4Tags wrap in try/catch: on any failure `await fs.rm(tmp, { force: true })` is called and error is rethrown, leaving original untouched. Crash-safety test (mocked NodeID3.update throw) confirms original byte-identical, no temp remains. |
| 4 | listPendingWrites returns rows where applied_at IS NULL OR updated_at > applied_at (re-edits included) | VERIFIED | `taggerRepo.ts` line 190-193: `listPendingWritesStmt = db.prepare('SELECT * FROM pending_tag_edits WHERE applied_at IS NULL OR updated_at > applied_at')`. Test suite confirms NULL rows and re-edited rows both appear; written-after-last-edit rows do not. |
| 5 | markApplied sets applied_at only for the named file_path; a per-file failure leaves applied_at NULL (D-05) | VERIFIED | `markAppliedStmt = db.prepare('UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?')`. Test confirms per-file isolation: second row stays NULL and remains in pending list. |

#### Plan 02 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 6 | Invoking tagger:apply-writes iterates every pending edit, writes each file, and sets applied_at only on success | VERIFIED | `ipc/tagger.ts` handler calls `filterWritableEdits(pending, root)` then `applyController.applyPendingWrites(safe)`. Controller iterates edits, calls `markApplied` only AFTER write resolves. 10/10 applyController tests + 35/35 tagger IPC tests green. |
| 7 | A per-file failure is reported (push event ok:false) and leaves applied_at NULL so the file stays in the queue; the batch continues (D-05) | VERIFIED | Controller try/catch per file: on catch → totalFailed++, sends `{type:'fileDone', ok:false, error}`, does NOT call markApplied. "Per-file isolation" test (3 files, middle throws) confirms totalWritten=2, totalFailed=1, batch continues. |
| 8 | tagger:pending-count returns the count of rows the re-edit predicate selects | VERIFIED | Handler: `return taggerRepo.listPendingWrites().length`. Tests confirm returns correct count. |
| 9 | The apply-writes handler rejects / skips any DB path that fails resolvesUnderRoot or AUDIO_EXTS (T-05-PT, T-05-IV) — CR-01 fix verified | VERIFIED | CR-01 fix confirmed in source: `filterWritableEdits(pending, root)` result is passed directly as `safe` to `applyController.applyPendingWrites(safe)`. Controller signature now takes `edits: PendingTagEdit[]` (pre-filtered). Regression test at tagger.test.ts:366 ("CR-01: passes ONLY filterWritableEdits-approved rows to the controller") is green. |
| 10 | The renderer can call window.crateKeeper.tagger.applyWrites / getPendingCount / onWriteEvent through the typed bridge | VERIFIED | `preload/index.ts` exposes all three: `applyWrites` via invoke, `getPendingCount` via invoke, `onWriteEvent` with on()/off() unsubscribe closure. `ipc-types.ts` carries `TagWriteEvent`, `ApplyResult`, and `CrateKeeperTaggerApi` with all three methods. |

#### Plan 03 Must-Haves

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 11 | The Tagger shows an "Appliquer (N)" affordance with N = the re-edit-aware pending-writes count (D-01/D-03) | VERIFIED | `ApplyBanner.tsx` renders `Appliquer (${pendingWriteCount})`. `useTaggerStore.loadPendingWriteCount` calls `window.crateKeeper.tagger.getPendingCount()` and is wired into TaggerView mount Promise.all (line 63). ApplyBanner.test.tsx test "shows 'Appliquer (3)' when pendingWriteCount=3" is green. TaggerView mounts `<ApplyBanner />` at lines 194 and 212 (active-card and end-of-queue branches). |
| 12 | Clicking Appliquer invokes tagger:apply-writes, disables the button while running, and shows per-file Écrit/Erreur feedback and an "N écrits, N erreurs" summary (D-05) + banner subscribes before invoke and unsubscribes on done + renders nothing when 0 pending and no result | VERIFIED | `useTaggerStore.applyWrites`: subscribe-before-invoke pattern (onWriteEvent before applyWrites call); immutable Map per fileDone event; unsub on both done and error paths. `ApplyBanner.tsx`: renders null when `pendingWriteCount === 0 && applyResult === null && !isApplying`; button `disabled={isApplying \|\| pendingWriteCount === 0}`; Écrit/Erreur badges; summary line. E2E test (TaggerEndToEnd.test.tsx) drives full fileDone+done sequence, confirms badges and summary. 12/12 ApplyBanner tests + 3/3 E2E tests green. |

**Score:** 12/12 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/main/tagger/tagWriter.ts` | writeMp3Tags + writeMp4Tags + getWriteStrategy + starToPopmByte | VERIFIED | File exists, 212 lines, all 4 exports present, substantive implementation |
| `src/main/tagger/tagWriter.test.ts` | Round-trip + non-destructive + crash-safety + POPM | VERIFIED | 21 tests, covers all required behaviors including ID3v2.3 assertion |
| `src/main/tagger/taggerRepo.ts` | listPendingWrites (re-edit predicate) + markApplied | VERIFIED | Predicate literal `applied_at IS NULL OR updated_at > applied_at` at lines 190-193; markApplied at lines 196-198 |
| `src/main/tagger/applyController.ts` | createApplyController + makeTaggerWriteSender | VERIFIED | File exists, 139 lines, instance-scoped isRunning guard (CR-03), takes pre-filtered edits (CR-01) |
| `src/main/ipc/tagger.ts` | tagger:apply-writes + tagger:pending-count handlers + filterWritableEdits | VERIFIED | Both handlers registered; filterWritableEdits exported and used load-bearingly (CR-01 fix) |
| `src/shared/ipc-types.ts` | TagWriteEvent + ApplyResult + 3 channels + bridge methods | VERIFIED | TaggerApplyWrites, TaggerPendingCount, TaggerWriteEvent channels; TagWriteEvent discriminated union; ApplyResult interface; CrateKeeperTaggerApi extension |
| `src/preload/index.ts` | tagger.applyWrites / getPendingCount / onWriteEvent bridge | VERIFIED | All three present with unsubscribe closure on onWriteEvent |
| `src/renderer/src/store/useTaggerStore.ts` | applyWrites action + isApplying + applyResult + writeResults + pendingWriteCount | VERIFIED | All 5 state fields present; applyWrites mirrors conversion startBatch pattern |
| `src/renderer/src/components/tagger/ApplyBanner.tsx` | Appliquer (N) surface with per-file feedback | VERIFIED | 100 lines, exports ApplyBanner, renders null guard, Écrit/Erreur badges, summary |
| `src/main/workers/__fixtures__/test-tagged.mp3` | Fixture with album="Original Album" for non-destructive test | VERIFIED | File present in fixtures directory |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `tagWriter.ts` | `node-id3 NodeID3.update` | merge tags into temp copy then fs.rename | VERIFIED | Line 134: `const result = NodeID3.update(tags, tmp)` |
| `tagWriter.ts` | ffmpeg tmpo atom | `-map_metadata 0 -c copy -metadata tmpo=` | VERIFIED | Line 173: `metaFlags.push('-metadata', \`tmpo=${input.bpm}\`)` |
| `taggerRepo.ts` | pending_tag_edits | prepared statement | VERIFIED | `applied_at IS NULL OR updated_at > applied_at` at line 192 |
| `ipc/tagger.ts` | `applyController.applyPendingWrites` | `ipcMain.handle(TaggerApplyWrites)` | VERIFIED | Line 334-348: handler calls filterWritableEdits then applyPendingWrites(safe) |
| `applyController.ts` | `taggerRepo.listPendingWrites + markApplied + tagWriter` | sequential per-file loop | VERIFIED | Controller iterates edits array (pre-filtered by IPC layer); markApplied called after each successful write |
| `main/index.ts` | `createApplyController` | wiring with resolveFfmpegPath + makeTaggerWriteSender | VERIFIED | Lines 190-208: taggerWriteSend constructed, applyController built, passed to registerTaggerHandlers |
| `ApplyBanner.tsx` | `useTaggerStore.applyWrites` | onClick handler | VERIFIED | Line 35: `void useTaggerStore.getState().applyWrites()` |
| `useTaggerStore.ts` | `window.crateKeeper.tagger.applyWrites + onWriteEvent + getPendingCount` | bridge calls | VERIFIED | All three bridge calls present in applyWrites and loadPendingWriteCount actions |
| `TaggerView.tsx` | `ApplyBanner` | render in view shell | VERIFIED | Line 2: imported; lines 194 and 212: mounted in active-card and end-of-queue branches |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `ApplyBanner.tsx` | `pendingWriteCount` | `loadPendingWriteCount` → `getPendingCount` IPC → `taggerRepo.listPendingWrites().length` | Yes — SQLite query with re-edit predicate | FLOWING |
| `ApplyBanner.tsx` | `writeResults` | `applyWrites` → `onWriteEvent` push events from main → immutable Map updates | Yes — real file-write results from controller | FLOWING |
| `ApplyBanner.tsx` | `applyResult` | `done` event from controller with actual totalWritten/totalFailed counts | Yes — real batch totals | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite (549 tests) | `npx vitest run` | 549 passed, 39 test files | PASS |
| Typecheck (node + web) | `npm run typecheck` | Clean — no errors | PASS |
| tagWriter unit tests | `npx vitest run src/main/tagger/tagWriter.test.ts` | 21/21 (included in full run) | PASS |
| taggerRepo unit tests | `npx vitest run src/main/tagger/taggerRepo.test.ts` | 25/25 (included in full run) | PASS |
| applyController unit tests | `npx vitest run src/main/tagger/applyController.test.ts` | 10/10 (included in full run) | PASS |
| tagger IPC tests | `npx vitest run src/main/ipc/tagger.test.ts` | 35/35 (included in full run) | PASS |
| ApplyBanner tests | `npx vitest run src/renderer/src/components/tagger/ApplyBanner.test.tsx` | 12/12 (included in full run) | PASS |
| E2E apply slice | `npx vitest run src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx` | 3/3 (included in full run) | PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| TAGS-01 | Plans 01/02/03 | Tags written directly into audio files (ID3v2.3 for MP3, MP4 atoms for M4A/AAC) | SATISFIED | writeMp3Tags + writeMp4Tags; full write path wired through IPC to renderer button |
| TAGS-02 | Plans 01/02/03 | Atomic write-to-temp + rename; no corruption on failure | SATISFIED | Both writers use `.ck-tmp` + fs.rename; catch block rm temp + rethrow; crash-safety test green |
| TAGS-03 | Plans 01/02/03 | Rekordbox-compatible: ID3v2.3, UTF-16 (node-id3 default), integer TBPM, Camelot TKEY, POPM | SATISFIED (automated) / NEEDS HUMAN (Rekordbox import) | node-id3 writes ID3v2.3 by default; TBPM as string frame; TKEY via `initialKey`; POPM mapping {1:51,2:102,3:153,4:204,5:255}. Round-trip tests confirm tagType contains 'ID3v2.3'. Rekordbox import validation requires manual check (SC #3). |

### Code Review Blocker Resolution

The phase submitted with 3 BLOCKERs found in the code review (05-REVIEW.md). Commit 58e6ea5 claims all 3 are fixed. Verification confirms:

**CR-01 (dead security gate) — FIXED:**
- Before fix: `filterWritableEdits` result computed but discarded; controller re-read DB raw.
- After fix: `applyController.applyPendingWrites(safe)` takes the filtered list. Controller signature is `applyPendingWrites(edits: PendingTagEdit[])` — no internal DB re-read. The IPC-layer filter is now load-bearing.
- Regression test: `tagger.test.ts:366` ("CR-01: passes ONLY filterWritableEdits-approved rows to the controller") — GREEN.

**CR-02 (ffmpeg metadata injection) — FIXED:**
- Before fix: tag values interpolated raw into `-metadata key=value` argv.
- After fix: `ffmpegMetaValue(v)` in tagWriter.ts strips C0 control chars / DEL before concatenation. `assertOptionalText` in ipc/tagger.ts rejects control characters at the IPC boundary (line 87: `/[ -]/.test(v)`).
- Regression test: `tagger.test.ts:233` ("CR-02: rejects control characters in text fields") — GREEN.

**CR-03 (module-singleton guard) — FIXED:**
- Before fix: `isRunning` was module-level (`let isRunning = false` outside factory).
- After fix: `isRunning` declared inside `createApplyController` closure (line 62 of applyController.ts). Each controller instance has independent guard.
- Regression test: `applyController.test.ts:282` ("CR-03: single-active guard is instance-scoped") — GREEN.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `tagger.css` | — | Styles for `.apply-banner` appended; uses existing `:root` tokens | INFO | Compliant — no new `--color-*` vars per CLAUDE.md editorial lock |
| `ApplyBanner.tsx` | 18-21 | Inline `basename()` re-implementation | INFO | WR debt item IN-03 — deferred per blockers-only scope; display-only function |

No `TBD`, `FIXME`, or `XXX` debt markers found in any Phase 5 files.

### Known Deferred Debt (WR-* / IN-* from 05-REVIEW.md — intentionally deferred, not phase failures)

The code review found 7 warnings and 5 info items. Per the user decision (blockers-only scope), these were deferred to future work:

| ID | Concern | Severity |
|----|---------|----------|
| WR-01 | `.mp4` extension mismatch between AUDIO_EXTS and getWriteStrategy MP4_EXTS | Warning |
| WR-02 | getPendingCount has no filterWritableEdits gate — badge may over-count | Warning |
| WR-03 | `spawnSync` + synchronous NodeID3.update block the Electron main thread during batch | Warning (highest value remaining) |
| WR-04 | writeResults accumulates across batches; no dismiss affordance for large lists | Warning |
| WR-05 | `runWithSlide` waits on transitionend with no timeout — card can hang | Warning |
| WR-06 | ffmpeg signal-kill / ENOENT diagnostics are poor (`status=null` case) | Warning |
| WR-07 | markApplied uses a single now() for the batch — latent re-edit race if writes become async | Warning |
| IN-01 | `console.error` in preload error path | Info |
| IN-02 | Dead if-block in IPC handler removed by CR-01 fix | Info (resolved by CR-01) |
| IN-03 | basename reimplemented inline in ApplyBanner | Info |
| IN-04 | POPM counter:0 + synthetic email undocumented as Rekordbox assumption | Info |
| IN-05 | assertOptionalRating uses set-membership only (no Number.isInteger symmetry) | Info |

These are known debt items, not blockers for phase acceptance.

### Human Verification Required

**1. Mp3tag tag visibility (SC #1, TAGS-01)**

**Test:** After a Keep action in the Tagger and clicking Appliquer, use an external tool (e.g. Mp3tag) to open the written audio file.
**Expected:** Artist, Title, Genre, BPM, Key, Comment, and star rating all show the edited values exactly as entered.
**Why human:** Requires the running Electron app, a real audio file, and an external metadata inspection tool.

**2. Crash-safety under kill-mid-write (SC #2, TAGS-02)**

**Test:** During a large Appliquer batch, force-kill the app process mid-write (e.g. `kill -9` the Electron PID). Relaunch the app.
**Expected:** No zero-byte or truncated source files. Files not yet written still appear in the pending queue with count unchanged (only successfully written files have applied_at set).
**Why human:** Requires deliberate OS-level process termination at a precise timing window and manual filesystem + queue inspection. Not reproducible deterministically in a test harness.

**3. Rekordbox import + POPM star scale validation (SC #3, TAGS-03)**

**Test:** Write a file with a 4-star rating via the Tagger + Appliquer flow. Import the written MP3 into Rekordbox 6.x.
**Expected:** Integer BPM, Camelot Key, and Genre display correctly. Star rating shows 4 stars. If Rekordbox shows a different star count, flag the POPM byte mapping (204 → 4 stars) for revision — this is the A3 unverified assumption from RESEARCH.md.
**Why human:** Requires a Rekordbox 6.x installation; the POPM byte scale (51/102/153/204/255 → 1-5 stars) is flagged as UNVERIFIED against Rekordbox in the research document (Open Question #2). Round-trip tests only validate against music-metadata, not Rekordbox.

---

_Verified: 2026-06-16T12:15:00Z_
_Verifier: Claude (gsd-verifier)_
