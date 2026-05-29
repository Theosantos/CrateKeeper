import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { ScannedFile } from '../../../../shared/ipc-types'
import { VirtualizedFileTable } from './VirtualizedFileTable'

// jsdom has no layout + no ResizeObserver, so @tanstack/react-virtual's
// real measurement loop never fires its scroll-element rect callback and
// returns zero virtual items. We replace useVirtualizer with a faithful
// stand-in that produces a bounded overscan window — exactly the contract
// we want to assert at the DOM level. The real virtualizer is exercised in
// the manual checkpoint against a real scan.
const VISIBLE_WINDOW = 32

vi.mock('@tanstack/react-virtual', () => {
  type Options = { count: number; estimateSize: () => number }
  return {
    useVirtualizer: (opts: Options) => {
      const size = opts.estimateSize()
      const cap = Math.min(opts.count, VISIBLE_WINDOW)
      const items = Array.from({ length: cap }, (_, i) => ({
        index: i,
        key: i,
        start: i * size,
        end: (i + 1) * size,
        size,
        lane: 0
      }))
      return {
        getVirtualItems: () => items,
        getTotalSize: () => opts.count * size
      }
    }
  }
})

function makeRow(i: number, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path: `/music/lib/track-${i}.mp3`,
    format: 'mp3',
    bitrate: 320,
    sizeBytes: 5_400_000,
    sampleRate: 44_100,
    durationSeconds: 200,
    hasGenre: true,
    hasBpm: true,
    hasKey: true,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

// Quiet beforeEach hook kept for symmetry; the mock above does the heavy lifting.
beforeEach(() => {})

describe('VirtualizedFileTable', () => {
  it('renders the header row and an empty-state message when rows=[]', () => {
    render(<VirtualizedFileTable rows={[]} />)
    expect(screen.getByRole('columnheader', { name: /fichier/i })).toBeInTheDocument()
    expect(screen.getByText(/aucun fichier scanné/i)).toBeInTheDocument()
  })

  it('renders a small subset of row nodes for a 5000-row synthetic dataset', () => {
    const rows = Array.from({ length: 5000 }, (_, i) => makeRow(i))
    const { container } = render(<VirtualizedFileTable rows={rows} />)
    const rendered = container.querySelectorAll('[data-row]')
    // Under jsdom the virtualizer may render slightly more than the visible
    // band due to overscan and lack of layout, but it MUST be far below 5000
    // — otherwise virtualization is broken and the SCAN-05 invariant is gone.
    expect(rendered.length).toBeLessThan(200)
    expect(rendered.length).toBeGreaterThan(0)
  })

  it('renders the Erreur badge for a row with parsedOk=false', () => {
    const rows = [makeRow(1, { parsedOk: false, errorMessage: 'EBADF' })]
    render(<VirtualizedFileTable rows={rows} />)
    expect(screen.getByRole('status', { name: /erreur de lecture/i })).toBeInTheDocument()
  })

  it('renders G + K filled and B absent when hasGenre=true, hasBpm=false, hasKey=true', () => {
    const rows = [makeRow(1, { hasGenre: true, hasBpm: false, hasKey: true })]
    const { container } = render(<VirtualizedFileTable rows={rows} />)
    const g = screen.getByRole('status', { name: /genre: présent/i })
    const b = screen.getByRole('status', { name: /bpm: absent/i })
    const k = screen.getByRole('status', { name: /key: présent/i })
    expect(g).toHaveClass('tag-badge--present')
    expect(b).toHaveClass('tag-badge--absent')
    expect(k).toHaveClass('tag-badge--present')
    // No Erreur badge on a successful parse
    expect(container.querySelector('.tag-badge--error')).toBeNull()
  })

  it('formats null bitrate as "—" and durationSeconds=125 as "2:05"', () => {
    const rows = [makeRow(1, { bitrate: null, durationSeconds: 125 })]
    render(<VirtualizedFileTable rows={rows} />)
    expect(screen.getByText('—')).toBeInTheDocument()
    expect(screen.getByText('2:05')).toBeInTheDocument()
  })
})
