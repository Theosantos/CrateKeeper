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
  deleteEdit: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
  setSession: ReturnType<typeof vi.fn>
  getGenrePresets: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
}

function installMock(
  queue: ScannedFile[],
  opts: {
    session?: { currentFilePath: string | null; scanId: string | null } | null
    pendingEdits?: TaggerQueueResult['pendingEdits']
  } = {}
): MockedBridge {
  const queueResult: TaggerQueueResult = {
    scanId: 'scan-1',
    files: queue,
    pendingEdits: opts.pendingEdits ?? {}
  }
  const loadQueue = vi.fn().mockResolvedValue(queueResult)
  const saveEdit = vi.fn().mockResolvedValue(undefined)
  const deleteEdit = vi.fn().mockResolvedValue(undefined)
  const sessionVal =
    opts.session === undefined
      ? null
      : opts.session === null
        ? null
        : {
            rootFolder: '/m',
            currentFilePath: opts.session.currentFilePath,
            scanId: opts.session.scanId,
            updatedAt: 0
          }
  const getSession = vi.fn().mockResolvedValue(sessionVal)
  const setSession = vi.fn().mockResolvedValue(undefined)
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
      deleteEdit,
      getSession,
      setSession,
      getGenrePresets
    } as unknown as CrateKeeperApi['tagger']
  }
  return {
    loadQueue,
    saveEdit,
    deleteEdit,
    getSession,
    setSession,
    getGenrePresets,
    getSetting,
    setSetting
  }
}

describe('TaggerView', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
  })

  it('on mount calls loadQueue + loadGenrePresets', async () => {
    const m = installMock([])
    render(<TaggerView />)
    await waitFor(() => {
      expect(m.loadQueue).toHaveBeenCalledTimes(1)
      expect(m.getGenrePresets).toHaveBeenCalledTimes(1)
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

  // ───────────── Plan 04-03: session resume + debounce + undo ──────────────

  it('on mount jumps currentIndex to session.currentFilePath when found in queue', async () => {
    installMock(
      [
        makeFile('/m/a.mp3'),
        makeFile('/m/b.mp3'),
        makeFile('/m/c.mp3'),
        makeFile('/m/d.mp3')
      ],
      { session: { currentFilePath: '/m/c.mp3', scanId: 'scan-1' } }
    )
    render(<TaggerView />)
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(2)
    })
  })

  it('library-change resilience: missing session path → currentIndex stays 0', async () => {
    installMock(
      [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')],
      { session: { currentFilePath: '/m/missing.mp3', scanId: 'scan-1' } }
    )
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    // Give the post-loadQueue getSession await a chance to settle.
    await Promise.resolve()
    expect(useTaggerStore.getState().currentIndex).toBe(0)
  })

  it('no session returns null → currentIndex stays 0', async () => {
    installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    expect(useTaggerStore.getState().currentIndex).toBe(0)
  })

  it('getSession is called AFTER loadQueue resolves', async () => {
    const m = installMock([makeFile('/m/a.mp3')])
    // Track ordering by recording invocation times.
    let loadQueueAt = 0
    let getSessionAt = 0
    let counter = 0
    m.loadQueue.mockImplementation(async () => {
      loadQueueAt = ++counter
      return {
        scanId: 'scan-1',
        files: [makeFile('/m/a.mp3')],
        pendingEdits: {}
      } as TaggerQueueResult
    })
    m.getSession.mockImplementation(async () => {
      getSessionAt = ++counter
      return null
    })
    render(<TaggerView />)
    await waitFor(() => {
      expect(m.getSession).toHaveBeenCalled()
    })
    expect(loadQueueAt).toBeGreaterThan(0)
    expect(getSessionAt).toBeGreaterThan(loadQueueAt)
  })

  it('Keep schedules debounced setSession with NEW file path; collapses to 1', async () => {
    const m = installMock([
      makeFile('/m/a.mp3'),
      makeFile('/m/b.mp3'),
      makeFile('/m/c.mp3'),
      makeFile('/m/d.mp3')
    ])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    const wrapper = screen.getByTestId('tagger-card-wrapper')

    // 3 rapid Keeps.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
      act(() => {
        wrapper.dispatchEvent(new Event('transitionend'))
      })
      // Wait for the saveEdit count to bump, ensuring keep() resolved and the
      // debounced setSession call was scheduled before the next iteration.
      await waitFor(() => {
        expect(m.saveEdit).toHaveBeenCalledTimes(i + 1)
      })
    }
    // No setSession fired yet (still inside debounce window).
    expect(m.setSession).not.toHaveBeenCalled()

    // Wait past the 500ms debounce trailing edge.
    await waitFor(
      () => {
        expect(m.setSession).toHaveBeenCalledTimes(1)
      },
      { timeout: 1500 }
    )
    expect(m.setSession).toHaveBeenLastCalledWith({
      currentFilePath: '/m/d.mp3',
      scanId: 'scan-1'
    })
  })

  it('beforeunload flushes the pending debounced setSession synchronously', async () => {
    const m = installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
    })
    // Debounce hasn't fired yet (500ms trailing).
    expect(m.setSession).not.toHaveBeenCalled()

    // Fire beforeunload — flush should run synchronously.
    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    expect(m.setSession).toHaveBeenCalledTimes(1)
    expect(m.setSession).toHaveBeenLastCalledWith({
      currentFilePath: '/m/b.mp3',
      scanId: 'scan-1'
    })
  })

  it('unmounting removes the beforeunload listener', async () => {
    installMock([makeFile('/m/a.mp3')])
    const removeSpy = vi.spyOn(window, 'removeEventListener')
    const { unmount } = render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    unmount()
    expect(removeSpy).toHaveBeenCalledWith('beforeunload', expect.any(Function))
    removeSpy.mockRestore()
  })

  it('Cmd+Z routes through store.undo with REVERSED slide direction', async () => {
    const m = installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    const wrapper = screen.getByTestId('tagger-card-wrapper')

    // Keep first (slide left).
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-left')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
    })

    // Cmd+Z → undo, slide RIGHT (reverse of Keep).
    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-right')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      // undo for a keep with prior=null calls deleteEdit.
      expect(m.deleteEdit).toHaveBeenCalledWith('/m/a.mp3')
    })
    expect(useTaggerStore.getState().currentIndex).toBe(0)
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('Cmd+Z after Skip slides LEFT (reverse of Skip right)', async () => {
    installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    const wrapper = screen.getByTestId('tagger-card-wrapper')

    // Skip first (slide right).
    fireEvent.click(screen.getByRole('button', { name: 'Passer' }))
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-right')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(1)
    })

    // Cmd+Z → undo of skip, slide LEFT (reverse).
    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    await waitFor(() => {
      expect(wrapper.className).toContain('tagger-card--exit-left')
    })
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(0)
    })
  })

  it('Annuler button is disabled when lastAction === null, enabled after Keep', async () => {
    installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    const undoBtn = screen.getByRole('button', { name: 'Annuler' })
    expect(undoBtn).toBeDisabled()

    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      // After advance, a NEW Annuler button is rendered for card b.mp3.
      const undoBtn2 = screen.getByRole('button', { name: 'Annuler' })
      expect(undoBtn2).not.toBeDisabled()
    })
  })

  it('clicking the Annuler button calls store.undo', async () => {
    const m = installMock([makeFile('/m/a.mp3'), makeFile('/m/b.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
    })

    // Click the Annuler button on the now-current card.
    fireEvent.click(screen.getByRole('button', { name: 'Annuler' }))
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(() => {
      expect(m.deleteEdit).toHaveBeenCalledWith('/m/a.mp3')
    })
  })

  it('end-of-queue triggers setSession with currentFilePath=null', async () => {
    const m = installMock([makeFile('/m/a.mp3')])
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))
    const wrapper = screen.getByTestId('tagger-card-wrapper')
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    act(() => {
      wrapper.dispatchEvent(new Event('transitionend'))
    })
    await waitFor(
      () => {
        expect(m.setSession).toHaveBeenCalledWith({
          currentFilePath: null,
          scanId: 'scan-1'
        })
      },
      { timeout: 1500 }
    )
  })
})
