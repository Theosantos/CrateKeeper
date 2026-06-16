# Phase 5: Tag Writing & Rekordbox Compatibility - Context

**Gathered:** 2026-06-15
**Status:** Ready for planning

<domain>
## Phase Boundary

Write the metadata the Tagger has accumulated (Phase 4's `pending_tag_edits`
SQLite rows) directly into the audio files, atomically and in a
Rekordbox-compatible format. This is the *writer* that closes the loop the
Phase 4 editor opened.

**In scope:**
- Write tags into MP3 (ID3v2.3) and MP4/M4A/AAC files
- Atomic write (write-to-temp + rename) so a crash never corrupts the source
- Rekordbox-compatible frames: ID3v2.3, UTF-16, integer BPM (TBPM), Camelot
  Key (TKEY), genre (TCON), artist (TPE1), title (TIT2), comment (COMM), and
  rating → POPM byte
- An explicit user-triggered "Apply" surface that flushes pending edits
- Per-file success/failure reporting; failed files stay retryable
- Round-trip verification (read back with music-metadata) to prove the write

**Out of scope (deferred):**
- AIFF tag writing (ID3-in-FORM chunk — see Deferred)
- Rekordbox XML/collection export (already out of scope in REQUIREMENTS.md)
- Batch re-tag UI / full-library re-tagging beyond the pending queue
</domain>

<decisions>
## Implementation Decisions

### Write trigger & surface
- **D-01:** Writes are **explicit, user-triggered**, NOT write-on-Keep and NOT
  an automatic background queue. The Tagger keeps accumulating into
  `pending_tag_edits` exactly as today; a dedicated surface shows "N tags en
  attente" with an **Appliquer** action that writes all pending edits.
- **D-02 [informational]:** Rationale for D-01 (not an independently buildable
  decision): keeps the Phase 4 Undo model clean — the file is only touched at
  the final commit, so undo still operates purely on the DB intent store (no
  need to revert a file write). Mirrors the conversion mental model. Realized
  structurally by D-01's explicit-Appliquer design (writes only on Apply).
- **D-03:** Surface placement is Claude's discretion (see below), but the
  default expectation is an "Appliquer (N)" affordance reachable from the
  Tagger flow, with the count driven by `pending_tag_edits WHERE applied_at IS NULL`.

### Overwrite policy
- **D-04:** **Non-destructive.** Only fields that have a value in the pending
  edit are written; a field the user left blank/null does NOT touch the
  existing tag in the file. Never clear an existing frame because the card
  field was empty.

### Failure handling
- **D-05:** **Per-file, retryable.** A write failure (locked file, permissions,
  corruption) leaves that file's `applied_at` NULL so it stays in the pending
  queue and can be retried; the error is surfaced per file and the rest of the
  batch continues (conversion-style, not stop-on-first-error).

### Format scope
- **D-06:** **MP3 + MP4/M4A/AAC only** for v1. AIFF tag writing is deferred
  (consistent with AIFF preview already being unsupported in Phase 4).

### Claude's Discretion
- Exact UI placement of the "Appliquer" surface (Tagger banner vs a dedicated
  panel vs an Analyser indicator) — pick what fits the existing editorial
  dark-studio shell; reflect pending-vs-written status if cheap.
- Whether MP3 writes use node-id3 in-place + temp-rename, or a temp-copy
  strategy; whether MP4 writes go through ffmpeg `-map_metadata`/`-metadata`
  remux (atomic by nature since ffmpeg writes a new file). Carry the existing
  `presets.ts` ffmpeg-metadata pattern forward.
- Whether to reuse the `ConversionController` single-active/queue/heartbeat
  machinery or a simpler synchronous batch — the writer is lighter than
  conversion, so a simpler controller is acceptable.
- **Re-edit semantics:** `upsertEdit` currently preserves the old `applied_at`
  on update, so a re-edit of an already-written file would be skipped by a
  naive `applied_at IS NULL` filter. Decide whether the pending query should be
  `applied_at IS NULL OR updated_at > applied_at` to re-apply re-edits. Flag,
  don't silently pick.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & roadmap
- `.planning/REQUIREMENTS.md` §"Tag Writing" — TAGS-01 (write ID3v2.3 / MP4
  atoms), TAGS-02 (atomic temp+rename), TAGS-03 (Rekordbox compat: ID3v2.3,
  UTF-16, integer BPM, TKEY Camelot). Also TAGG-07 (rating → POPM).
- `.planning/ROADMAP.md` §"Phase 5" — goal + 3 success criteria.

### Carried-forward locked decisions (Phase 4)
- `.planning/phases/04-tagger-core/04-CONTEXT.md` — POPM byte mapping
  (1→51, 2→102, 3→153, 4→204, 5→255; 0/unset → omit POPM), ID3v2.3 lock,
  Key=TKEY Camelot, `pending_tag_edits` schema + `applied_at` contract,
  "Phase 5 reads pending WHERE applied_at IS NULL, writes atomically, sets
  applied_at".
- `.planning/phases/04-tagger-core/04-VERIFICATION.md` — Phase 4 deviations:
  BPM/Key not user-editable (but columns retained for Phase 5), so most
  pending edits carry genre/artist/title/comment/rating; bpm/key may be null.

### Stack / library guidance
- `CLAUDE.md` (project root) §"Recommended Stack" — node-id3 for MP3 writes
  (pure JS, ID3v2.3, covers TBPM/TKEY/TCON/POPM); MP4 tag writes via ffmpeg
  remux (`-c copy -metadata`), NOT a pure-JS MP4 atom writer.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/main/tagger/taggerRepo.ts` — `pending_tag_edits` with `applied_at`.
  NEEDS new methods: `listPendingWrites()` (applied_at IS NULL [or re-edit
  predicate]) and `markApplied(filePath, now)`.
- `src/main/conversion/controller.ts` — single-active controller with
  queue/progress/heartbeat/resume; template if the writer needs background
  progress. Likely simplified for the lighter write workload.
- `src/main/conversion/presets.ts:96` — already emits `-map_metadata 0` and
  `-id3v2_version 3`; the ffmpeg-metadata pattern to extend for MP4 writes.
- `src/main/conversion/ffmpegPath.ts` / `src/main/ffmpeg/path.ts` — asar-aware
  ffmpeg path resolution (reuse for MP4 writes).
- `src/main/conversion/tagRoundtrip.test.ts` — existing round-trip test
  pattern (write → read back with music-metadata → assert), reuse for TAGS-03.
- `music-metadata` (^11, installed) — read-back verification.
- Folder-allowlist gate `resolvesUnderRoot` + AUDIO_EXTS in
  `src/main/ipc/tagger.ts` — apply to any new write IPC channel.

### Established Patterns
- Typed IPC: shared `IpcChannels` const + repo factory + preload bridge
  (extend with a `tagger:apply-writes` / progress channel).
- Atomic-write expectation: ffmpeg remux already produces a new file; MP3
  in-place writes must add temp+rename to satisfy TAGS-02.

### Integration Points
- New write path reads `pending_tag_edits`, writes the file, sets `applied_at`.
- Renderer: new "Appliquer (N)" surface + per-file result feedback; the
  Analyser/Tagger may reflect pending-vs-written status.

### Missing dependency
- **node-id3 is NOT yet installed.** Phase 5 must add it (pure JS, no
  electron-rebuild) for MP3 ID3v2.3 writes.
</code_context>

<specifics>
## Specific Ideas

- POPM mapping is fixed (see canonical refs) — do not invent a new scale.
- Rekordbox compatibility must be validated early with a real round-trip
  (write → re-read → confirm ID3v2.3 + UTF-16 + integer TBPM + Camelot TKEY),
  ideally against an actual Rekordbox import as a manual checkpoint.
</specifics>

<deferred>
## Deferred Ideas

- **AIFF tag writing** — ID3 lives in a FORM chunk, not MP4 atoms; defer to a
  later phase (matches AIFF preview being unsupported).
- **Rekordbox XML / collection export** — already out of scope in
  REQUIREMENTS.md (file tags suffice for v1; Rekordbox reads ID3 natively).
- **Full-library batch re-tag UI** — beyond the pending-queue flush.

None of the above are in Phase 5 scope.
</deferred>

---

*Phase: 5-Tag Writing & Rekordbox Compatibility*
*Context gathered: 2026-06-15*
