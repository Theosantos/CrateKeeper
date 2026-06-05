import { describe, it, expect } from 'vitest'
import { mergeGenrePresets, HARDCODED_GENRE_FALLBACK } from './queueBuilder'

describe('mergeGenrePresets', () => {
  it('returns the 9 fallback genres when library is empty', () => {
    const result = mergeGenrePresets([], HARDCODED_GENRE_FALLBACK)
    expect(result).toEqual([...HARDCODED_GENRE_FALLBACK])
    expect(result).toHaveLength(9)
  })

  it('returns 9 library entries verbatim when they fill all slots', () => {
    const library = [
      'House',
      'Techno',
      'Disco',
      'Funk',
      'Soul',
      'Reggae',
      'Jazz',
      'Pop',
      'Rock'
    ]
    const result = mergeGenrePresets(library, HARDCODED_GENRE_FALLBACK)
    expect(result).toEqual(library)
  })

  it('appends fallback entries (not already present) when library has fewer than 9', () => {
    const result = mergeGenrePresets(
      ['House', 'Techno', 'Disco'],
      HARDCODED_GENRE_FALLBACK
    )
    expect(result).toHaveLength(9)
    expect(result.slice(0, 3)).toEqual(['House', 'Techno', 'Disco'])
    // The next items should be fallback entries NOT already in library.
    const remainder = result.slice(3)
    expect(remainder).not.toContain('House')
    expect(remainder).not.toContain('Techno')
    expect(remainder).not.toContain('Disco')
  })

  it('deduplicates when library and fallback overlap, library order wins', () => {
    const result = mergeGenrePresets(
      ['House', 'Techno'],
      HARDCODED_GENRE_FALLBACK
    )
    const housePositions = result.filter((g) => g === 'House')
    expect(housePositions).toHaveLength(1)
    expect(result[0]).toBe('House')
    expect(result[1]).toBe('Techno')
    expect(result).toHaveLength(9)
  })

  it('truncates library at 9 entries (fallback unused)', () => {
    const library = Array.from({ length: 20 }, (_, i) => 'g' + i)
    const result = mergeGenrePresets(library, HARDCODED_GENRE_FALLBACK)
    expect(result).toHaveLength(9)
    expect(result).toEqual(library.slice(0, 9))
  })

  it('is case-sensitive for dedup', () => {
    const result = mergeGenrePresets(['house', 'House'], HARDCODED_GENRE_FALLBACK)
    expect(result.slice(0, 2)).toEqual(['house', 'House'])
  })

  it('HARDCODED_GENRE_FALLBACK matches the LOCKED order exactly', () => {
    expect([...HARDCODED_GENRE_FALLBACK]).toEqual([
      'House',
      'Techno',
      'Afro House',
      'Melodic',
      'Disco',
      'Hip-Hop',
      'Funk',
      'Deep',
      'Electronica'
    ])
  })

  it('is pure (same input → same output)', () => {
    const a = mergeGenrePresets(['House'], HARDCODED_GENRE_FALLBACK)
    const b = mergeGenrePresets(['House'], HARDCODED_GENRE_FALLBACK)
    expect(a).toEqual(b)
  })
})
