# Phase 3 — Discussion Log

**Date:** 2026-06-02
**Phase:** 03-conversion
**Mode:** discuss (default)

This log records what was asked, what was offered, and what the user selected. Audit trail only — downstream agents read CONTEXT.md, not this file.

---

## Gray areas selected for discussion

User chose to discuss ALL four offered:
- Sélection + déclenchement
- Format / bitrate config
- Sortie & conflits
- Reprise après interruption

(Concurrency and worker tuning were follow-ups added during discussion.)

---

## Area 1 — Sélection + déclenchement

**Q:** Comment l'utilisateur sélectionne les fichiers et lance la conversion ?

**Options presented:**
1. *(recommended)* Checkbox column dans Analyser + bouton "Convertir N fichiers" qui bascule vers Convertir
2. Vue Convertir dédiée avec liste de scans existants
3. Bouton "Tout convertir le scan" unique

**Selected:** Option 1 (Recommended).

**Notes:**
- Selection state lives in `useScanStore` (per-scan) — not in conversion store, so user can toggle views without losing selection.
- Header checkbox = select-all-in-current-scan.
- Convertir view = config + progress; no re-selection there.

---

## Area 2 — Format / bitrate config

**Q1:** Format et bitrate de sortie ?

**Options:**
1. *(recommended)* Presets + custom
2. MP3 320 fixe
3. Par-batch volatile

**Selected:** Option 1 (Recommended).

**Q2 (follow-up):** Liste des presets ?

**Options:**
1. *(recommended)* MP3 320, MP3 V0, AAC 256, FLAC, WAV
2. + Opus 192 et AIFF
3. MP3 320 + FLAC seulement

**Selected:** Option 1 (5 presets).

**Notes:**
- Default = MP3 320 CBR.
- Persistence in `settings` table key `conversion.lastPreset`.
- Custom = inline form (codec dropdown + bitrate + sample rate override).
- Warning dialog if input format == target format.

---

## Area 3 — Sortie & conflits

**Q:** Où écrire les fichiers convertis et que faire en cas de conflit ?

**Options:**
1. *(recommended)* Sous-dossier `/converted` + skip
2. Même dossier + suffix
3. User choisit + prompt overwrite

**Selected:** Option 1 (Recommended).

**Notes:**
- Refined to `{rootFolder}/converted/{preset-slug}/` to separate outputs by preset.
- Skip + log as error row (status: `skipped`, reason: `output_exists`) — natural auto-resume property.
- Folder allowlist gate enforced (output dir must resolve under rootFolder).

---

## Area 4 — Reprise après interruption (CONV-05)

**Q:** Stratégie de reprise ?

**Options:**
1. *(recommended)* Auto-detect + prompt
2. Auto-resume silencieux
3. Resume manuel via UI

**Selected:** Option 1 (Recommended).

**Notes:**
- DB-backed: `conversions` + `conversion_files` tables.
- Crash detection: heartbeat field bumped every N seconds; on boot, rows with `status='running'` AND `heartbeat_at` > 30s old are marked `crashed`.
- Distinction: crashed batches ARE resumable; cancelled batches (user clicked Stop) are NOT.

---

## Follow-up Q — Concurrence intra-batch

**Q:** Combien de fichiers ffmpeg en parallèle ?

**Options:**
1. *(recommended)* Adaptatif `min(cpus-1, 4)`
2. Séquentiel strict
3. Slider config user

**Selected:** Option 1 (Recommended).

**Notes:**
- Batch-level remains single-active (mirror of scan).
- Intra-batch: worker manages a pool of ffmpeg children.

---

## Deferred ideas captured

- Multi-batch parallelism
- Per-batch output dir override
- Conflict resolution UI (overwrite/rename prompts)
- Drag-and-drop from outside the library
- Conversion presets editor UI
- Client-side bitrate/codec validation in Custom form
- GPU / hardware encoders

All noted in CONTEXT.md `<deferred>`.

---

## Claude's discretion (not asked)

These were settled without explicit user question because they follow established Phase 1-2 patterns or are technical/researcher-tier decisions:

- IPC namespace = `conversion.*` (mirror `scan.*` shape)
- Worker = pure Node, no Electron import (carry-forward)
- AUDIO_EXTS lock (carry-forward, no expansion)
- ID3v2.3 enforcement for MP3 target (carry-forward from Phase 5 lock)
- Worker buffering tuning (BATCH_SIZE=20, BATCH_MS=200) — researcher may revise
- Error row schema = `{file_path, status, error_message}` — minimal sufficient for CONV-04
- Tag preservation via ffmpeg flags (not pre-read/post-write — that's Phase 5)
- Heartbeat threshold = 30s — researcher to confirm vs typical file conversion time
