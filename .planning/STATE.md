# Project State — DJ Utils

## Current Status
Phase: Not started
Last updated: 2026-05-28

## Project Reference
See: .planning/PROJECT.md (updated 2026-05-28)

**Core value:** Permettre à un DJ de passer de "bibliothèque en désordre" à "collection propre et taguée" sans quitter une seule interface.
**Current focus:** Phase 1 — Foundation

## Phase History
(empty — not started)

## Accumulated Context

### Key Decisions
- ID3v2.3 (not v2.4) required for Rekordbox compatibility — validate before Phase 5
- FFmpeg binary path must be handled via asarUnpack from Phase 1 onwards
- Strict Electron main/renderer split — all Node/FFmpeg calls go through IPC bridge via contextBridge preload
- Worker Threads for batch operations (scan, conversion) to keep UI non-blocking

### Known Risks
- FFmpeg asarUnpack misconfiguration can silently break conversion on packaged builds — test packaged build early
- ID3v2.4 writes will appear broken in Rekordbox — enforce v2.3 at the tag-writing layer

### Todos
(none yet)

### Blockers
(none)
