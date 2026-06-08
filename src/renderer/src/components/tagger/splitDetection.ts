/**
 * Pure helper: detect an Artist/Title split suggestion from a raw title string.
 * LOCKED separators (case-sensitive on the surrounding spaces):
 *   - ' - '   (space-dash-space)
 *   - ' -- '  (space-double-dash-space)
 *   - ' – '   (space-en-dash-space)
 *
 * Returns two complementary suggestions (left=artist OR right=artist) so the
 * user can one-click whichever fits their library convention.
 */

export interface SplitOption {
  artist: string
  title: string
}

export interface SplitSuggestion {
  a: SplitOption
  b: SplitOption
}

const SEPARATORS = [' - ', ' -- ', ' – '] as const

/**
 * Audio file extensions stripped before separator scanning. Mirrors
 * AUDIO_EXTS from src/main/workers/scanCore.ts — duplicated here as a
 * renderer-side const because that module is main-only.
 *
 * Without this, a basename like "Artist - Track.m4a" would surface
 * ".m4a" as part of the suggested title.
 */
const AUDIO_EXTS = [
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

function stripAudioExt(s: string): string {
  const lower = s.toLowerCase()
  for (const ext of AUDIO_EXTS) {
    if (lower.endsWith(ext)) {
      return s.slice(0, s.length - ext.length)
    }
  }
  return s
}

export function suggestSplits(rawTitle: string): SplitSuggestion | null {
  const stripped = stripAudioExt(rawTitle)
  for (const sep of SEPARATORS) {
    const idx = stripped.indexOf(sep)
    if (idx > 0 && idx + sep.length < stripped.length) {
      const left = stripped.slice(0, idx).trim()
      const right = stripped.slice(idx + sep.length).trim()
      if (left.length > 0 && right.length > 0) {
        return {
          a: { artist: left, title: right },
          b: { artist: right, title: left }
        }
      }
    }
  }
  return null
}
