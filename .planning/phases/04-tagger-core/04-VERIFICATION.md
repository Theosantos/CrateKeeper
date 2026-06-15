# Phase 4 — Tagger Core — Verification

**Verdict:** PASS-WITH-NOTES
**Date:** 2026-06-15
**Branch:** phase-04-tagger
**Gates:** `npm test` → 479/479 green · `npm run build` (typecheck + vite) → green

Verification was performed inline by the orchestrator (the spawned gsd-verifier
lost its socket mid-run after 38 tool calls; tests/build re-run and requirements
re-traced directly).

## Goal

> Users can work through a queue of untagged files one by one — hearing a
> preview, editing metadata inline, keeping or skipping — with session resume
> and undo.

Achieved. The full keep/skip/undo/resume loop is implemented and tested
end-to-end ([TaggerEndToEnd.test.tsx](../../../src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx)).

## Success criteria

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | Only files missing Genre/BPM/Key are queued | PASS | `scanRepo.listIncompleteFiles` filters `has_genre=0 OR has_bpm=0 OR has_key=0` ([scanRepo.ts:38](../../../src/main/scan/scanRepo.ts)); fed by `tagger:load-queue` |
| 2 | Card auto-plays a preview + shows name & existing tags | PASS (deviated) | Auto-play on `canplay` ([AudioPreview.tsx](../../../src/renderer/src/components/tagger/AudioPreview.tsx)); existing tags shown as read-only chips ([TaggerCard.tsx:97](../../../src/renderer/src/components/tagger/TaggerCard.tsx)). **Deviation:** fixed 30s window replaced by full-track waveform + seek (see below) |
| 3 | →/Skip and ←/Keep via keyboard + click | PASS | `useTaggerKeyboard` routes ArrowLeft→Keep, ArrowRight→Skip ([useTaggerKeyboard.ts:39](../../../src/renderer/src/hooks/useTaggerKeyboard.ts)); buttons wired in TaggerCard |
| 4 | Genre quick-button / 1-9 preset | PASS | `GenrePresetBar` + keyboard `1-9 → onPreset(n)` ([useTaggerKeyboard.ts:8](../../../src/renderer/src/hooks/useTaggerKeyboard.ts)); presets via `tagger:get-genre-presets` |
| 5 | Inline edit of fields (no modal) | PASS (narrowed) | Genre/Artist/Title/Comment/Rating edited inline on the card. **Deviation:** BPM & Key inputs removed by user decision (see below) |
| 6 | Artist/Title split suggestion on " - " | PASS | `splitDetection.ts` offers the split AND strips the audio extension first ([splitDetection.ts:29](../../../src/renderer/src/components/tagger/splitDetection.ts)) — fixes the `.m4a`-in-title bug reported during UAT |
| 7 | Undo reverses last Keep/Skip | PASS | `useTaggerStore.undo` + `lastAction` state machine; Cmd/Ctrl-Z routed via keyboard, Annuler button + reversed slide ([TaggerView.tsx:124](../../../src/renderer/src/views/TaggerView.tsx)) |
| 8 | Session resume at same file after relaunch | PASS | Debounced `tagger:set-session` (500ms) + `beforeunload` flush; mount-time `getSession` jumps `currentIndex` by file-path identity ([TaggerView.tsx:59](../../../src/renderer/src/views/TaggerView.tsx)) |

## Requirements coverage (TAGG-01..TAGG-10)

All mapped requirements are implemented across the three plans (load queue,
preview, keyboard, presets, inline edit, split, mute→playpause, undo, resume,
persistence). Tag **writing** to files is explicitly out of scope for Phase 4
(deferred to Phase 5).

## Approved deviations (NOT gaps)

1. **BPM & Key are no longer editable in the card.** User decision: Rekordbox
   already detects BPM/key reliably; tagging them by ear here adds no value.
   The DB schema and `SaveTagEditInput` still carry `bpm`/`key` columns
   (forward-compat for Phase 5 import); existing values render as read-only
   chips. Original criterion 5 is intentionally narrowed.
2. **Fixed 30s preview window → full-track SoundCloud waveform.** Peaks are
   decoded in the **main process** via ffmpeg (`tagger:get-waveform`,
   [waveform.ts](../../../src/main/tagger/waveform.ts)) and drawn on a canvas
   with click-to-seek; auto-play preserved. The mute toggle was replaced by a
   play/pause control.
3. **Playback architecture hardened during UAT.** Custom `cratekeeper://`
   protocol with partial-range reads serves the `<audio>` element
   ([audioProtocol.ts](../../../src/main/tagger/audioProtocol.ts)); the renderer
   does **no** Web Audio decoding (that caused native renderer crashes — see the
   `fix(04-03)` commit chain). A renderer ErrorBoundary + main-process
   `render-process-gone` logging were added as safety nets.

## Notes / follow-ups for Phase 5

- `pending_tag_edits.applied_at` stays NULL until Phase 5 writes tags to files;
  a Phase-4 re-edit must not clear it (LOCKED in 04-CONTEXT.md). Honored by
  `upsertEdit` omitting `applied_at` from the UPDATE clause.
- Edits are persisted to SQLite only; nothing is written to audio files yet.
  Phase 5 (ID3v2.3 via node-id3, MP4 via ffmpeg) consumes `pending_tag_edits`.
- The renderer CSP still carries `connect-src cratekeeper:` and the scheme is
  `corsEnabled` — both are now unused (no renderer fetch after moving the
  waveform to main). Harmless; can be trimmed in a future cleanup.
