import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CrateKeeperApi,
  ScannedFile,
  TaggerQueueResult
} from '../../../shared/ipc-types'
import { useTaggerStore } from '../store/useTaggerStore'
import { TaggerView } from './TaggerView'

function makeFile(path: string, overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path,
    format: 'mp3',
    bitrate: 320,
    sizeBytes: 1024,
    sampleRate: 44100,
    durationSeconds: 200,
    hasGenre: false,
    hasBpm: false,
    hasKey: false,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

interface MockedBridge {
  loadQueue: ReturnType<typeof vi.fn>
  saveEdit: ReturnType<typeof vi.fn>
  getGenrePresets: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
}

function installMock(queue: ScannedFile[]): MockedBridge {
  const queueResult: TaggerQueueResult = {
    scanId: 'scan-1',
    files: queue,
    pendingEdits: {}
  }
  const loadQueue = vi.fn().mockResolvedValue(queueResult)
  const saveEdit = vi.fn().mockResolvedValue(undefined)
  const getGenrePresets = vi.fn().mockResolvedValue({
    source: 'defaults',
    presets: [
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
  })
  const getSetting = vi.fn().mockResolvedValue(null)
  const setSetting = vi.fn().mockResolvedValue(undefined)
  globalThis.window.crateKeeper = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue(null),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    getSetting,
    setSetting,
    scan: {
      start: vi.fn(),
      cancel: vi.fn(),
      exportCsv: vi.fn(),
      onEvent: vi.fn().mockReturnValue(() => {})
    } as unknown as CrateKeeperApi['scan'],
    conversion: {} as unknown as CrateKeeperApi['conversion'],
    tagger: {
      loadQueue,
      saveEdit,
      deleteEdit: vi.fn(),
      getSession: vi.fn(),
      setSession: vi.fn(),
      getGenrePresets
    } as unknown as CrateKeeperApi['tagger']
  }
  return { loadQueue, saveEdit, getGenrePresets, getSetting, setSetting }
}

describe('TaggerView', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
  })

  it('on mount calls loadQueue + loadGenrePresets + loadMuteSetting', async () => {
    const m = installMock([])
    render(<TaggerView />)
    await waitFor(() => {
      expect(m.loadQueue).toHaveBeenCalledTimes(1)
      expect(m.getGenrePresets).toHaveBeenCalledTimes(1)
      expect(m.getSetting).toHaveBeenCalledWith('tagger.muteEnabled')
    })
  })

  it('status=empty renders the French CTA copy', async () => {
    installMock([])
    render(<TaggerView />)
    await waitFor(() => {
      expect(
        screen.getByText(/Lance un scan dans l'Analyser pour démarrer/)
      ).toBeInTheDocument()
    })
  })

  it('status=loading renders Chargement…', () => {
    installMock([makeFile('/m/a.mp3')])
    render(<TaggerView />)
    // Before the loadQueue promise resolves, status is still 'loading'.
    expect(screen.getByText(/Chargement/)).toBeInTheDocument()
  })

  it('status=ready renders a TaggerCard with current file basename', async () => {
    installMock([makeFile('/m/a.mp3')])
    render(<TaggerView />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'a.mp3'
      )
    })
  })

  it('end-of-queue (currentIndex >= length) renders French completion copy', async () => {
    installMock([makeFile('/m/a.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    // Skip past the last file.
    act(() => {
      useTaggerStore.getState().skip()
    })
    expect(
      screen.getByText('Bibliothèque terminée pour ce scan.')
    ).toBeInTheDocument()
  })

  it('clicking Sauver adds exit-left class, awaits transitionend, then calls keep', async () => {
    const m = installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))

    // class added synchronously after click
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-left')
    })

    // Dispatch transitionend to resolve the runWithSlide await.
    act(() => {
      wrapper.dispatchEvent(
        new Event('transitionend', { bubbles: false, cancelable: false })
      )
    })

    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(wrapper.className).not.toContain('tagger-card--exit-left')
    })
  })

  it('clicking Passer adds exit-right class, awaits transitionend, then calls skip', async () => {
    installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }))

    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-right')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      // After skip, the current index advanced.
      expect(useTaggerStore.getState().currentIndex).toBe(1)
    })
  })

  it('ArrowLeft triggers slide-left + keep', async () => {
    const m = installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-left')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
    })
  })

  it('unmounting removes the document keydown listener', async () => {
    installMock([makeFile('/m/a.mp3')])
    const removeSpy = vi.spyOn(document, 'removeEventListener')
    const { unmount } = render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('keydown', expect.any(Function))
    removeSpy.mockRestore()
  })
})
