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

  it('switches the visible view to Tagger when the Tagger nav button is clicked', async () => {
    render(<App />)

    fireEvent.click(screen.getByRole('button', { name: /tagger/i }))

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /^tagger$/i, level: 2 })).toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /^analyser$/i, level: 2 })).not.toBeInTheDocument()
  })
})
