---
phase: 3
slug: conversion
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-03
---

# Phase 3 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest 4.x (carry-forward from Phase 1/2) |
| **Config file** | `vitest.config.ts` |
| **Quick run command** | `npm test -- --run` |
| **Full suite command** | `npm test -- --run` |
| **Estimated runtime** | ~1s (current 90 tests run in 700ms) |
| **Build command** | `npm run build` |

---

## Sampling Rate

- **After every task commit:** Run `npm test -- --run`
- **After every plan wave:** Run `npm test -- --run` + `npm run build`
- **Before `/gsd-verify-work`:** Full suite must be green AND production build must emit `out/main/index.js`, `out/main/workers/scanWorker.js`, AND `out/main/workers/conversionWorker.js`
- **Max feedback latency:** ~10 seconds (test + build combined)

---

## Per-Requirement Verification Map

| Requirement | Test Type | Verification |
|-------------|-----------|--------------|
| **CONV-01** (batch select + launch) | integration | `scan.test.ts`-style: useScanStore exposes selectedFilePaths; ScanToolbar renders "Convertir N fichiers" when N>0; clicking the button transitions to Convertir view with selection in `useConversionStore` |
| **CONV-02** (configurable format/bitrate) | unit + integration | Preset registry has 5 entries with correct codec/bitrate/ext; Custom form validation; settings persistence via existing settingsRepo; default = MP3 320 CBR |
| **CONV-03** (progress per-file + global) | integration | conversionWorker emits batched progress events; useConversionStore aggregates per-file percent + computes global from completed/total |
| **CONV-04** (errors per-file, batch continues) | integration | conversionWorker emits error rows without aborting; ConversionController persists `status=error` rows; batch transitions to `done` only when every file in terminal state |
| **CONV-05** (resume after interrupt) | integration | conversionRepo.findResumable() returns rows with stale heartbeat; conversion:list-resumable handler exposes it; resume re-queues only non-terminal files |
| **CONV-06** (tag preservation) | integration | ffmpeg flag construction emits `-map_metadata 0` always, `-id3v2_version 3` when target is MP3; fixture-based round-trip test for MP3→MP3 and FLAC→MP3 reading tags pre/post via music-metadata |

### Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Real batch conversion on ~50+ files | CONV-01/03 | Requires real audio files + native ffmpeg execution timing | `npm run dev`, sélectionner ~50 fichiers, lancer batch MP3 320, observer progression smooth, dossier `converted/mp3-320/` rempli |
| Crash → resume flow | CONV-05 | Requires killing the Electron process mid-batch | Lancer batch ~100 fichiers, killall Electron mid-batch, relancer app, vérifier prompt "Reprendre N fichiers ?" |
| Rekordbox tag round-trip | CONV-06 | Requires actual Rekordbox or comparable DJ software import | Importer un MP3 converti dans Rekordbox, vérifier Genre/BPM/Key sont lus |
| Output dir behavior on packaged build | CONV-01/06 | ffmpeg-static path rewrites require packaged build | Phase 6 verification — `electron-builder --dir`, lancer le binaire, conversion réelle |

---

## Wave 0 Requirements

- [ ] `src/main/workers/__fixtures__/tagged-rekordbox.mp3` — MP3 with full Rekordbox tag set (Genre/TKEY/TBPM/TIT2/TPE1/COMM) for tag-round-trip test
- [ ] `src/main/workers/__fixtures__/sample-with-tags.flac` — FLAC with Vorbis tag set for FLAC→MP3 round-trip test
- [ ] electron.vite.config.ts updated with `conversionWorker` entry → `out/main/workers/conversionWorker.js`

---

## Validation Sign-Off

- [ ] Every CONV-NN has at least one automated test command
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 fixtures present before tag-preservation tests run
- [ ] No watch-mode flags in CI commands
- [ ] Feedback latency < 10s
- [ ] `nyquist_compliant: true` set in frontmatter after planner completes

**Approval:** pending
