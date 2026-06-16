---
status: partial
phase: 05-tag-writing-rekordbox-compatibility
source: [05-VERIFICATION.md]
started: 2026-06-16T12:15:00Z
updated: 2026-06-16T12:15:00Z
---

## Current Test

[awaiting human testing]

## Tests

### 1. Mp3tag tag visibility (SC #1, TAGS-01)
expected: After a Keep action in the Tagger and clicking Appliquer, open the written MP3 in an external tool (e.g. Mp3tag). Artist, Title, Genre, BPM, Key, Comment, and star rating all show the edited values exactly as entered.
result: [pending]

### 2. Crash-safety under kill-mid-write (SC #2, TAGS-02)
expected: During a large Appliquer batch, force-kill the app process mid-write (e.g. `kill -9` the Electron PID), then relaunch. No zero-byte or truncated source files exist; files not yet written still appear in the pending queue with count unchanged (only successfully written files have applied_at set).
result: [pending]

### 3. Rekordbox import + POPM star scale (SC #3, TAGS-03)
expected: Write a file with a 4-star rating via Tagger + Appliquer, then import the MP3 into Rekordbox 6.x. Integer BPM, Camelot Key, and Genre display correctly and the star rating shows 4 stars. If Rekordbox shows a different star count, flag the POPM byte mapping (204 → 4 stars) for revision — this is the A3 unverified assumption from RESEARCH.md (Open Question #2).
result: [pending]

## Summary

total: 3
passed: 0
issues: 0
pending: 3
skipped: 0
blocked: 0

## Gaps
