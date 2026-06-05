/**
 * Phase 4 Plan 01 — Genre preset merge helper.
 *
 * Pure module. No imports beyond optional types — keeps the helper trivially
 * testable and free of DB / Electron coupling (LOCKED in 04-CONTEXT.md).
 *
 * Order (LOCKED): library top-N first, fallback fills remaining slots; dedup
 * preserves library order on collision; output capped at 9.
 */

export const HARDCODED_GENRE_FALLBACK: ReadonlyArray<string> = [
  'House',
  'Techno',
  'Afro House',
  'Melodic',
  'Disco',
  'Hip-Hop',
  'Funk',
  'Deep',
  'Electronica'
] as const

const MAX_PRESETS = 9

/**
 * Merge `libraryTop` with `fallback` into a 9-slot preset list.
 *
 * - Library entries come first (preserve their order).
 * - Fallback entries fill remaining slots without duplicates.
 * - Output length is at most 9; less only when library + fallback together
 *   provide fewer than 9 unique strings.
 * - Dedup is case-sensitive ('house' !== 'House').
 */
export function mergeGenrePresets(
  libraryTop: readonly string[],
  fallback: readonly string[] = HARDCODED_GENRE_FALLBACK
): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const g of libraryTop) {
    if (out.length >= MAX_PRESETS) break
    if (!seen.has(g)) {
      out.push(g)
      seen.add(g)
    }
  }
  for (const g of fallback) {
    if (out.length >= MAX_PRESETS) break
    if (!seen.has(g)) {
      out.push(g)
      seen.add(g)
    }
  }
  return out
}
