/**
 * tagWriter — Phase 5 Plan 01
 *
 * Atomic, non-destructive tag writes for MP3 (node-id3) and MP4/M4A/AAC
 * (ffmpeg remux). Both paths use temp-copy + fs.rename for atomicity (TAGS-02)
 * and only include non-null fields so existing frames survive (D-04).
 *
 * Exports:
 *   writeMp3Tags   — write ID3v2.3 tags to an MP3 file
 *   writeMp4Tags   — write MP4/M4A/AAC metadata via ffmpeg remux
 *   getWriteStrategy — classify a file path as 'mp3' | 'mp4' | 'unsupported'
 *   starToPopmByte — convert 1-5 star rating to POPM byte (TAGG-07 locked mapping)
 */
import path from 'node:path'
import fs from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import NodeID3 from 'node-id3'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Mp3TagInput {
  artist?: string | null
  title?: string | null
  genre?: string | null
  bpm?: number | null
  key?: string | null
  comment?: string | null
  rating?: number | null
}

export interface Mp4TagInput {
  artist?: string | null
  title?: string | null
  genre?: string | null
  bpm?: number | null
  comment?: string | null
  // key and rating intentionally omitted — no standard MP4 atom (RESEARCH §Summary 6-7)
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MP3_EXT = '.mp3'
const MP4_EXTS = new Set(['.m4a', '.aac', '.mp4'])
const CK_TMP_SUFFIX = '.ck-tmp'

// POPM byte mapping — LOCKED from 04-CONTEXT.md (TAGG-07)
const STAR_TO_POPM: Record<number, number> = {
  1: 51,
  2: 102,
  3: 153,
  4: 204,
  5: 255
}

const POPM_EMAIL = 'rating@cratekeeper'

// ─── Public helpers ───────────────────────────────────────────────────────────

/**
 * Convert a 1–5 star rating to an ID3v2.3 POPM byte (0–255).
 * 0 or any unrecognized value returns 0 (omit POPM).
 * LOCKED mapping from 04-CONTEXT.md (TAGG-07).
 */
export function starToPopmByte(stars: number): number {
  return STAR_TO_POPM[stars] ?? 0
}

/**
 * Classify a file path by write strategy.
 * MP3 → 'mp3', MP4/M4A/AAC → 'mp4', everything else → 'unsupported' (D-06).
 */
export function getWriteStrategy(filePath: string): 'mp3' | 'mp4' | 'unsupported' {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === MP3_EXT) return 'mp3'
  if (MP4_EXTS.has(ext)) return 'mp4'
  return 'unsupported'
}

// ─── MP3 writer ──────────────────────────────────────────────────────────────

/**
 * Write ID3v2.3 tags to an MP3 file atomically.
 *
 * Strategy: copy original → temp, then NodeID3.update() on the temp (preserves
 * existing frames — D-04), then fs.rename(temp, original). On any failure,
 * rm the temp and rethrow so the original is byte-identical (TAGS-02).
 *
 * Only non-null fields are added to the tags object — passing null to
 * NodeID3.update() would silently delete the existing frame (Pitfall 5).
 */
export async function writeMp3Tags(filePath: string, input: Mp3TagInput): Promise<void> {
  // Build tags object — include ONLY non-null fields (D-04 non-destructive)
  const tags: NodeID3.Tags = {}

  if (input.artist != null) tags.artist = input.artist
  if (input.title != null) tags.title = input.title
  if (input.genre != null) tags.genre = input.genre
  if (input.bpm != null) tags.bpm = String(input.bpm) // TBPM is a text frame
  if (input.key != null) tags.initialKey = input.key // → TKEY frame
  if (input.comment != null) {
    tags.comment = { language: 'eng', text: input.comment } // COMM frame
  }
  if (input.rating != null && input.rating >= 1) {
    tags.popularimeter = {
      email: POPM_EMAIL,
      rating: starToPopmByte(input.rating),
      counter: 0
    }
  }
  // 0/null → omit POPM entirely (per locked TAGG-07 mapping)

  const tmp = path.join(path.dirname(filePath), path.basename(filePath) + CK_TMP_SUFFIX)

  try {
    // 1. Copy original → temp (same directory → same filesystem for atomic rename)
    await fs.copyFile(filePath, tmp)

    // 2. NodeID3.update merges into the temp copy, preserving untouched frames (D-04)
    const result = NodeID3.update(tags, tmp)
    if (result instanceof Error) throw result
    if (result === false) throw new Error('node-id3 update returned false')

    // 3. Atomic rename: temp → original (POSIX atomic, Windows MoveFileExW near-atomic)
    await fs.rename(tmp, filePath)
  } catch (err) {
    // Clean up temp on any failure — leave original untouched (TAGS-02)
    await fs.rm(tmp, { force: true })
    throw err
  }
}

// ─── MP4 writer ──────────────────────────────────────────────────────────────

/**
 * Write metadata to an MP4/M4A/AAC file via ffmpeg remux.
 *
 * Uses `-c copy -map_metadata 0` to preserve all existing atoms (D-04), then
 * `-metadata key=value` to override only the fields provided. BPM must use key
 * `tmpo` (NOT `BPM` — silently ignored by ffmpeg 6.0, Pitfall 3).
 *
 * Writes to a temp file then renames for atomicity (TAGS-02). The injected
 * ffmpegBinaryPath must come from resolveFfmpegPath() — never from user/DB input.
 *
 * key and rating are intentionally unsupported for MP4: no standard atom
 * exists for musical key, and the MP4 rating atom is not Rekordbox-compatible.
 */
export async function writeMp4Tags(
  filePath: string,
  input: Mp4TagInput,
  ffmpegBinaryPath: string
): Promise<void> {
  const tmp = path.join(path.dirname(filePath), path.basename(filePath) + CK_TMP_SUFFIX)

  // Build -metadata flags — only non-null fields (D-04)
  const metaFlags: string[] = []
  if (input.artist != null) metaFlags.push('-metadata', `artist=${input.artist}`)
  if (input.title != null) metaFlags.push('-metadata', `title=${input.title}`)
  if (input.genre != null) metaFlags.push('-metadata', `genre=${input.genre}`)
  if (input.bpm != null) metaFlags.push('-metadata', `tmpo=${input.bpm}`) // KEY: tmpo, not BPM
  if (input.comment != null) metaFlags.push('-metadata', `comment=${input.comment}`)

  // Determine the container format from the source file extension.
  // Required because the temp file uses a .ck-tmp suffix and ffmpeg cannot
  // infer the muxer from it (Rule 1 fix — "Unable to find a suitable output format").
  const ext = path.extname(filePath).toLowerCase()
  const outputFormat = ext === '.mp4' ? 'mp4' : 'ipod' // 'ipod' is the correct muxer for .m4a/.aac

  // -map_metadata 0 BEFORE -metadata overrides: preserves all existing atoms first
  const args = [
    '-y',
    '-i', filePath,
    '-c', 'copy',
    '-map_metadata', '0',
    ...metaFlags,
    '-f', outputFormat,
    tmp
  ]

  try {
    const result = spawnSync(ffmpegBinaryPath, args, { encoding: 'utf8' })
    if (result.status !== 0) {
      throw new Error(
        `ffmpeg exited ${result.status}: ${result.stderr?.slice(-500) ?? '(no stderr)'}`
      )
    }
    // ffmpeg wrote a complete output at tmp; rename atomically over original
    await fs.rename(tmp, filePath)
  } catch (err) {
    await fs.rm(tmp, { force: true })
    throw err
  }
}
