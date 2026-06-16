# Phase 5: Tag Writing & Rekordbox Compatibility - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-15
**Phase:** 5-Tag Writing & Rekordbox Compatibility
**Areas discussed:** Write trigger, Blank fields, Failure handling, AIFF scope

---

## Write trigger & surface

| Option | Description | Selected |
|--------|-------------|----------|
| Explicit "Appliquer" button | Tagger keeps accumulating; a dedicated surface shows "N tags en attente" and writes all pending on demand. Keeps Phase 4 Undo clean; reuses ConversionController pattern. | ✓ |
| Immediate on each "Sauver" | Each Keep writes the file right away. Instant feedback, but Undo-after-Keep would have to revert an already-written file. | |
| Automatic background queue | Writes in the background as soon as there are unapplied edits. | |

**User's choice:** Explicit "Appliquer" button.
**Notes:** Confirms the Phase 4 "intent store → commit" design; the file is only mutated at the final commit so undo stays a pure DB operation.

---

## Blank fields (overwrite policy)

| Option | Description | Selected |
|--------|-------------|----------|
| Preserve existing | Only written fields are applied; a blank card field never touches the existing file tag. Non-destructive. | ✓ |
| Clear the tag | A blank field clears the corresponding file tag. | |

**User's choice:** Preserve existing.

---

## Failure handling

| Option | Description | Selected |
|--------|-------------|----------|
| Per-file + retryable | Failed file keeps applied_at NULL (stays in queue), error shown per file, batch continues. Conversion-style. | ✓ |
| Stop on first failure | Abort the whole batch at the first error. | |

**User's choice:** Per-file + retryable.

---

## AIFF scope

| Option | Description | Selected |
|--------|-------------|----------|
| Defer AIFF | Out of scope for v1, consistent with AIFF preview being unsupported. MP3 + M4A/AAC first. | ✓ |
| Include AIFF via ffmpeg | Attempt AIFF tag writes now (ID3-in-FORM chunk; higher technical risk). | |

**User's choice:** Defer AIFF.

---

## Claude's Discretion

- Exact UI placement of the "Appliquer" surface.
- MP3 write mechanism (node-id3 in-place + temp/rename vs temp-copy) and MP4 write via ffmpeg remux.
- Whether to reuse ConversionController or a simpler synchronous batch.
- Re-edit semantics: whether the pending query should re-apply edits where `updated_at > applied_at` (flagged for an explicit decision, not silent).

## Deferred Ideas

- AIFF tag writing (later phase).
- Rekordbox XML/collection export (already out of scope in REQUIREMENTS.md).
- Full-library batch re-tag UI beyond the pending-queue flush.
