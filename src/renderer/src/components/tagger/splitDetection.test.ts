import { describe, expect, it } from 'vitest'
import { suggestSplits } from './splitDetection'

describe('suggestSplits', () => {
  it('splits on single dash separator with two complementary options', () => {
    const r = suggestSplits('Daft Punk - Around The World')
    expect(r).toEqual({
      a: { artist: 'Daft Punk', title: 'Around The World' },
      b: { artist: 'Around The World', title: 'Daft Punk' }
    })
  })

  it('splits on double-dash separator', () => {
    const r = suggestSplits('Artist X -- Track Y')
    expect(r).not.toBeNull()
    expect(r?.a).toEqual({ artist: 'Artist X', title: 'Track Y' })
  })

  it('splits on en-dash separator', () => {
    const r = suggestSplits('Artist X – Track Y')
    expect(r).not.toBeNull()
    expect(r?.a).toEqual({ artist: 'Artist X', title: 'Track Y' })
  })

  it('does NOT split on dashes without surrounding spaces', () => {
    expect(suggestSplits('track--master')).toBeNull()
  })

  it('returns null when no separator is present', () => {
    expect(suggestSplits('Solo Title')).toBeNull()
  })

  it('returns null when nothing is to the left of the separator', () => {
    expect(suggestSplits('- leading')).toBeNull()
  })

  it('returns null when nothing is to the right of the separator', () => {
    expect(suggestSplits('trailing -')).toBeNull()
  })

  it('trims whitespace on both halves', () => {
    const r = suggestSplits('  Artist  -   Title  ')
    expect(r?.a).toEqual({ artist: 'Artist', title: 'Title' })
  })
})
