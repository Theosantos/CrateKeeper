---
phase: 4
slug: tagger-core
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-04
---

# Phase 4 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (carry-forward from Phases 1-3) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~1.5s (current 284 tests in ~1.2s, +~30 new tests budgeted) |
| **Build command** | `npm run build` |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run` + `npm run build`
- **Before `/gsd-verify-work`:** Full suite green AND production build emits `out/main/index.js` (workers/scanWorker.js + workers/conversionWorker.js still bundled — no new worker for Phase 4)
- **Max feedback latency:** ~10 seconds

---

## Per-Requirement Verification Map

See `04-RESEARCH.md` § Validation Architecture for the full per-test breakdown.

| Requirement | Test Type | Primary Coverage |
|-------------|-----------|------------------|
| **TAGG-01** (queue from latest scan, filtered) | unit + integration | scanRepo.findLatestScan; tagger:load-queue handler; useTaggerStore initial state |
| **TAGG-02** (card + 30s auto-play preview) | unit (RTL) + integration | TaggerCard renders chips; AudioPreview wires `<audio>` + timeupdate reset; custom protocol path-allowlist + AUDIO_EXTS gates; AIFF fallback message |
| **TAGG-03** (Keep/Skip via button or ← / →) | unit | useTaggerStore.keep + skip actions; useTaggerKeyboard input-focus gate |
| **TAGG-04** (genre presets 1-9) | unit + integration | tagger:get-genre-presets top-9 query + fallback merge; GenrePresetBar buttons; keyboard 1-9 |
| **TAGG-05** (BPM + Key inline) | unit (RTL) | Integer BPM input parses + clamps; free-text Camelot Key field |
| **TAGG-06** (Genre/Artist/Title/Comment inline) | unit (RTL) | All four field inputs update store; commit on Keep |
| **TAGG-07** (Rating 1-5 → POPM forward) | unit | RatingStars 1-5 click; INTEGER 1-5 in pending_tag_edits.rating |
| **TAGG-08** (Artist/Title split suggestion) | unit | suggestSplits() pure helper; ArtistTitleSplit banner shows when artist empty AND title matches separators; one-click apply |
| **TAGG-09** (Undo 1 niveau) | unit | useTaggerStore undo state machine — undo after Keep restores prior pending row (or deletes); undo after Skip rewinds index; double-undo disabled |
| **TAGG-10** (Resume on relaunch) | unit + integration | tagger_session 500ms debounce; beforeunload flush; mount-time restoration by file_path; library-change resilience |

### Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Per-format audio playback smoke test (MP3, FLAC, M4A, AAC, WAV, OGG, Opus play; AIFF shows fallback) | TAGG-02 | Native Chromium media decoders + custom protocol can only be exercised in a real Electron renderer | `npm run dev`, pointer rootFolder at a folder with 1 fixture per format, open Tagger, verify each file's preview plays (or shows AIFF fallback for `.aiff`/`.aif`) |
| Slide animation perception on Keep / Skip + audio non-stutter mid-animation | TAGG-02 + TAGG-03 | Visual + auditory perception | Click Keep on a card with audio playing — confirm slide-left animation completes + audio stops cleanly (no buffer noise on unload) |
| End-to-end session resume across app quit | TAGG-10 | Requires Cmd+Q + relaunch of the packaged or dev Electron process | Tag 3 files, Cmd+Q while card #4 is visible, relaunch app, open Tagger, confirm card #4 is the one displayed |
| Keyboard shortcuts don't fire while typing in BPM / Key / Comment inputs | TAGG-03 + TAGG-04 | Focus state interaction with global keydown handler | Focus BPM input, type "120" — confirm "1" and "2" do NOT swap genre presets |
| Top-9 genre presets reflect the user's real library (or fall back to hardcoded list) | TAGG-04 | Requires a real scanned library | Open Tagger on a scanned library; verify slots 1-9 = the top genres in that library, padded from the fallback list (House → Electronica) only if library has <9 distinct genres |

---

## Wave 0 Requirements

- [ ] Audio fixture per format under `src/main/tagger/__fixtures__/`: tagged-incomplete.mp3, tagged-incomplete.flac, tagged-incomplete.m4a, untagged.wav, etc. (small ~10s clips ok)
- [ ] Custom protocol scheme registration covered by `src/main/tagger/audioProtocol.test.ts` (mocked `request` object — verify allowlist + extension gate)
- [ ] `pending_tag_edits` and `tagger_session` schemas migrated via `initTaggerSchema(db)` in the existing connection.ts lazy-singleton pattern

---

## Validation Sign-Off

- [ ] Every TAGG-NN has at least one automated test command
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 fixtures present before AudioPreview / custom-protocol tests run
- [ ] No watch-mode flags in CI commands
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter after planner completes

**Approval:** pending
