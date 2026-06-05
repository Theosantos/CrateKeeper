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

export function suggestSplits(rawTitle: string): SplitSuggestion | null {
  for (const sep of SEPARATORS) {
    const idx = rawTitle.indexOf(sep)
    if (idx > 0 && idx + sep.length < rawTitle.length) {
      const left = rawTitle.slice(0, idx).trim()
      const right = rawTitle.slice(idx + sep.length).trim()
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
