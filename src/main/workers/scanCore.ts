/**
 * Pure helpers shared between the scan worker and unit tests.
 *
 * MUST NOT import 'node:worker_threads' or anything from src/main/scan/* —
 * this module is unit-tested without spawning a Worker (mirrors the Phase 1
 * pattern of factoring pure handlers out of the Electron entry).
 */
import path from 'node:path'
import type { IAudioMetadata } from 'music-metadata'
import type { ScannedFile } from '../../shared/ipc-types'

/** v1 audio-file allowlist for the scan worker (planner decision on RESEARCH Open Question 1). */
export const AUDIO_EXTS = [
  '.mp3',
  '.flac',
  '.m4a',
  '.aac',
  '.wav',
  '.aiff',
  '.aif',
  '.ogg',
  '.opus'
] as const

export type AudioExt = (typeof AUDIO_EXTS)[number]

/**
 * Prefer the container reported by music-metadata; fall back to the file
 * extension; final fallback is 'UNKNOWN'. Uppercased for display consistency.
 */
export function inferFormat(filePath: string, meta?: IAudioMetadata): string {
  const container = meta?.format?.container
  if (typeof container === 'string' && container.length > 0) {
    return container.toUpperCase()
  }
  const ext = path.extname(filePath).slice(1)
  if (ext.length > 0) {
    return ext.toUpperCase()
  }
  return 'UNKNOWN'
}

/** True iff at least one non-blank genre string is present (RESEARCH SCAN-03). */
export function hasGenreTag(meta: IAudioMetadata): boolean {
  const g = meta.common?.genre
  if (!Array.isArray(g) || g.length === 0) {
    return false
  }
  return g.some((entry) => typeof entry === 'string' && entry.trim() !== '')
}

/** True iff common.bpm is a positive number (music-metadata normalises TBPM here). */
export function hasBpmTag(meta: IAudioMetadata): boolean {
  const b = meta.common?.bpm
  return typeof b === 'number' && b > 0
}

/** True iff common.key is a non-blank string (music-metadata normalises TKEY here). */
export function hasKeyTag(meta: IAudioMetadata): boolean {
  const k = meta.common?.key
  return typeof k === 'string' && k.trim() !== ''
}

/**
 * Build a ScannedFile row from a successful parseFile result.
 *
 * bitrate is reported in kbps (rounded). Numeric fields fall back to null
 * when music-metadata could not determine them — never NaN.
 */
export function rowFromMetadata(
  filePath: string,
  sizeBytes: number,
  meta: IAudioMetadata
): ScannedFile {
  const fmt = meta.format ?? {}
  const bitrate = typeof fmt.bitrate === 'number' ? Math.round(fmt.bitrate / 1000) : null
  const sampleRate = typeof fmt.sampleRate === 'number' ? fmt.sampleRate : null
  const durationSeconds = typeof fmt.duration === 'number' ? fmt.duration : null

  return {
    path: filePath,
    format: inferFormat(filePath, meta),
    bitrate,
    sizeBytes,
    sampleRate,
    durationSeconds,
    hasGenre: hasGenreTag(meta),
    hasBpm: hasBpmTag(meta),
    hasKey: hasKeyTag(meta),
    parsedOk: true,
    errorMessage: null
  }
}

/**
 * Build a ScannedFile row representing a file we could not parse.
 * Failed-parse rows are still emitted so the UI can show them greyed with
 * an "Erreur" badge (planner decision on RESEARCH Open Question 6).
 */
export function errorRow(filePath: string, sizeBytes: number, message: string): ScannedFile {
  return {
    path: filePath,
    format: inferFormat(filePath),
    bitrate: null,
    sizeBytes,
    sampleRate: null,
    durationSeconds: null,
    hasGenre: false,
    hasBpm: false,
    hasKey: false,
    parsedOk: false,
    errorMessage: message
  }
}
