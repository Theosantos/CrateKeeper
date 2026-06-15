---
phase: 5
slug: tag-writing-rekordbox-compatibility
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-15
---

# Phase 5 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from 05-RESEARCH.md §"Validation Architecture".

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | Vitest ^4.1.7 (existing) |
| **Config file** | `vitest.config.ts` — `node` project for `src/main/**/*.test.ts` |
| **Quick run command** | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~3-8s · full suite (479+ tests) ~30-60s |

---

## Sampling Rate

- **After every task commit:** Run `npx vitest run --project node src/main/tagger/tagWriter.test.ts`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~8 seconds (quick run)

---

## Per-Task Verification Map

> Task IDs are assigned by the planner. Rows below are keyed by requirement +
> behavior; the planner/plan-checker must bind each to a concrete `{N}-PP-TT`
> task. Every behavior below MUST be covered by an `<automated>` verify in a
> plan task or declared a Wave 0 dependency.

| Behavior | Plan (TBD) | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|----------|------------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| MP3 tags written to file and readable by music-metadata | TBD | — | TAGS-01 | T-05-IV (input validation) | Path passes `resolvesUnderRoot` + `AUDIO_EXTS`; values pass length validators | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| MP4/M4A tags written via ffmpeg and readable by music-metadata | TBD | — | TAGS-01 | T-05-FF (ffmpeg path) | `resolveFfmpegPath()` from bundled binary, not user input | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Original file untouched if write fails (crash-safety) | TBD | — | TAGS-02 | — | Temp+rename never leaves a partial original | unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Atomic temp-in-same-dir + rename (no EXDEV) | TBD | — | TAGS-02 | T-05-TMP (temp collision) | Deterministic per-file temp name; sequential batch | unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Written MP3 has `format.tagTypes` containing 'ID3v2.3' | TBD | — | TAGS-03 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Written MP3 text frames use UTF-16 encoding | TBD | — | TAGS-03 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Written MP3 TBPM is integer-compatible (`common.bpm === number`) | TBD | — | TAGS-03 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Written MP3 TKEY = Camelot string (e.g. '8A') | TBD | — | TAGS-03 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| MP4 BPM written via `tmpo` atom, read back as `common.bpm` | TBD | — | TAGS-03 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| POPM byte for 4 stars = 204 (1→51,2→102,3→153,4→204,5→255) | TBD | — | TAGG-07 | — | N/A | unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| rating=null/0 → POPM frame omitted | TBD | — | TAGG-07 | — | N/A | unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Null/blank fields do not overwrite existing frames (non-destructive) | TBD | — | D-04 | — | N/A | integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ W0 | ⬜ pending |
| Per-file failure leaves `applied_at` NULL (stays retryable) | TBD | — | D-05 | — | N/A | unit | `npx vitest run --project node src/main/tagger/taggerRepo.test.ts` (extend) | ✅ (extend) | ⬜ pending |
| Apply-writes IPC rejects path outside root | TBD | — | TAGS-01 | T-05-PT (path traversal) | `resolvesUnderRoot(filePath, rootFolder)` on the new IPC handler | unit | `npx vitest run --project node src/main/ipc/tagger.test.ts` (extend) | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `npm install node-id3@^0.2.9` — must run before any `tagWriter.test.ts` can import it
- [ ] `src/main/tagger/tagWriter.test.ts` — new test file covering TAGS-01, TAGS-02, TAGS-03, TAGG-07, D-04
- [ ] Fixture `test-tagged.mp3` — an MP3 with a known existing POPM + text frames, for the non-destructive (D-04) test (`untagged.mp3` already exists; `tagged.m4a` already exists for MP4 tests)
- [ ] Extend `src/main/tagger/taggerRepo.test.ts` for the re-edit predicate + `markApplied` / `listPendingWrites`
- [ ] Extend `src/main/ipc/tagger.test.ts` for the apply-writes path-traversal gate

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Tags visible in an external tool (Mp3tag) after Apply | TAGS-01 (SC #1) | Requires a third-party desktop app outside the test harness | Apply pending edits to a sample MP3, open it in Mp3tag, confirm Artist/Title/Genre/BPM/Key/Comment/rating show the edited values |
| Rekordbox imports MP3 with correct BPM/Key/Genre + POPM star rating | TAGS-03 (SC #3) | Requires a running Rekordbox 6.x install; POPM star scale (51/102/153/204/255) is unverified against Rekordbox | Import a written MP3 into Rekordbox, confirm integer BPM, Camelot Key, Genre, and star rating render correctly |
| True power-loss mid-write leaves original intact | TAGS-02 (SC #2) | Real power loss cannot be simulated in unit tests; crash-safety is proven by the temp+rename invariant, but a kill-mid-write smoke check adds confidence | Kill the app process during a large batch Apply; relaunch; confirm no zero-byte or truncated source files and failed files remain in the pending queue |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (node-id3 install + tagWriter.test.ts + fixtures)
- [ ] No watch-mode flags
- [ ] Feedback latency < 8s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
