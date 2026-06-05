import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { ArtistTitleSplit } from './ArtistTitleSplit'

describe('ArtistTitleSplit', () => {
  it('renders nothing when artist is non-empty', () => {
    const { container } = render(
      <ArtistTitleSplit
        title="Daft Punk - Around The World"
        artistEmpty={false}
        onApply={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders nothing when title has no separator', () => {
    const { container } = render(
      <ArtistTitleSplit
        title="Solo Title"
        artistEmpty={true}
        onApply={() => {}}
      />
    )
    expect(container.firstChild).toBeNull()
  })

  it('renders 2 suggestion buttons when artist empty + separator present', () => {
    render(
      <ArtistTitleSplit
        title="Daft Punk - Around The World"
        artistEmpty={true}
        onApply={() => {}}
      />
    )
    const btns = screen.getAllByRole('button')
    expect(btns).toHaveLength(2)
    expect(btns[0].textContent).toContain('Artiste : Daft Punk')
    expect(btns[0].textContent).toContain('Titre : Around The World')
    expect(btns[1].textContent).toContain('Artiste : Around The World')
    expect(btns[1].textContent).toContain('Titre : Daft Punk')
  })

  it('clicking a suggestion calls onApply with the SplitOption', () => {
    const onApply = vi.fn()
    render(
      <ArtistTitleSplit
        title="Daft Punk - Around The World"
        artistEmpty={true}
        onApply={onApply}
      />
    )
    const btns = screen.getAllByRole('button')
    fireEvent.click(btns[0])
    expect(onApply).toHaveBeenCalledWith({
      artist: 'Daft Punk',
      title: 'Around The World'
    })
  })
})
