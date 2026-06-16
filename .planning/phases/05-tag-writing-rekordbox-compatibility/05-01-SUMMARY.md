---
phase: 05-tag-writing-rekordbox-compatibility
plan: 01
subsystem: tagger/tag-writer
tags: [node-id3, ffmpeg, id3v2.3, mp4-remux, atomic-write, taggerRepo]
dependency_graph:
  requires:
    - 04-01 (pending_tag_edits schema + taggerRepo base)
    - 04-02 (PendingTagEdit type in ipc-types)
  provides:
    - tagWriter.ts (writeMp3Tags, writeMp4Tags, getWriteStrategy, starToPopmByte)
    - taggerRepo.listPendingWrites + markApplied (Phase 5 queue consumer interface)
    - test-tagged.mp3 fixture (for D-04 non-destructive tests)
  affects:
    - 05-02 (applyController will import writeMp3Tags/writeMp4Tags + taggerRepo methods)
    - 05-03 (Appliquer IPC handler uses these services)
tech_stack:
  added:
    - node-id3@^0.2.9 (pure JS ID3v2.3 writer — no native bindings)
  patterns:
    - atomic temp-copy + fs.rename (TAGS-02 crash-safety)
    - non-destructive tags object (D-04: only non-null fields included)
    - TDD RED→GREEN with vitest --project node
    - prepared statements at construction time (V5 defence)
key_files:
  created:
    - src/main/tagger/tagWriter.ts
    - src/main/tagger/tagWriter.test.ts
    - src/main/workers/__fixtures__/test-tagged.mp3
  modified:
    - src/main/tagger/taggerRepo.ts (listPendingWrites + markApplied added)
    - src/main/tagger/taggerRepo.test.ts (7 new tests for Phase 5 methods)
    - package.json / package-lock.json (node-id3 added)
decisions:
  - "Re-edit predicate: Option B adopted (applied_at IS NULL OR updated_at > applied_at) per RESEARCH recommendation — re-edits after a prior write are automatically re-included without clearing applied_at"
  - "ffmpeg MP4 output: -f ipod for .m4a/.aac, -f mp4 for .mp4 — explicit format required because .ck-tmp suffix is opaque to ffmpeg muxer detection"
  - "NodeID3.update return type: true | Error — removed unreachable === false check"
metrics:
  duration: "~7 minutes"
  completed: "2026-06-16"
  tasks: 3
  files_changed: 7
---

# Phase 05 Plan 01: Tag Writer Engine Summary

Node-id3 MP3 writer + ffmpeg MP4 remux engine with atomic temp+rename, non-destructive field merging, and taggerRepo queue interface for the Phase 5 batch apply loop.

## What Was Built

### Task 1: node-id3 install + test-tagged.mp3 fixture

- Installed `node-id3@^0.2.9` (pure JS, no native bindings, no electron-rebuild)
- Created `src/main/workers/__fixtures__/test-tagged.mp3` by copying `tagged.mp3` and stamping `album='Original Album'` via `NodeID3.update()` — proves the same library round-trips existing frames
- Verified: `music-metadata parseFile` confirms `common.album === 'Original Album'`

### Task 2: tagWriter.ts — atomic MP3 + MP4 writers (TDD RED→GREEN)

`src/main/tagger/tagWriter.ts` exports:

- **`writeMp3Tags(filePath, input)`** — copies original → `.ck-tmp`, calls `NodeID3.update(tags, tmp)` (merge, not write — D-04), renames atomically. Null fields excluded from `tags` object so existing frames survive (Pitfall 5 prevented). On any throw: rm temp, rethrow (TAGS-02).
- **`writeMp4Tags(filePath, input, ffmpegBinaryPath)`** — builds `-c copy -map_metadata 0 ...metaFlags -f ipod/mp4` args, writes to `.ck-tmp`, renames atomically. Uses `tmpo` key for BPM (not `BPM` which is silently ignored — Pitfall 3 prevented).
- **`getWriteStrategy(filePath)`** — `.mp3` → `'mp3'`, `.m4a/.aac/.mp4` → `'mp4'`, others → `'unsupported'` (D-06 scope gate).
- **`starToPopmByte(stars)`** — LOCKED mapping `{1:51, 2:102, 3:153, 4:204, 5:255}` from 04-CONTEXT.md (TAGG-07).

All 21 tagWriter tests green:
- MP3 ID3v2.3 round-trip (format.tagTypes contains 'ID3v2.3', integer BPM, Camelot key)
- POPM byte 204 for 4 stars; POPM absent for rating=null
- Non-destructive: album='Original Album' survives a genre-only write
- Crash-safety: original byte-identical after mocked NodeID3.update throw, no temp remains
- MP4 tmpo BPM reads back as integer 128
- getWriteStrategy: all 8 extension cases correct

### Task 3: taggerRepo — listPendingWrites + markApplied (TDD RED→GREEN)

Extended `TaggerRepo` interface and `createTaggerRepo`:

- **`listPendingWrites()`** — prepared statement at construction: `SELECT * FROM pending_tag_edits WHERE applied_at IS NULL OR updated_at > applied_at` (Option B re-edit predicate). Maps through existing `toPendingTagEdit`.
- **`markApplied(filePath, now)`** — `UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?` (positional bind, per-file only — D-05).

All 25 taggerRepo tests green (18 existing + 7 new).

## Verification Results

```
tagWriter.test.ts   — 21/21 passed
taggerRepo.test.ts  — 25/25 passed
npm test            — 507/507 passed (37 test files)
npm run typecheck   — clean (no errors)
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] ffmpeg muxer cannot infer format from .ck-tmp extension**
- **Found during:** Task 2 GREEN (MP4 round-trip test)
- **Issue:** ffmpeg outputs `"Unable to find a suitable output format for '...out.m4a.ck-tmp'"` — the `.ck-tmp` suffix is opaque so ffmpeg cannot determine the container format
- **Fix:** Added `-f ipod` (for .m4a/.aac) or `-f mp4` (for .mp4) to the ffmpeg args, derived from the source file's extension
- **Files modified:** `src/main/tagger/tagWriter.ts`
- **Commit:** 845986f

**2. [Rule 1 - Bug] TypeScript: NodeID3.update return type is `true | Error`, not `true | false | Error`**
- **Found during:** `npm run typecheck`
- **Issue:** `result === false` produced `TS2367: This comparison appears to be unintentional because the types 'true' and 'false' have no overlap`
- **Fix:** Removed the unreachable `=== false` branch; the `instanceof Error` guard is sufficient
- **Files modified:** `src/main/tagger/tagWriter.ts`
- **Commit:** a56f382

**3. [Rule 1 - Bug] TypeScript: POPM native frame value typed as `{}`**
- **Found during:** `npm run typecheck`
- **Issue:** `popm?.value?.rating` produced `TS2339: Property 'rating' does not exist on type '{}'`
- **Fix:** Type-asserted `popm.value as { rating?: number }` in test
- **Files modified:** `src/main/tagger/tagWriter.test.ts`
- **Commit:** a56f382

**4. [Rule 3 - Blocking] better-sqlite3 ABI mismatch during taggerRepo test run**
- **Found during:** Task 3 RED gate
- **Issue:** Module compiled for Electron ABI 140, Vitest uses Node ABI 137
- **Fix:** Ran `npm run rebuild:node` (pre-existing documented procedure in STATE.md Known Risks)
- **Not committed** (runtime environment state, not code change)

## Key Decisions

- **Re-edit predicate:** Option B (`applied_at IS NULL OR updated_at > applied_at`) adopted as recommended in RESEARCH.md. Satisfies the 04-CONTEXT.md constraint (don't clear `applied_at` on upsert) while correctly re-queuing re-edited files for the next Appliquer pass.
- **ffmpeg output format:** Explicit `-f ipod`/`-f mp4` required — cannot rely on extension inference when the temp file has `.ck-tmp` suffix.

## Threat Surface Scan

No new network endpoints, auth paths, or file-access patterns beyond what the plan's threat model documents. The `T-05-TMP`, `T-05-FF`, `T-05-CORRUPT`, `T-05-DESTRUCT`, `T-05-SC` threats are all mitigated as specified.

## Known Stubs

None. All exported functions are fully implemented and covered by round-trip tests.

## Self-Check: PASSED

All created files verified on disk. All 6 task commits verified in git log.

| Check | Result |
|-------|--------|
| src/main/tagger/tagWriter.ts | FOUND |
| src/main/tagger/tagWriter.test.ts | FOUND |
| src/main/workers/__fixtures__/test-tagged.mp3 | FOUND |
| commit 733acc9 (node-id3 + fixture) | FOUND |
| commit 18f3d4b (RED tests) | FOUND |
| commit 845986f (tagWriter GREEN) | FOUND |
| commit 3773d19 (taggerRepo RED) | FOUND |
| commit deb5edc (taggerRepo GREEN) | FOUND |
| commit a56f382 (typecheck fixes) | FOUND |
