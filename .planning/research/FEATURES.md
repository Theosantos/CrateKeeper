# Features Research — DJ Utils

**Researched:** 2026-05-28
**Confidence:** MEDIUM (training knowledge, web search unavailable — flag for validation against live Rekordbox docs)

---

## Table Stakes

Features DJs expect. Missing = product feels incomplete or untrustworthy.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| File analysis: format, bitrate, sample rate, duration | Every DJ audits their library before a gig | Low | ffprobe covers this fully |
| Batch conversion with progress bar | Conversions take minutes; no feedback = feels broken | Low-Med | FFmpeg progress via stderr parsing |
| Per-file error reporting after conversion | Knowing which files failed and why | Low | Critical — silent failures destroy trust |
| Resume / skip-already-converted | Re-running on a large library is common | Med | Check output file existence + match target spec |
| Write Title, Artist, Album, Genre, BPM, Key, Comment to ID3v2/MP4 | These are the fields Rekordbox surfaces in its browser | Low | Use `node-id3` or `music-metadata` + writer |
| Auto-play audio snippet on card load (Tinder tagger) | Can't tag what you can't hear | Med | HTML5 Audio, seek to mid-file, 15-30s snippet |
| Keep / Skip (swipe or button) | Core Tinder mechanic | Low | Keyboard shortcuts mandatory (→ keep, ← skip) |
| Genre quick-tag buttons (configurable list) | Clicking a genre should be one action, not typing | Low | User-configurable list stored in app config |
| Inline BPM + Key entry | DJs always have BPM/key in mind while listening | Low | Number input for BPM, text or select for key |
| Undo last action | Mis-swipe is guaranteed; no undo = rage quit | Low | Single-level undo minimum |
| Persistent session (resume where you left off) | Libraries have thousands of files; can't tag in one sitting | Med | Track index + "untagged" queue persisted to disk |

---

## Differentiators

Features that distinguish DJ Utils. Not universally expected, but high value for target users.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Tinder-style tagger as primary UX | No existing tool has this flow — Rekordbox, Traktor, Lexicon are all list/grid UIs | Med | The core differentiator per PROJECT.md; execute it exceptionally |
| Keyboard-only tagging flow | DJs think in gestures; full keyboard nav makes tagging 3-5x faster | Low | Arrow keys, number keys for quick genres, Space to replay |
| "Untagged" smart queue | Automatically surfaces files missing BPM, key, or genre | Med | Filter by missing fields; clears as you work |
| Color/energy label support | Rekordbox supports color tags; energy 1-10 is common DJ workflow | Med | Map to ID3 POPM (popularimeter) or comment field; see compatibility notes |
| Snippet seek position (configurable) | Some DJs prefer the drop; others want the intro | Low | Let user set seek % per session (e.g., 33% into track) |
| Batch analysis diff view | Show which files are below a bitrate floor (e.g., flag < 256kbps) | Low | Filter/sort by quality in analysis table |
| Convert-then-tag pipeline | Convert a folder, immediately queue converted files for tagging | Med | Natural workflow: clean library first, then curate |

---

## Anti-Features

Things to deliberately NOT build in v1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Automatic BPM detection | CPU-heavy, accuracy varies, adds heavy dependency (essentia/aubio) | Manual BPM entry; note it as v2 candidate |
| Automatic key detection | Same cost as BPM auto-detect; Mixed In Key does this better than any open-source lib | Manual key entry or import from existing tags |
| Rekordbox XML export | Added complexity, fragile format versioning, tags-in-files is sufficient | Write standard ID3; Rekordbox reads them natively on import |
| Cloud sync / remote storage | Out of scope per PROJECT.md; adds auth, backend, cost | Local filesystem only |
| Full DJ library browser (like Rekordbox Explorer) | Scope creep; trying to replace Rekordbox instead of complement it | Three focused tools; no general browser |
| Waveform display | High complexity (audio decoding + canvas rendering), not needed for tagging flow | Play button + seek bar is sufficient |
| Playlist management | Rekordbox handles this; not in the complement-not-replace strategy | Out of scope |
| Audio fingerprinting / duplicate detection | Useful but complex; beets/MusicBrainz Picard do this well already | Defer; maybe v3 |

---

## Rekordbox Compatibility Notes

**Confidence: MEDIUM** — Based on training knowledge of Rekordbox 6.x behavior. Validate against Pioneer DJ developer docs before writing the tag layer.

### What Rekordbox reads from ID3v2 tags (MP3)

| ID3 Frame | Rekordbox Field | Notes |
|-----------|----------------|-------|
| `TIT2` | Title | Standard |
| `TPE1` | Artist | Standard |
| `TALB` | Album | Shown in browser |
| `TCON` | Genre | Standard |
| `TBPM` | BPM | Rekordbox reads this; displays with 1 decimal |
| `TKEY` | Musical Key | Reads Camelot notation (e.g., `8B`) and Open Key; write standard musical key (e.g., `Abm`) as fallback |
| `COMM` | Comments | Free-form; Rekordbox surfaces this |
| `POPM` | Rating/Energy | Maps to Rekordbox star rating (0-255 scale → 0-5 stars); `popm@Windows Media Player` is the common popularimeter email used |
| `TIT1` | Grouping | Rekordbox shows Grouping; useful for energy labels or sub-genre |
| `TXXX:ENERGY` | Custom energy field | Some workflows use TXXX frames; Rekordbox may not surface these directly |

### What Rekordbox does NOT read from ID3 (stores in its own database)

- Cue points (hot cues, memory cues) — stored in Rekordbox's internal SQLite db only, not in ID3 tags (unless you use the XML export/import workflow)
- Loops — same as cue points
- Grid alignment — internal only
- Color labels — Rekordbox color tags are stored in its database; no standard ID3 mapping. The `GRP1` frame (iTunes grouping) is sometimes used as a workaround, but it's not reliable across versions.

### For MP4/AAC files

- Use `©nam` (title), `©ART` (artist), `©alb` (album), `©gen` (genre), `tmpo` (BPM as integer), `©key` (key)
- Rating: `rtng` atom (iTunes rating, 0-100 or 0-255 depending on tool)
- Rekordbox 6+ reads these natively on import

### Key Compatibility Decision

Write `TBPM` as an integer string (e.g., `"128"` not `"128.0"`) — Rekordbox 6 handles both but some older Pioneer hardware firmware does not handle decimals gracefully.

Write `TKEY` in standard notation (e.g., `"Abm"`, `"C#"`) — Rekordbox will convert to Camelot internally if its key detection agrees.

---

## Key Findings

1. **The Tinder tagger is the real product.** Batch analysis and conversion are solved problems (ffprobe, FFmpeg). The gamified tagging flow with audio preview is the differentiator. Every design decision should optimize the speed of the tag-listen-decide loop.

2. **Keyboard shortcuts are not optional.** Power users (DJs with 5,000+ tracks to tag) will abandon the app if every action requires a mouse click. Arrow keys for keep/skip, number keys for genre slots, Space for replay — these must be in v1.

3. **Rekordbox reads standard ID3 frames.** Title, Artist, Genre, BPM (TBPM), Key (TKEY), Comment (COMM), and Rating (POPM) are all read on import. Cue points and color labels are NOT in ID3 — do not promise Rekordbox cue point writing in v1.

4. **Undo is table stakes, not a nice-to-have.** Mis-swipes happen constantly in fast-tagging sessions. Single-level undo (last action) is the minimum; a full session history would be ideal but may be v2.

5. **Energy / rating field via POPM is the highest-value "extra" tag.** Most DJs use a 1-5 energy scale. Writing this to POPM means Rekordbox (and iTunes, Windows Media Player) can surface it as star rating. This is low implementation cost and high DJ value.

6. **Persistent session / resume is critical for large libraries.** A user with 3,000 untagged files cannot tag them in one sitting. The app must remember position in the queue and which files have been processed.

7. **The "convert-then-tag" pipeline is a natural workflow accelerator.** Running conversion first normalizes the library (all MP3 320kbps), then the tagger queue pulls from the converted output. This reduces cognitive overhead and is worth designing the UX around.

8. **Lexicon DJ and beets fill different niches.** Lexicon syncs library data between DJ apps (Rekordbox ↔ Traktor ↔ Serato) — not a competitor. Beets is a CLI auto-tagger using MusicBrainz — targets a different user (developer/audiophile, not DJ). Mixed In Key is BPM/key analysis only. None offer the tagging UX this app targets.
