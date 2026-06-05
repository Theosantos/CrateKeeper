import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { RatingStars } from './RatingStars'

describe('RatingStars', () => {
  it('renders 5 buttons with French aria-labels', () => {
    render(<RatingStars rating={null} onChange={() => {}} />)
    expect(screen.getByRole('button', { name: '1 étoile' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '2 étoiles' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: '5 étoiles' })
    ).toBeInTheDocument()
    expect(screen.getAllByRole('button')).toHaveLength(5)
  })

  it('clicking the Nth star emits onChange(N)', () => {
    const onChange = vi.fn()
    render(<RatingStars rating={null} onChange={onChange} />)
    fireEvent.click(screen.getByRole('button', { name: '3 étoiles' }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('stars 1..rating show filled class', () => {
    render(<RatingStars rating={3} onChange={() => {}} />)
    const btns = screen.getAllByRole('button')
    expect(btns[0].className).toContain('tagger-star--filled')
    expect(btns[1].className).toContain('tagger-star--filled')
    expect(btns[2].className).toContain('tagger-star--filled')
    expect(btns[3].className).not.toContain('tagger-star--filled')
    expect(btns[4].className).not.toContain('tagger-star--filled')
  })
})
