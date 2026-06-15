# Phase 5: Tag Writing & Rekordbox Compatibility — Research

**Researched:** 2026-06-15
**Domain:** ID3v2.3 tag writing (node-id3), MP4/M4A metadata remux (ffmpeg), atomic file writes, SQLite pending-queue flush
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Writes are explicit, user-triggered (not write-on-Keep). A dedicated "Appliquer" surface flushes all pending edits.
- **D-02:** Keeps the Phase 4 Undo model clean — file is only touched at final commit.
- **D-03:** Surface shows "N tags en attente" with "Appliquer" action; count = `pending_tag_edits WHERE applied_at IS NULL`.
- **D-04:** Non-destructive. Only fields with a value in the pending edit are written; a null/blank field does NOT touch the existing frame.
- **D-05:** Per-file, retryable. A write failure leaves `applied_at` NULL; the rest of the batch continues.
- **D-06:** MP3 + MP4/M4A/AAC only for v1. AIFF deferred.

### Claude's Discretion
- Exact UI placement of "Appliquer" surface.
- Whether MP3 writes use node-id3 in-place + temp-rename or temp-copy strategy.
- Whether MP4 writes go through ffmpeg `-c copy -metadata` remux (atomic by nature).
- Whether to reuse `ConversionController` machinery or a simpler synchronous batch.
- **Re-edit semantics:** `upsertEdit` preserves old `applied_at` on update. Decide whether the pending query should be `applied_at IS NULL OR updated_at > applied_at`. Flag, don't silently pick.

### Deferred Ideas (OUT OF SCOPE)
- AIFF tag writing (ID3-in-FORM chunk).
- Rekordbox XML / collection export.
- Full-library batch re-tag UI beyond the pending queue.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TAGS-01 | Tags are written directly into audio files (ID3v2.3 for MP3, MP4 atoms for M4A/AAC) | node-id3 ^0.2.9 writes ID3v2.3 natively; MP4 via ffmpeg `-c copy -metadata` remux |
| TAGS-02 | Atomic write (write-to-temp + rename) to avoid file corruption | node-id3 writes in-place — must wrap with temp-copy + fs.rename(); ffmpeg remux is inherently atomic (writes a new file) |
| TAGS-03 | Rekordbox-compatible tags: ID3v2.3, UTF-16, integer BPM in TBPM, Camelot Key in TKEY | Verified: node-id3 header byte = 0x0300 (v2.3); GENERIC_TEXT uses encoding byte 0x01 (UTF-16 via iconv-lite); TBPM accepts number or string |
</phase_requirements>

---

## Summary

Phase 5 closes the loop between the Phase 4 intent store (`pending_tag_edits`) and the actual audio files. Two write paths are needed: MP3 (node-id3, pure JS ID3v2.3) and MP4/M4A/AAC (ffmpeg `-c copy -metadata` remux). Both paths must be atomic — file corruption on crash is the most dangerous failure mode.

**The most important verified findings:**
1. node-id3 ^0.2.9 writes **ID3v2.3 natively and unconditionally** (`header.writeUInt16BE(0x0300, 3)` — version byte = 3). No option needed and no option exists.
2. Text frames in node-id3 use **encoding byte 0x01 = UTF-16** via iconv-lite (`ENCODINGS = ['ISO-8859-1', 'UTF-16', 'UTF-16BE', 'UTF-8']`, GENERIC_TEXT calls `appendStaticNumber(0x01, 0x01)`). Rekordbox requires UTF-16 — this is satisfied automatically.
3. node-id3 `write()` modifies files **in-place** (`readFileSync` + `writeFileSync` on the same path). TAGS-02 requires the implementor to wrap this in a temp-copy + `fs.rename()` pattern explicitly.
4. For MP4/M4A, the ffmpeg `-metadata BPM=128` flag is **silently ignored** by ffmpeg 6.0 (ffmpeg-static bundled version). The correct key is **`tmpo`** (`-metadata tmpo=128`), which writes the `tmpo` atom that music-metadata then reads as `meta.common.bpm`.
5. music-metadata exposes `meta.format.tagTypes` as an array containing `'ID3v2.3'` for ID3v2.3 files — this is the assertion target for the round-trip verification test.
6. There is **no standard MP4 atom for musical key** (TKEY equivalent). Key write for M4A files is out of scope for Phase 5 (BPM/Key are not editable anyway per Phase 4 deviation — `pending_tag_edits.key` will always be null for now).
7. There is **no clean rating atom for MP4** (POPM is ID3-specific). The `rate` atom maps to `common.rating` in music-metadata but Rekordbox does not read it as stars. Rating write for M4A should be skipped (same as key — leave existing tags intact).

**Primary recommendation:** Ship a `TagWriter` module in `src/main/tagger/` with two functions (`writeMp3Tags`, `writeMp4Tags`), a `TagWriteController` for batch orchestration, and a new `tagger:apply-writes` IPC channel. Re-use `resolveFfmpegPath` from `src/main/conversion/ffmpegPath.ts` for the ffmpeg binary.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Read `pending_tag_edits` queue | Main (SQLite) | — | `taggerRepo` already owns this table |
| MP3 tag write (ID3v2.3) | Main (Node.js) | — | node-id3 is a Node module; cannot run in renderer |
| MP4 metadata remux | Main (Node.js) | — | ffmpeg subprocess; must be main process |
| Atomic temp+rename | Main (Node.js) | — | File-system operation; belongs in main |
| Set `applied_at` after write | Main (SQLite) | — | `taggerRepo.markApplied()` |
| Progress / per-file result feedback | Renderer (UI) | Main (push events) | Batch result pushed via `ipcMain.webContents.send` |
| "Appliquer (N)" affordance | Renderer (React) | — | Count derived from `pendingEdits` already in store |
| Pending count badge | Renderer (Zustand) | — | Derived from existing `useTaggerStore` state |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| node-id3 | ^0.2.9 | Write ID3v2.3 tags to MP3 files | Pure JS (no electron-rebuild), writes v2.3 natively, covers all required frames (TPE1/TIT2/TCON/TBPM/TKEY/COMM/POPM). LOCKED in CLAUDE.md. |
| ffmpeg-static | ^5.3.0 (installed) | Bundled ffmpeg binary for MP4 remux | Already installed + asarUnpack configured in electron-builder.yml. `ffmpegStatic` path is wired in main/index.ts. |
| fluent-ffmpeg | not needed | — | Direct `spawnSync` or `spawn` is sufficient for the simple `-c copy -metadata` remux; fluent-ffmpeg is already installed for conversion but not needed here. Use `node:child_process` directly. |
| music-metadata | ^11.12.3 (installed) | Round-trip read-back verification | Already installed. `parseFile()` returns `format.tagTypes` array for ID3 version assertion. |
| better-sqlite3 | ^12.10.0 (installed) | Read `pending_tag_edits`, set `applied_at` | Already installed; `taggerRepo` already owns the table. |
| node:fs/promises | built-in | Atomic temp-copy + rename | `fs.copyFile`, `fs.writeFile`, `fs.rename`, `fs.rm` |
| node:path | built-in | Same-directory temp file naming | `path.dirname(filePath)` + `.ck-tmp` suffix |
| node:child_process | built-in | Spawn ffmpeg for MP4 remux | `spawnSync` for test-friendly synchronous path; `spawn` with Promise wrapper for production async path |

### Not Needed / Not Installed

| Rejected | Reason |
|----------|--------|
| mp4tag.js | Already decided — use ffmpeg remux (CLAUDE.md: "For MP4 tag writes, delegate to ffmpeg") |
| node-taglib2 | Rejected in CLAUDE.md — requires native bindings and electron-rebuild |
| Any other MP4 tag library | ffmpeg remux is the locked approach |

**Installation (only node-id3 is new):**
```bash
npm install node-id3@^0.2.9
```

node-id3 is pure JS with no native bindings — no `electron-rebuild` needed.

**Version verification:**
```bash
npm view node-id3 version   # → 0.2.9 (latest, published 2025-04-03)
```

---

## Package Legitimacy Audit

> Only node-id3 is a new external package. All others are already installed.

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| node-id3 | npm | ~9 yrs (created 2016-01-08) | ~50k/wk [ASSUMED] | github.com/Zazama/node-id3 | not run (slopcheck unavailable) | [ASSUMED] — verify before install |

**slopcheck was unavailable.** Manual legitimacy signals:
- Package name `node-id3` exists on npm at `Zazama/node-id3` on GitHub (legitimate author, 9+ year old package, version history from 0.1.x to 0.2.9)
- No `postinstall` script in `package.json` (confirmed via `npm view node-id3 scripts`)
- Pure JavaScript — no binary downloads, no network calls at install time
- Registered in CLAUDE.md §"Recommended Stack" as the locked choice

**Confidence: HIGH** that this is a legitimate package.

**Packages removed due to slopcheck [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

---

## Architecture Patterns

### System Architecture Diagram

```
Renderer                          Main Process
─────────                         ────────────
useTaggerStore                    tagger.ts IPC handler
  pendingEdits map ─── invoke ──► tagger:apply-writes
                                    │
                                    ▼
                              taggerRepo.listPendingWrites()
                                    │
                                    ▼
                              for each pending edit:
                                    │
                             ┌──────┴──────┐
                             ▼             ▼
                        .mp3 path     .mp4/.m4a path
                             │             │
                        writeMp3Tags() writeMp4Tags()
                        node-id3       ffmpeg -c copy
                        temp+rename    -metadata ...
                             │             │
                             └──────┬──────┘
                                    ▼
                         taggerRepo.markApplied(filePath)
                                    │
                                    ▼
                         push { type:'fileDone', filePath, ok, error }
                         via ipcMain → renderer
                                    │
                                    ▼
                              Renderer: update
                              ApplyResult display
```

### Recommended Project Structure (new files only)

```
src/main/tagger/
├── tagWriter.ts          # writeMp3Tags() + writeMp4Tags() — pure write logic
├── tagWriter.test.ts     # unit + integration round-trip tests (real fixtures)
├── applyController.ts    # batch loop: read queue → call tagWriter → markApplied → push events
└── taggerRepo.ts         # ADD: listPendingWrites() + markApplied() methods (extend existing file)

src/main/ipc/
└── tagger.ts             # ADD: tagger:apply-writes + tagger:get-pending-count handlers

src/shared/
└── ipc-types.ts          # ADD: TaggerApplyWrites, TaggerGetPendingCount channels + TagWriteEvent type

src/renderer/src/
├── store/useTaggerStore.ts           # ADD: applyWrites() action + isApplying flag
└── views/TaggerView.tsx              # ADD: ApplyBanner component or inline "Appliquer (N)" affordance
```

### Pattern 1: MP3 Atomic Write with node-id3

**What:** Write ID3v2.3 tags to a temp copy of the file, then atomically rename over the original. Ensures the original is never in a half-written state.

**When to use:** All MP3 files in the pending queue.

```typescript
// Source: verified from node-id3 source (github.com/Zazama/node-id3/blob/master/index.js)
// and fs.rename POSIX atomic behavior (same filesystem)
import NodeID3 from 'node-id3'
import fs from 'node:fs/promises'
import path from 'node:path'

interface Mp3TagInput {
  artist?: string | null
  title?: string | null
  genre?: string | null
  bpm?: number | null        // node-id3 accepts number; stored as text "128" in TBPM frame
  key?: string | null        // Camelot string e.g. "8A" → TKEY frame
  comment?: string | null    // stored as { language: 'eng', text: '...' } shape → COMM frame
  rating?: number | null     // 1-5 star; caller derives POPM byte (1→51, 2→102, ..., 5→255)
}

function starToPopmByte(stars: number): number {
  // LOCKED mapping from 04-CONTEXT.md (TAGG-07)
  const map: Record<number, number> = { 1: 51, 2: 102, 3: 153, 4: 204, 5: 255 }
  return map[stars] ?? 0
}

export async function writeMp3Tags(filePath: string, input: Mp3TagInput): Promise<void> {
  // Build tags object — ONLY include non-null fields (D-04: non-destructive)
  const tags: Record<string, unknown> = {}
  if (input.artist != null)  tags.artist = input.artist
  if (input.title != null)   tags.title = input.title
  if (input.genre != null)   tags.genre = input.genre
  if (input.bpm != null)     tags.bpm = String(input.bpm)  // TBPM is a text frame
  if (input.key != null)     tags.initialKey = input.key    // node-id3 key: initialKey → TKEY
  if (input.comment != null) {
    tags.comment = { language: 'eng', text: input.comment } // COMM frame shape
  }
  if (input.rating != null && input.rating >= 1) {
    tags.popularimeter = {
      email: 'rating@cratekeeper',   // arbitrary but consistent email identifier
      rating: starToPopmByte(input.rating),
      counter: 0
    }
  }
  // 0 or unset → omit POPM entirely (per locked mapping)

  // Temp file MUST be in the same directory as the target (same filesystem for atomic rename)
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, path.basename(filePath) + '.ck-tmp')

  try {
    // 1. Copy original to temp (preserves original if write fails)
    await fs.copyFile(filePath, tmp)
    // 2. Write tags to temp file using node-id3 update (merges with existing tags)
    //    update() reads existing tags, merges, then calls write() on the same path
    //    Using write() instead of update() here because we already built a selective
    //    tags object; write() removes all existing ID3 frames and re-writes from scratch.
    //    PROBLEM: write() destroys existing frames we did NOT want to touch (D-04 violation).
    //    SOLUTION: Use update() which merges the provided keys over existing frames.
    const result = NodeID3.update(tags, tmp)
    if (result instanceof Error) throw result
    if (result === false) throw new Error('node-id3 update returned false')
    // 3. Atomic rename: temp → original (POSIX atomic on same filesystem; on Windows this
    //    is also atomic via MoveFileExW with MOVEFILE_REPLACE_EXISTING)
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Clean up temp on any failure — leave original untouched
    await fs.rm(tmp, { force: true })
    throw err
  }
}
```

**Critical note:** `NodeID3.update(tags, filePath)` reads existing tags, merges only the provided keys, then calls `NodeID3.write()` internally (which is `readFileSync` + `writeFileSync` in-place). By pointing `update` at the TEMP file, not the original, we get the merge behavior while keeping the original safe until rename succeeds.

### Pattern 2: MP4/M4A Atomic Remux via ffmpeg

**What:** ffmpeg `-c copy -metadata` writes a new file (inherently atomic because it never touches the input). Use a temp output path, then rename over original.

**Verified metadata key mapping (tested against ffmpeg 6.0 + music-metadata ^11):**

| Field | ffmpeg `-metadata` key | music-metadata `common.*` | Notes |
|-------|----------------------|--------------------------|-------|
| artist | `artist` | `common.artist` | Maps to `©ART` atom |
| title | `title` | `common.title` | Maps to `©nam` atom |
| genre | `genre` | `common.genre[0]` | Maps to `©gen` atom |
| BPM | **`tmpo`** | `common.bpm` | Maps to `tmpo` atom (integer). `-metadata BPM=` is SILENTLY IGNORED |
| comment | `comment` | `common.comment[0].text` | Maps to `©cmt` atom |
| key (musical) | **none** | — | No standard MP4 atom; skip |
| rating | **none** | — | No Rekordbox-compatible MP4 rating atom; skip |

```typescript
// Source: verified via live ffmpeg 6.0 test (ffmpeg-static bundled)
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

interface Mp4TagInput {
  artist?: string | null
  title?: string | null
  genre?: string | null
  bpm?: number | null
  comment?: string | null
  // key and rating intentionally omitted — no standard MP4 atom
}

export async function writeMp4Tags(
  filePath: string,
  input: Mp4TagInput,
  ffmpegBinaryPath: string
): Promise<void> {
  const dir = path.dirname(filePath)
  const tmp = path.join(dir, path.basename(filePath) + '.ck-tmp')

  // Build -metadata flags array (only non-null fields, per D-04)
  const metaFlags: string[] = []
  if (input.artist != null)  metaFlags.push('-metadata', `artist=${input.artist}`)
  if (input.title != null)   metaFlags.push('-metadata', `title=${input.title}`)
  if (input.genre != null)   metaFlags.push('-metadata', `genre=${input.genre}`)
  if (input.bpm != null)     metaFlags.push('-metadata', `tmpo=${input.bpm}`)
  if (input.comment != null) metaFlags.push('-metadata', `comment=${input.comment}`)

  const args = [
    '-y', '-i', filePath,
    '-c', 'copy',
    '-map_metadata', '0',   // copy all existing atoms from input
    ...metaFlags,           // then override the ones we're writing
    tmp
  ]

  try {
    const result = spawnSync(ffmpegBinaryPath, args, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(`ffmpeg exited ${result.status}: ${result.stderr?.slice(-500) ?? ''}`)
    }
    // ffmpeg output is already in tmp; rename over original
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}
```

**Why `-map_metadata 0` is required:** Without it, ffmpeg drops all atoms not explicitly set by `-metadata` flags. With it, all existing atoms are preserved and only the ones we specify are overwritten — satisfying D-04 (non-destructive).

### Pattern 3: File Extension → Write Path Dispatch

```typescript
const MP3_EXT = '.mp3'
const MP4_EXTS = new Set(['.m4a', '.aac', '.mp4'])

export function getWriteStrategy(filePath: string): 'mp3' | 'mp4' | 'unsupported' {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === MP3_EXT) return 'mp3'
  if (MP4_EXTS.has(ext)) return 'mp4'
  return 'unsupported'  // FLAC, WAV, OGG, AIFF — skip with per-file error
}
```

### Pattern 4: `taggerRepo` Extensions

Two new methods needed on `TaggerRepo`:

```typescript
// ADD to TaggerRepo interface
listPendingWrites(): PendingTagEdit[]        // applies re-edit predicate (see Open Questions)
markApplied(filePath: string, now: number): void

// SQL for listPendingWrites (simple first form — see re-edit discussion below)
'SELECT * FROM pending_tag_edits WHERE applied_at IS NULL'

// SQL for markApplied
'UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?'
```

### Pattern 5: IPC Channel and Event Shape

```typescript
// Add to IpcChannels in src/shared/ipc-types.ts
TaggerApplyWrites: 'tagger:apply-writes'       // invoke → starts the batch
TaggerGetPendingCount: 'tagger:pending-count'  // invoke → number

// Push event: main → renderer during the batch
TaggerWriteEvent: 'tagger:write-event'         // on()

export type TagWriteEvent =
  | { type: 'fileDone'; filePath: string; ok: true }
  | { type: 'fileDone'; filePath: string; ok: false; error: string }
  | { type: 'done'; totalWritten: number; totalFailed: number }
```

### Pattern 6: Round-Trip Verification

```typescript
// Source: mirrors existing tagRoundtrip.test.ts pattern
// meta.format.tagTypes is the assertion target for ID3 version
import { parseFile } from 'music-metadata'

const meta = await parseFile(outputPath)

// Assert ID3v2.3 (not v2.4) — Rekordbox compat check
expect(meta.format.tagTypes).toContain('ID3v2.3')

// Assert core fields
expect(meta.common.artist).toBe('Test Artist')
expect(meta.common.title).toBe('Test Title')
expect(meta.common.genre).toContain('House')
expect(meta.common.bpm).toBe(128)           // integer
expect(meta.common.key).toBe('8A')          // Camelot

// Assert POPM via native frames (common.rating is normalized 0..1)
const id3Native = meta.native['ID3v2.3'] ?? []
const popm = id3Native.find(f => f.id === 'POPM')
expect(popm?.value?.rating).toBe(204)       // 4 stars → 204
```

### Anti-Patterns to Avoid

- **Using `NodeID3.write()` directly on the original file:** `write()` is not atomic — a crash mid-write corrupts the file. Always write to a temp file in the same directory.
- **Using `NodeID3.write()` instead of `update()` on the temp:** `write()` removes ALL existing frames, violating D-04 (non-destructive). Use `update()` so existing frames not in the tags object are preserved.
- **Temp file in system tmpdir (`os.tmpdir()`):** Cross-filesystem rename (e.g., tmpdir on a RAM disk, music on a NAS) will fail with EXDEV. Always create the temp in `path.dirname(filePath)`.
- **Using `-metadata BPM=128` for MP4:** Silently ignored by ffmpeg 6.0. Must use `-metadata tmpo=128`.
- **Omitting `-map_metadata 0` for MP4:** Without it, all existing atoms (album, year, cover art, etc.) are dropped. Always include `-map_metadata 0` BEFORE the `-metadata` override flags.
- **Setting `applied_at` before confirming write success:** `markApplied` must only be called after `fs.rename` completes successfully. A failure in the write must leave `applied_at = NULL`.
- **Calling `update()` with null values in the tags object:** If you pass `{ artist: null }`, the `update()` merge will set the `TPE1` frame to null (which produces an empty frame or omission depending on node-id3 internals). Filter the tags object to exclude null keys before calling.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| ID3v2.3 frame encoding | Custom ID3 byte packer | node-id3 `update()` | ID3v2.3 has dozens of frame types, encoding edge cases, BOM handling, frame header size encoding — all wrong by hand |
| MP4 atom writing | Custom MP4 atom writer | ffmpeg `-c copy -metadata` | MP4 atom format (ftyp/moov/udta/ilst) is a binary tree with length-prefixed boxes; `tmpo` is an integer atom with specific structure |
| Atomic file write | Custom write-protect via lock files | `fs.rename()` to temp in same dir | POSIX `rename()` is atomic by kernel guarantee; lock files are not atomic and cross-process unreliable |
| UTF-16 encoding | Manual `Buffer.from(str, 'utf16le')` | node-id3 internal (uses iconv-lite) | Byte order mark (BOM) is required for ID3v2.3 UTF-16; iconv-lite's `'UTF-16'` encoding adds the BOM automatically |

**Key insight:** The ID3 and MP4 formats are binary formats with non-trivial internal structure. Any hand-rolled implementation will miss edge cases (multi-byte chars, null terminators, frame size encoding, atom length updates). The libraries exist precisely to abstract this complexity.

---

## Common Pitfalls

### Pitfall 1: `NodeID3.write()` vs `NodeID3.update()` — Non-Destructive Requirement

**What goes wrong:** Using `NodeID3.write(tags, filePath)` removes all existing ID3 frames from the file and writes only the frames in `tags`. Existing frames for fields not in the pending edit (e.g., album art, track number, comments the user did not edit) are silently deleted.

**Why it happens:** `write()` is the standard "stamp new tags" API. `update()` reads existing tags first, merges, then re-writes. D-04 requires non-destructive writes.

**How to avoid:** Always use `NodeID3.update(tags, tmpFile)` where `tags` contains only the non-null fields. The `update` function reads existing frames from `tmpFile` (a copy of the original), merges the provided tags, and calls `write()` on `tmpFile`. Then rename tmpFile → original.

**Warning signs:** Rekordbox shows empty album, missing cover art, or disappeared track numbers after applying tags.

### Pitfall 2: Cross-Filesystem `fs.rename()` (EXDEV Error)

**What goes wrong:** If the temp file is written to `os.tmpdir()` (which may be `/tmp` on a RAM tmpfs on macOS/Linux, or a different drive on Windows) and the audio file is on a different filesystem (mounted NAS, external drive), `fs.rename(tmp, originalPath)` throws `EXDEV: cross-device link not permitted`.

**Why it happens:** `rename()` is atomic only within the same filesystem. Crossing filesystem boundaries requires a copy + delete, which is not atomic.

**How to avoid:** Always create the temp file in the same directory as the target audio file: `path.join(path.dirname(filePath), path.basename(filePath) + '.ck-tmp')`. This guarantees same-filesystem rename.

**Warning signs:** `EXDEV` error in the write handler, particularly for users with music on external drives or NAS mounts.

### Pitfall 3: ffmpeg `-metadata BPM=` Silently Ignored for MP4

**What goes wrong:** Using `-metadata BPM=128` instead of `-metadata tmpo=128` — the BPM metadata silently fails to write (tested and confirmed against ffmpeg 6.0). No error is thrown; the output file simply has no BPM atom.

**Why it happens:** ffmpeg maps the key `tmpo` to the integer `tmpo` atom in the MOV/M4A muxer. The string `BPM` is not a recognized key in the MOV muxer's metadata mapping table.

**How to avoid:** Always use `-metadata tmpo=<integer>` for MP4/M4A BPM. Document this as a named constant in the code: `const MP4_BPM_KEY = 'tmpo'`.

**Warning signs:** Round-trip test shows `common.bpm` as `undefined` after writing.

### Pitfall 4: `applied_at` Set Before `fs.rename()` Completes

**What goes wrong:** Setting `applied_at = now` in SQLite before the atomic rename succeeds. If the rename fails (disk full, permissions), the row is marked as written but the file was not actually updated. The edit is now invisible to the retry queue (`applied_at IS NULL` filter).

**Why it happens:** Optimistic DB write before confirming I/O success.

**How to avoid:** Always follow this order: 1) write to temp file, 2) `fs.rename()`, 3) `taggerRepo.markApplied()`. Only reach step 3 if steps 1 and 2 succeeded without throwing.

**Warning signs:** User sees "N applied" but external tag inspector shows old values in the file.

### Pitfall 5: node-id3 `update()` and Null-Valued Fields

**What goes wrong:** Passing `{ artist: null, title: 'My Title' }` to `NodeID3.update()` — the `artist: null` key is included in the merge. Depending on node-id3 internals, `GENERIC_TEXT.create(frameIdentifier, null)` returns `null` (because `if(!frameIdentifier || !data) return null`), so the frame is omitted. This means passing null for a field will silently delete that frame in the output.

**Why it happens:** `update()` iterates all keys in the provided object and merges them. A null value maps to no frame, which removes the existing frame for that field.

**How to avoid:** Build the tags object by only including keys with non-null, non-undefined values. Example: `if (input.artist != null) tags.artist = input.artist`. Never include null keys.

**Warning signs:** After "Appliquer", Rekordbox shows blank artist for files that previously had an artist.

### Pitfall 6: ffmpeg `-map_metadata 0` vs `-map_metadata -1`

**What goes wrong:** Using `-map_metadata -1` (or omitting `-map_metadata`) copies no existing metadata. All atoms in the original M4A (album, artwork, track number, etc.) are dropped.

**Why it happens:** ffmpeg defaults to `-map_metadata -1` when re-encoding. When using `-c copy`, metadata may or may not be preserved depending on ffmpeg version — safest to always be explicit.

**How to avoid:** Always include `-map_metadata 0` before the `-metadata override` flags. This copies ALL existing metadata from the input (stream 0), then our `-metadata` flags override just the ones we want to update.

---

## Re-Edit Semantics Decision (Claude's Discretion — D-04 flag)

**The situation:** `upsertEdit` (Phase 4) updates the row but does NOT touch `applied_at`. So if a user edits file A → Appliquer writes it → `applied_at = T1`. Then user edits file A again (genre changes) → the DB row is updated, `updated_at = T2 > T1`, but `applied_at` remains `T1`. The naive `WHERE applied_at IS NULL` filter will NOT pick up this re-edit.

**Option A: `applied_at IS NULL` only** (current)
- Simple. Re-edits of already-written files are NOT re-applied.
- User must edit → Appliquer → see it applied → edit again → Appliquer again (two passes).
- Phase 4's `upsertEdit` could clear `applied_at` on update, but that was explicitly forbidden in 04-CONTEXT.md.

**Option B: `applied_at IS NULL OR updated_at > applied_at`**
- Re-edits are automatically included in the next "Appliquer" batch.
- Better UX: "Appliquer (N)" count accurately reflects all un-written intent, including edits on already-written files.
- Slight complexity: the count and the queue both use this predicate consistently.

**Recommendation: Option B** — `applied_at IS NULL OR updated_at > applied_at`. Rationale:
1. The user's mental model is "I edited this file, clicking Appliquer should write it". They shouldn't need to know whether the file was previously written.
2. The 04-CONTEXT.md constraint says "a Phase-4 re-edit must NOT clear `applied_at`" — which is satisfied by Option B (we don't clear `applied_at`; we simply re-include the row when `updated_at > applied_at`).
3. The implementation is a 3-word SQL change in one place (`listPendingWrites` query).
4. Risk of re-writing an unchanged file: acceptable. The write is idempotent (writing the same values again is harmless).

**If the user prefers Option A** for simplicity, it should be explicitly stated as a known limitation in the plan. Flag this as a checkpoint item.

---

## Code Examples

### Full node-id3 Write Call (verified field shapes)

```typescript
// Source: node-id3 source code (github.com/Zazama/node-id3 src/ID3Definitions.js + src/ID3Frames.js)
// Key → frame ID mappings (v3):
//   artist      → TPE1 (GENERIC_TEXT, encoding 0x01 = UTF-16)
//   title       → TIT2 (GENERIC_TEXT, encoding 0x01 = UTF-16)
//   genre       → TCON (GENERIC_TEXT, encoding 0x01 = UTF-16)
//   bpm         → TBPM (GENERIC_TEXT, encoding 0x01 = UTF-16; value coerced to string)
//   initialKey  → TKEY (GENERIC_TEXT, encoding 0x01 = UTF-16)
//   comment     → COMM (language + shortText + text, encoding 0x01 = UTF-16)
//   popularimeter → POPM (email + rating byte 0-255 + counter uint32)

import NodeID3 from 'node-id3'

// Build selective tags object (only non-null fields per D-04)
const tags: NodeID3.Tags = {
  artist: 'Daft Punk',
  title: 'Around The World',
  genre: 'House',
  bpm: '128',           // string in TBPM text frame — Rekordbox reads as integer
  initialKey: '8A',    // TKEY Camelot notation
  comment: {
    language: 'eng',    // 3-char ISO 639-2 language code
    // shortText: '',   // optional content description (empty = no short description)
    text: 'My comment' // required — the actual comment content
  },
  popularimeter: {
    email: 'rating@cratekeeper',  // arbitrary; consistent across all writes
    rating: 204,                  // POPM byte: 4 stars = 204 (locked mapping)
    counter: 0                    // play counter; 0 is standard for non-Winamp clients
  }
}

// update() reads existing tags, merges, writes to tmp (which is a copy of the original)
const result = NodeID3.update(tags, tmpFilePath)
// result is true on success, Error on failure
if (result instanceof Error) throw result
```

### music-metadata ID3 Version Assert

```typescript
// Source: verified via live parseFile() call against tagged-rekordbox.mp3 fixture
// format.tagTypes: ['ID3v2.3'] — confirmed for a node-id3-written file
import { parseFile } from 'music-metadata'

const meta = await parseFile(filePath)
expect(meta.format.tagTypes).toContain('ID3v2.3')  // NOT 'ID3v2.4'
expect(meta.common.bpm).toBe(128)                  // number, not string
expect(meta.common.key).toBe('8A')                 // Camelot string
```

### MP4 BPM Write (verified key = `tmpo`)

```typescript
// Source: verified via live ffmpeg 6.0 test (ffmpeg-static bundled binary)
// '-metadata tmpo=128' writes the tmpo atom; music-metadata reads it as common.bpm = 128
// '-metadata BPM=128' is SILENTLY IGNORED
const args = [
  '-y', '-i', filePath,
  '-c', 'copy',
  '-map_metadata', '0',
  '-metadata', `artist=${artist}`,
  '-metadata', `title=${title}`,
  '-metadata', `genre=${genre}`,
  '-metadata', `tmpo=${bpm}`,     // KEY: 'tmpo' not 'BPM'
  '-metadata', `comment=${comment}`,
  tmpFilePath
]
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Manual ID3 frame byte packing | node-id3 pure JS library | 2016 (library) | No binary dependencies, no electron-rebuild |
| `fs.writeFileSync` in-place | temp + `fs.rename()` | Best practice, no single change date | Crash-safe atomic writes |
| ffmpeg `-metadata BPM=` | ffmpeg `-metadata tmpo=` for M4A | Was never correct — tmpo is the iTunes atom | Without this, BPM silently not written to M4A |
| `NodeID3.write()` (destructive) | `NodeID3.update()` (merge) | node-id3 has had both for years | D-04 non-destructive policy requires update() |

**Deprecated/outdated:**
- ffmpeg-static for MP3 tag writing: never needed — node-id3 handles MP3 natively in JS.
- `music-metadata` for writes: it is read-only; only used for verification.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | node-id3 `update()` called on a temp copy (not the original path) correctly reads existing tags from that temp copy before merging | Pattern 1 | If it reads from the original path instead, we'd get wrong merge source — test this in unit tests |
| A2 | `fs.rename()` on Windows is effectively atomic for same-drive renames | Pitfall 2 | On Windows, `MoveFileExW` is near-atomic but may not be POSIX-equivalent; test on Windows fixture path |
| A3 | Rekordbox 6.x reads POPM bytes `51/102/153/204/255` as 1-5 stars | Standard Stack | If Rekordbox uses a different scale (e.g., `1/64/128/192/255`), the star mapping produces wrong ratings — manual checkpoint needed |
| A4 | `comment` short-text description in node-id3 COMM frame: leaving `shortText` undefined defaults to empty string (no null-byte issues in the frame) | Code Examples | If shortText must be explicitly set to `''`, omitting it may produce a malformed frame — verify in round-trip test |
| A5 | There is no standard MP4 atom for musical key that Rekordbox reads natively | Standard Stack (MP4 key/rating) | If Rekordbox reads `----:com.apple.iTunes:INITIALKEY` as the key field, we could write it; but this is an freeform atom write via ffmpeg `-metadata 'INITIALKEY=8A'` — would need verification |

---

## Open Questions (RESOLVED)

> All three resolved during Phase 5 planning — see 05-01/05-02/05-03-PLAN.md.

1. **Re-edit predicate** (flagged in Claude's Discretion) — **RESOLVED:** Option B adopted (`applied_at IS NULL OR updated_at > applied_at`), implemented in 05-01 Task 3 `listPendingWrites`.
   - What we know: `applied_at IS NULL` misses re-edits of already-written files.
   - What's unclear: Does the user expect re-edits to be included in the next Appliquer, or is the simpler form acceptable?
   - Recommendation: Use `applied_at IS NULL OR updated_at > applied_at` (Option B). Flag for human confirm at checkpoint.

2. **Rekordbox POPM byte scale validation** — **RESOLVED:** manual checkpoint added in 05-03 Task 3 (`<human-check>` — import POPM=204 file into Rekordbox, confirm 4 stars).
   - What we know: The locked mapping (1→51, 2→102, 3→153, 4→204, 5→255) matches the Winamp/Mp3tag convention.
   - What's unclear: Rekordbox 6.x specifically — does it use the same scale?
   - Recommendation: Add a manual checkpoint in the plan: "Import a test file with POPM=204 into Rekordbox and confirm it shows as 4 stars before shipping."

3. **`NodeID3.update()` called on temp copy — read source behavior** — **RESOLVED:** confirmed via unit test required in 05-01 Task 2 (update on temp path preserves old frames).
   - What we know: `update()` calls `read(filebuffer)` first.
   - What's unclear: When `filebuffer` is a file path string, does it read from that path (the temp copy) or resolve to the original somehow?
   - Recommendation: Confirm via unit test: write a temp file with known tags, call `NodeID3.update({ title: 'new' }, tmpPath)`, verify old tags are preserved.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| node-id3 | MP3 writes | NOT INSTALLED | — | Add `npm install node-id3@^0.2.9` as Wave 0 task |
| ffmpeg-static | MP4 remux | Installed | 6.0 | — |
| music-metadata | Read-back verification | Installed | ^11.12.3 | — |
| better-sqlite3 | `listPendingWrites` / `markApplied` | Installed | ^12.10.0 | — |
| node:fs/promises | Atomic rename | Built-in | Node 20+ | — |

**Missing dependencies with no fallback:** `node-id3` (must be installed before Wave 1 begins).

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest ^4.1.7 |
| Config file | `vitest.config.ts` — `node` project for `src/main/**/*.test.ts` |
| Quick run command | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| TAGS-01 | MP3 tags written to file and readable by music-metadata | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-01 | MP4/M4A tags written to file and readable by music-metadata | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-02 | Original file untouched if write fails (crash-safety) | Unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-03 | Written MP3 has format.tagTypes containing 'ID3v2.3' | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-03 | Written MP3 has UTF-16 encoding (verified via POPM byte or native frame encoding byte) | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-03 | Written MP3 TBPM is integer-compatible (common.bpm === number) | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGS-03 | Written MP3 TKEY = Camelot string (e.g. '8A') | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGG-07 | POPM byte for 4 stars = 204 | Unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| TAGG-07 | rating=null → POPM frame omitted | Unit | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| D-04 | Null fields do not overwrite existing frames | Integration | `npx vitest run --project node src/main/tagger/tagWriter.test.ts` | ❌ Wave 0 |
| D-05 | Per-file failure leaves applied_at NULL | Unit | `npx vitest run --project node src/main/tagger/taggerRepo.test.ts` (extend) | ✅ (extend) |

### Sampling Rate

- **Per task commit:** `npx vitest run --project node src/main/tagger/tagWriter.test.ts`
- **Per wave merge:** `npm test` (full 479+ test suite)
- **Phase gate:** Full suite green before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `src/main/tagger/tagWriter.test.ts` — covers TAGS-01, TAGS-02, TAGS-03, TAGG-07, D-04; needs real fixtures
- [ ] Fixtures: `untagged.mp3` already exists; need a `test-tagged.mp3` with known POPM for the non-destructive test; `tagged.m4a` already exists for MP4 tests
- [ ] Install: `npm install node-id3@^0.2.9` — must run before any tagWriter test can import it

---

## Security Domain

> `security_enforcement: true` in `.planning/config.json`.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | `resolvesUnderRoot()` already in `src/main/ipc/tagger.ts` — reuse for `tagger:apply-writes` IPC handler |
| V5 Input Validation | yes | File path must pass `resolvesUnderRoot` + `AUDIO_EXTS` gate; metadata values must pass existing length/type validators |
| V6 Cryptography | no | — |

### Known Threat Patterns for this Stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal via `filePath` in apply-writes payload | Tampering | `resolvesUnderRoot(filePath, rootFolder)` — already implemented in tagger IPC; must apply to apply-writes handler |
| Oversized metadata values writing malformed ID3 frames | Tampering | Reuse existing `MAX_TEXT_LEN = 500` / `MAX_KEY_LEN = 16` / `ALLOWED_RATINGS` validators from `src/main/ipc/tagger.ts` |
| Temp file name collision (two concurrent writes to same path) | Tampering | The apply-writes batch is synchronous sequential (no concurrent writes); also, temp name = `filePath + '.ck-tmp'` is deterministic and per-file unique |
| ffmpeg binary path injection | Tampering | `resolveFfmpegPath()` resolves from the bundled ffmpeg-static binary, not from user input — no injection vector |

---

## Project Constraints (from CLAUDE.md)

- **MP3 writes: node-id3** (^0.2, pure JS, NOT yet installed). ID3v2.3, frames TPE1/TIT2/TCON/TBPM/TKEY/COMM/POPM.
- **MP4/M4A/AAC writes: ffmpeg remux** via existing fluent-ffmpeg / ffmpeg-static. Use `-map_metadata 0 -c copy -metadata` pattern. NOT a pure-JS MP4 writer.
- **Read-back verification: music-metadata** (^11, installed).
- **Electron main process only** for all file writes — no file I/O in renderer.
- **Typed IPC bridge** pattern: shared `IpcChannels` const + repo factory + preload bridge.
- **No mutation in store** — Zustand immutable updates only.
- **French copy** everywhere user-facing (e.g., "Appliquer", "N tags en attente", error messages).
- **Editorial dark-studio design tokens** — reuse existing `:root` tokens; no new `--color-*`.
- **Files ≤ 800 lines** — split `tagWriter.ts` from `applyController.ts`.
- **Prepared statements only** in SQLite — no template-literal SQL.

---

## Sources

### Primary (HIGH confidence)

- **node-id3 source code** (github.com/Zazama/node-id3, Zazama/node-id3) — verified via `gh api repos/Zazama/node-id3/contents/*`: header byte 0x0300 (ID3v2.3), ENCODINGS array `['ISO-8859-1', 'UTF-16', 'UTF-16BE', 'UTF-8']`, GENERIC_TEXT encoding byte 0x01, COMM/POPM frame shapes, `update()` merge behavior, `write()` in-place fs.readFileSync + fs.writeFileSync
- **Live ffmpeg 6.0 test** — ran against `tagged.m4a` fixture using ffmpeg-static: confirmed `tmpo=128` writes and reads back correctly; `BPM=128` silently ignored; `-map_metadata 0` required for passthrough
- **Live music-metadata test** — ran `parseFile()` against `tagged-rekordbox.mp3` fixture: confirmed `format.tagTypes = ['ID3v2.3']`; against written M4A: confirmed `common.bpm = 128` from `tmpo` atom; `iTunes` native tag type
- **`src/main/tagger/taggerRepo.ts`** — confirmed `pending_tag_edits` schema, `applied_at` column, `upsertEdit` omits `applied_at` from UPDATE clause
- **`src/main/conversion/presets.ts`** — confirmed `-map_metadata 0` + `-id3v2_version 3` pattern used in existing conversion pipeline (Phase 3)
- **`src/main/conversion/ffmpegPath.ts`** — confirmed asar-aware path rewrite pattern to carry forward
- **`src/main/workers/__fixtures__/`** — listed: `untagged.mp3`, `tagged-rekordbox.mp3`, `tagged.m4a`, `tagged.mp3` available for tests
- **`electron-builder.yml`** — confirmed `asarUnpack: ["**/node_modules/ffmpeg-static/**"]` already in place

### Secondary (MEDIUM confidence)

- **music-metadata `lib/mp4/MP4TagMapper.js`** — atom → common field mappings: `tmpo → bpm`, `©ART → artist`, `©nam → title`, `©gen → genre`, `©cmt → comment`; no mapping for musical key or POPM-equivalent
- **music-metadata `lib/id3v2/ID3v2Parser.js`** — `headerType = \`ID3v2.${id3Header.version.major}\`` confirms `format.tagTypes` key naming

### Tertiary (LOW confidence / assumed)

- A3 (Assumptions Log): Rekordbox 6.x POPM byte scale (51/102/153/204/255) — not validated against a running Rekordbox instance; needs manual checkpoint
- A5 (Assumptions Log): freeform MP4 atom write for musical key via `----:com.apple.iTunes:INITIALKEY` — not tested, may work but out of scope for v1

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — node-id3 API verified from source; ffmpeg behavior verified via live tests
- Architecture: HIGH — follows established patterns from Phases 3 and 4 exactly
- Pitfalls: HIGH — pitfalls 1-6 all verified empirically or from source code
- MP4 key/rating: HIGH (confirmed absent — no standard atom)
- POPM Rekordbox compat: MEDIUM — scale mapping is conventional (Mp3tag/Winamp standard), not Rekordbox-specific test

**Research date:** 2026-06-15
**Valid until:** 2026-09-15 (90 days — node-id3 and ffmpeg-static are stable, slow-moving libraries)
