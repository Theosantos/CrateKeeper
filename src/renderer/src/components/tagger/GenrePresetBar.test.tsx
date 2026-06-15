import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { GenrePresetBar } from './GenrePresetBar'

const NINE = [
  'House',
  'Techno',
  'Afro House',
  'Melodic',
  'Disco',
  'Hip-Hop',
  'Funk',
  'Deep',
  'Electronica'
]

describe('GenrePresetBar', () => {
  it('renders exactly 9 buttons with their labels', () => {
    render(<GenrePresetBar presets={NINE} onApply={() => {}} />)
    const btns = screen.getAllByRole('button')
    expect(btns).toHaveLength(9)
    expect(btns[0]).toHaveTextContent('House')
    expect(btns[8]).toHaveTextContent('Electronica')
  })

  it('each button shows the slot number hint 1-9', () => {
    render(<GenrePresetBar presets={NINE} onApply={() => {}} />)
    for (let n = 1; n <= 9; n += 1) {
      expect(screen.getByText(String(n))).toBeInTheDocument()
    }
  })

  it('clicking button N calls onApply(N)', () => {
    const onApply = vi.fn()
    render(<GenrePresetBar presets={NINE} onApply={onApply} />)
    const btns = screen.getAllByRole('button')
    fireEvent.click(btns[2])
    expect(onApply).toHaveBeenCalledWith(3)
  })

  it('renders only available slots when presets.length < 9 (no crash)', () => {
    render(<GenrePresetBar presets={['A', 'B', 'C']} onApply={() => {}} />)
    expect(screen.getAllByRole('button')).toHaveLength(3)
  })
})
