import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { useAppStore } from './store/useAppStore'
import type { DjUtilsApi } from '../../shared/ipc-types'

function installDjUtilsMock(): void {
  const api: DjUtilsApi = {
    pickFolder: vi.fn<DjUtilsApi['pickFolder']>().mockResolvedValue(null),
    getRootFolder: vi.fn<DjUtilsApi['getRootFolder']>().mockResolvedValue(null),
    setRootFolder: vi.fn<DjUtilsApi['setRootFolder']>().mockResolvedValue(undefined)
  }
  globalThis.window.djUtils = api
}

describe('App', () => {
  beforeEach(() => {
    useAppStore.setState({ activeTool: 'analyser', rootFolder: null })
    installDjUtilsMock()
  })

  it('renders the three tool labels in the navigation (FOUND-01)', async () => {
    render(<App />)

    const nav = screen.getByRole('navigation', { name: /outils principaux/i })
    expect(nav).toBeInTheDocument()

    // Each tool exposes a button with its accessible name.
    expect(screen.getByRole('button', { name: /analyser/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /convertir/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /tagger/i })).toBeInTheDocument()
  })

  it('shows the Analyser view by default', () => {
    render(<App />)

    // Heading id matches AnalyserView's aria-labelledby
    expect(screen.getByRole('heading', { name: /^analyser$/i, level: 2 })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^tagger$/i, level: 2 })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: /^convertir$/i, level: 2 })).not.toBeInTheDocument()
  })

  it('pins the first and last path segments so they survive truncation', () => {
    useAppStore.setState({ rootFolder: '/Users/theo/Documents/Music/Library' })
    render(<App />)

    const value = document.querySelector('.folder-picker__path-value')
    expect(value).not.toBeNull()
    expect(value?.getAttribute('title')).toBe('/Users/theo/Documents/Music/Library')

    const head = value?.querySelector('.folder-picker__path-head')
    const middle = value?.querySelector('.folder-picker__path-middle')
    const tail = value?.querySelector('.folder-picker__path-tail')
    expect(head?.textContent).toBe('/Users')
    expect(middle?.textContent).toBe('/theo/Documents/Music')
    expect(tail?.textContent).toBe('/Library')
  })

  it('switches the visible view to Tagger when the Tagger nav button is clicked', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /tagger/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^tagger$/i, level: 2 })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /^analyser$/i, level: 2 })).not.toBeInTheDocument()
  })
})
