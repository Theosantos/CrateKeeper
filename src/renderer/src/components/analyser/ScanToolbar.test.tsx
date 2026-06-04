import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { ScanToolbar } from './ScanToolbar'
import { useScanStore } from '../../store/useScanStore'
import { useAppStore } from '../../store/useAppStore'
import { useConversionStore } from '../../store/useConversionStore'
import type { CrateKeeperApi } from '../../../../shared/ipc-types'

function installCrateKeeperMock(): void {
  const api: CrateKeeperApi = {
    pickFolder: vi.fn<CrateKeeperApi['pickFolder']>().mockResolvedValue(null),
    getRootFolder: vi.fn<CrateKeeperApi['getRootFolder']>().mockResolvedValue(null),
    setRootFolder: vi.fn<CrateKeeperApi['setRootFolder']>().mockResolvedValue(undefined),
    getSetting: vi.fn<CrateKeeperApi['getSetting']>().mockResolvedValue(null),
    setSetting: vi.fn<CrateKeeperApi['setSetting']>().mockResolvedValue(undefined),
    scan: {
      start: vi.fn().mockResolvedValue(''),
      cancel: vi.fn().mockResolvedValue(undefined),
      exportCsv: vi.fn().mockResolvedValue(null),
      onEvent: vi.fn().mockReturnValue(() => {})
    },
    conversion: {
      start: vi.fn().mockResolvedValue(''),
      cancel: vi.fn().mockResolvedValue(undefined),
      listResumable: vi.fn().mockResolvedValue([]),
      resume: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
      pickFiles: vi.fn().mockResolvedValue(null),
      onEvent: vi.fn().mockReturnValue(() => {})
    }
  }
  globalThis.window.crateKeeper = api
}

describe('ScanToolbar — Convertir selection action', () => {
  beforeEach(() => {
    installCrateKeeperMock()
    useAppStore.setState({ activeTool: 'analyser', rootFolder: '/music' })
    useScanStore.setState({
      scanId: 'scan-A',
      status: 'done',
      rows: [],
      totalFiles: 0,
      durationMs: 0,
      error: null,
      exporting: false,
      lastExportPath: null,
      selectedFilePaths: new Set<string>()
    })
    useConversionStore.getState().reset()
  })

  it('does not render the Convertir button when nothing is selected', () => {
    render(<ScanToolbar />)
    expect(
      screen.queryByRole('button', { name: /convertir \d+ fichier/i })
    ).not.toBeInTheDocument()
  })

  it('renders the Convertir button with singular "fichier" when exactly one is selected', () => {
    useScanStore.setState({
      selectedFilePaths: new Set<string>(['/music/a.mp3'])
    })
    render(<ScanToolbar />)
    const btn = screen.getByRole('button', { name: /^convertir 1 fichier$/i })
    expect(btn).toBeInTheDocument()
  })

  it('renders the Convertir button with plural "fichiers" when more than one is selected', () => {
    useScanStore.setState({
      selectedFilePaths: new Set<string>(['/music/a.mp3', '/music/b.mp3'])
    })
    render(<ScanToolbar />)
    expect(
      screen.getByRole('button', { name: /^convertir 2 fichiers$/i })
    ).toBeInTheDocument()
  })

  it('clicking the Convertir button seeds useConversionStore and switches activeTool to convertir', () => {
    useScanStore.setState({
      selectedFilePaths: new Set<string>(['/music/a.mp3', '/music/b.mp3'])
    })
    render(<ScanToolbar />)
    fireEvent.click(screen.getByRole('button', { name: /^convertir 2 fichiers$/i }))

    expect(useConversionStore.getState().pendingFilePaths).toEqual([
      '/music/a.mp3',
      '/music/b.mp3'
    ])
    expect(useAppStore.getState().activeTool).toBe('convertir')
  })
})
