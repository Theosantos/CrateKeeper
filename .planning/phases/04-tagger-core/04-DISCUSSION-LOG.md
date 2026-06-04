# Phase 4 — Discussion Log

**Date:** 2026-06-04
**Phase:** 04-tagger-core
**Mode:** discuss (default)

Audit trail of the discuss-phase pass. Downstream agents read CONTEXT.md, not this file.

---

## Gray areas selected for discussion

All four offered:
- Source de la file (queue source)
- Frontière Phase 4 ↔ Phase 5
- Genre presets (TAGG-04)
- UX de la carte + preview audio

---

## Area 1 — Queue source

**Q:** Source de la file Tagger — d'où viennent les fichiers ?

**Options:**
1. *(recommended)* Dernier scan Phase 2 auto
2. Bouton "Charger un dossier" → scan inline
3. Liste de scans passés + sélection

**Selected:** Option 1.

**Notes:**
- Tagger reads from `scans` + `scanned_files` (Phase 2 tables).
- Filter: `hasGenre = 0 OR hasBpm = 0 OR hasKey = 0`.
- No re-scan from Tagger — Analyser owns scanning.
- Empty state when no scan exists: "Lance un scan dans l'Analyser".

---

## Area 2 — Phase 4 ↔ Phase 5 boundary

**Q:** Où stocker les éditions Keep en attendant Phase 5 ?

**Options:**
1. *(recommended)* DB `pending_tag_edits` table
2. Mémoire seule + commit Phase 5 sync
3. Phase 5 inline + buffer mémoire périodique

**Selected:** Option 1.

**Notes:**
- New SQLite table: `pending_tag_edits(file_path PK, genre, bpm, key, artist, title, comment, rating, updated_at, applied_at)`.
- `applied_at` is set by Phase 5 once the ID3 write succeeds.
- Phase 4 never touches the audio file — pure intent store.
- Survives crashes / restarts naturally.

---

## Area 3 — Genre presets

**Q:** Quelle liste pour les slots 1-9 ?

**Options:**
1. Hardcodé v1, 9 slots DJ classiques
2. Hardcodé mais user-overridable via settings
3. *(recommended)* Top-9 des genres existants dans le scan

**Selected:** Hybrid — top-9 from library, hardcoded fallback when library is small/untagged.

**Notes:**
- Query: `SELECT genre, COUNT(*) FROM scanned_files WHERE genre IS NOT NULL GROUP BY genre ORDER BY COUNT(*) DESC LIMIT 9`.
- Fallback list: House, Techno, Afro House, Melodic, Disco, Hip-Hop, Funk, Deep, Electronica.
- If library has <9 distinct genres, fill remaining slots from the fallback (deduped, library order first).
- Refreshed each Tagger mount (no cache).
- User-editable preset list deferred.

---

## Area 4 — Card UX + audio preview

**Q:** Comportement de la carte + preview ?

**Options:**
1. *(recommended)* Preview début+30s, slide horizontal, mute toggle
2. Preview milieu (offset 33%)
3. Sans animation, preview début, mute toggle

**Selected:** Option 1.

**Notes:**
- Preview: HTML `<audio>` element, 30s loop from 0:00, auto-play.
- Mute toggle persistent via `settings.tagger.muteEnabled`.
- All editable fields visible on the card at once (no tabs).
- Slide-horizontal anim ~250ms on Keep (left) / Skip (right).
- Keyboard: ← Keep, → Skip, 1-9 preset, Cmd-Z undo, Space play/pause, M mute.

---

## Claude's discretion (not asked)

These were settled without explicit user question because they follow Phase 1-3 patterns or are technical/researcher-tier:

- IPC namespace = `tagger.*` (mirror `scan.*`/`conversion.*`)
- `taggerRepo` factory + lazy singleton in `connection.ts` (mirror)
- Lazy `require('electron')` in IPC registration
- POPM mapping: 1=51 / 2=102 / 3=153 / 4=204 / 5=255 (Rekordbox/Mp3tag standard) — Phase 5 applies
- Undo storage: in-memory only, 1 level
- Session resume identity: file PATH (not queue index) — robust to library changes
- Keyboard handler: `document.addEventListener('keydown')` in TaggerView useEffect
- Empty state copy: "Lance un scan dans l'Analyser pour démarrer"
- Star UI: 5 clickable stars, no keyboard shortcut (conflicts with genre 1-9)
- Resume update debounce: 500ms (researcher to confirm)

---

## Deferred ideas captured

- Phase 5 file writes (own phase)
- User-editable genre preset list (settings UI)
- Multi-level undo
- Star-hotkey shortcuts
- Touch/trackpad swipe gesture
- "Recommencer la file" reset button
- Filter UI (show all / only-incomplete / by-genre)
- Bulk re-tag from template
- Cue point detection for preview offset
- File-change-since-scan conflict detection

All noted in CONTEXT.md `<deferred>` and `<open_questions_for_research>`.
