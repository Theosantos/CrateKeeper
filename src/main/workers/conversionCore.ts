/**
 * Pure helpers for the conversion worker. NO node:worker_threads, NO
 * node:child_process, NO node:fs, NO electron imports — strictly leaves the
 * worker boundary so this module is trivially unit-testable.
 */
import path from 'node:path'
import type { Preset } from '../../shared/ipc-types'

/**
 * Extract the LAST `time=HH:MM:SS.MS` occurrence from an ffmpeg stderr chunk
 * and return the total seconds, or null when no match exists.
 *
 * Pitfall 4: stderr chunks are byte-aligned, not line-aligned — a single
 * chunk often contains several `time=` tokens (and may also split one across
 * boundaries). We deliberately return the rightmost match because it's the
 * most recent progress reading.
 *
 * The function is stateless: `TIME_RE.lastIndex` is reset on every call so
 * the global-flag regex never carries state between invocations (well-known
 * "stateful regex" pitfall).
 */
const TIME_RE = /time=(\d+):(\d+):(\d+\.\d+)/g

export function parseFfmpegTimeProgress(chunk: string): number | null {
  TIME_RE.lastIndex = 0
  let match: RegExpExecArray | null = null
  let last: RegExpExecArray | null = null
  while ((match = TIME_RE.exec(chunk)) !== null) {
    last = match
  }
  if (!last) return null
  return Number(last[1]) * 3600 + Number(last[2]) * 60 + parseFloat(last[3])
}

/**
 * Extract the canonical `Duration: HH:MM:SS.MS, ...` value ffmpeg emits once
 * when opening an input stream. Returns total seconds or null.
 */
const DURATION_RE = /Duration:\s+(\d+):(\d+):(\d+\.\d+)/

export function parseFfmpegDuration(chunk: string): number | null {
  const m = chunk.match(DURATION_RE)
  if (!m) return null
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + parseFloat(m[3])
}

/**
 * Compose the output path for a given source file under a preset's output
 * directory. Strips the source extension and substitutes `preset.extension`.
 *
 * v1 flattens subfolder structure: `/Music/sub/song.flac` →
 * `{outputDir}/song.mp3` (LOCKED). Subfolder mirror is deferred.
 *
 * Defence in depth (Pitfall 8): result is composed strictly from
 * `path.basename(src)` (extension stripped via `path.extname`) joined under
 * `outputDir`. `path.basename` discards any directory traversal in the input;
 * the result therefore cannot escape `outputDir`.
 */
export function computeOutputPath(
  srcPath: string,
  outputDir: string,
  preset: Preset
): string {
  const ext = path.extname(srcPath)
  const base = path.basename(srcPath, ext)
  return path.join(outputDir, `${base}${preset.extension}`)
}
