import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import App from './App'
import { useAppStore } from './store/useAppStore'
import type { CrateKeeperApi } from '../../shared/ipc-types'

function installCrateKeeperMock(): void {
  const api: CrateKeeperApi = {
    pickFolder: vi.fn<CrateKeeperApi['pickFolder']>().mockResolvedValue(null),
    getRootFolder: vi.fn<CrateKeeperApi['getRootFolder']>().mockResolvedValue(null),
    setRootFolder: vi.fn<CrateKeeperApi['setRootFolder']>().mockResolvedValue(undefined),
    getSetting: vi.fn<CrateKeeperApi['getSetting']>().mockResolvedValue(null),
    setSetting: vi.fn<CrateKeeperApi['setSetting']>().mockResolvedValue(undefined),
    scan: {
      start: vi.fn<CrateKeeperApi['scan']['start']>().mockResolvedValue(''),
      cancel: vi.fn<CrateKeeperApi['scan']['cancel']>().mockResolvedValue(undefined),
      exportCsv: vi.fn<CrateKeeperApi['scan']['exportCsv']>().mockResolvedValue(null),
      onEvent: vi.fn<CrateKeeperApi['scan']['onEvent']>().mockReturnValue(() => {})
    },
    conversion: {
      start: vi.fn<CrateKeeperApi['conversion']['start']>().mockResolvedValue(''),
      cancel: vi.fn<CrateKeeperApi['conversion']['cancel']>().mockResolvedValue(undefined),
      listResumable: vi
        .fn<CrateKeeperApi['conversion']['listResumable']>()
        .mockResolvedValue([]),
      resume: vi.fn<CrateKeeperApi['conversion']['resume']>().mockResolvedValue(undefined),
      discard: vi.fn<CrateKeeperApi['conversion']['discard']>().mockResolvedValue(undefined),
      pickFiles: vi.fn<CrateKeeperApi['conversion']['pickFiles']>().mockResolvedValue(null),
      onEvent: vi.fn<CrateKeeperApi['conversion']['onEvent']>().mockReturnValue(() => {})
    },
    tagger: {
      loadQueue: vi.fn<CrateKeeperApi['tagger']['loadQueue']>().mockResolvedValue({
        scanId: null,
        files: [],
        pendingEdits: {}
      }),
      saveEdit: vi.fn<CrateKeeperApi['tagger']['saveEdit']>().mockResolvedValue(undefined),
      deleteEdit: vi.fn<CrateKeeperApi['tagger']['deleteEdit']>().mockResolvedValue(undefined),
      getSession: vi.fn<CrateKeeperApi['tagger']['getSession']>().mockResolvedValue(null),
      setSession: vi.fn<CrateKeeperApi['tagger']['setSession']>().mockResolvedValue(undefined),
      getGenrePresets: vi
        .fn<CrateKeeperApi['tagger']['getGenrePresets']>()
        .mockResolvedValue({ source: 'defaults', presets: [] }),
      getWaveform: vi
        .fn<CrateKeeperApi['tagger']['getWaveform']>()
        .mockResolvedValue({ peaks: [], durationSec: null })
    }
  }
  globalThis.window.crateKeeper = api
}

describe('App', () => {
  beforeEach(() => {
    useAppStore.setState({ activeTool: 'analyser', rootFolder: null })
    installCrateKeeperMock()
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
