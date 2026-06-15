import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor
} from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CrateKeeperApi,
  ScannedFile,
  TaggerQueueResult,
  TaggerSession
} from '../../../../shared/ipc-types'
import { useTaggerStore } from '../../store/useTaggerStore'
import { TaggerView } from '../TaggerView'

/**
 * Plan 04-03 Task 3 — End-to-end Tagger integration test.
 *
 * Exercises the REAL useTaggerStore + REAL TaggerView wiring; only
 * window.crateKeeper.tagger.* is mocked. Proves that Plan 04-01 (IPC
 * surface), Plan 04-02 (card UX) and Plan 04-03 (session resume + undo)
 * compose correctly across a complete user flow:
 *
 *   load → edit → keep → skip → undo-keep → undo-skip → resume-on-remount
 *   → library-change resilience → beforeunload flush → input-focus gate
 */

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

interface MockedTaggerBridge {
  loadQueue: ReturnType<typeof vi.fn>
  saveEdit: ReturnType<typeof vi.fn>
  deleteEdit: ReturnType<typeof vi.fn>
  getSession: ReturnType<typeof vi.fn>
  setSession: ReturnType<typeof vi.fn>
  getGenrePresets: ReturnType<typeof vi.fn>
  getSetting: ReturnType<typeof vi.fn>
  setSetting: ReturnType<typeof vi.fn>
}

function installMock(opts: {
  files: ScannedFile[]
  session?: TaggerSession | null
}): MockedTaggerBridge {
  const queueResult: TaggerQueueResult = {
    scanId: 'test-scan',
    files: opts.files,
    pendingEdits: {}
  }
  const loadQueue = vi.fn().mockResolvedValue(queueResult)
  const saveEdit = vi.fn().mockResolvedValue(undefined)
  const deleteEdit = vi.fn().mockResolvedValue(undefined)
  const getSession = vi.fn().mockResolvedValue(opts.session ?? null)
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
  const getWaveform = vi
    .fn()
    .mockResolvedValue({ peaks: [], durationSec: null })
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
      getGenrePresets,
      getWaveform
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

/** Helper: dispatch transitionend on the slide wrapper to advance the slide. */
function settleSlide(): void {
  const wrapper = screen.getByTestId('tagger-card-wrapper')
  act(() => {
    wrapper.dispatchEvent(new Event('transitionend'))
  })
}

describe('Tagger end-to-end', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
    vi.clearAllMocks()
  })

  it('runs the full happy path: edit → keep → skip → undo → resume → library-change → flush → focus-gate', async () => {
    const files = [
      makeFile('/m/a.mp3'),
      makeFile('/m/b.mp3', { hasGenre: true }),
      makeFile('/m/c.mp3', { hasBpm: true }),
      makeFile('/m/d.mp3', { hasKey: true })
    ]
    const m = installMock({ files })

    const { unmount } = render(<TaggerView />)

    // First card mounts.
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'a.mp3'
      )
    })

    // ── Type into Genre input → dirty edits updates.
    const genreInput = screen.getByLabelText('Genre') as HTMLInputElement
    fireEvent.change(genreInput, { target: { value: 'Techno' } })
    await waitFor(() => {
      expect(
        useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre
      ).toBe('Techno')
    })

    // ── Input-focus gate: pressing '3' while genre input is focused should
    // NOT apply preset 3 (Afro House).
    genreInput.focus()
    fireEvent.keyDown(document, { key: '3' })
    expect(
      useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre
    ).toBe('Techno')

    // Press ArrowLeft while focused on input → keep should NOT fire.
    fireEvent.keyDown(document, { key: 'ArrowLeft' })
    expect(m.saveEdit).not.toHaveBeenCalled()

    // ── Blur and press '3' → preset applied (Afro House from defaults).
    genreInput.blur()
    fireEvent.keyDown(document, { key: '3' })
    await waitFor(() => {
      expect(
        useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre
      ).toBe('Afro House')
    })

    // ── Click Sauver → saveEdit fires with merged values; advance to b.mp3.
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    settleSlide()
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: '/m/a.mp3',
          genre: 'Afro House'
        })
      )
      expect(useTaggerStore.getState().currentIndex).toBe(1)
      expect(useTaggerStore.getState().lastAction?.type).toBe('keep')
    })

    // ── Press ArrowRight → skip from b.mp3 to c.mp3.
    fireEvent.keyDown(document, { key: 'ArrowRight' })
    settleSlide()
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(2)
      expect(useTaggerStore.getState().lastAction?.type).toBe('skip')
    })

    // ── Cmd+Z → undo the skip; rewind index to 1; lastAction cleared.
    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    settleSlide()
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(1)
      expect(useTaggerStore.getState().lastAction).toBeNull()
    })

    // ── Double Cmd+Z → no-op (lastAction is null), no extra IPC.
    const saveCountBefore = m.saveEdit.mock.calls.length
    const deleteCountBefore = m.deleteEdit.mock.calls.length
    fireEvent.keyDown(document, { key: 'z', metaKey: true })
    // No slide should have started.
    expect(m.saveEdit.mock.calls.length).toBe(saveCountBefore)
    expect(m.deleteEdit.mock.calls.length).toBe(deleteCountBefore)
    expect(useTaggerStore.getState().currentIndex).toBe(1)

    // ── Advance through the rest of the queue with rapid keeps.
    for (let i = 0; i < 3; i++) {
      fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
      settleSlide()
      // Wait for the keep to settle before the next click.
      await waitFor(() => {
        expect(useTaggerStore.getState().currentIndex).toBe(2 + i)
      })
    }

    // ── End-of-queue completion message renders (French).
    await waitFor(() => {
      expect(
        screen.getByText('Bibliothèque terminée pour ce scan.')
      ).toBeInTheDocument()
    })

    // ── beforeunload flushes the pending debounced setSession synchronously.
    // After the rapid keeps + end-of-queue, the pending session payload should
    // be {currentFilePath: null, scanId: 'test-scan'}.
    const setSessionCallsBefore = m.setSession.mock.calls.length
    act(() => {
      window.dispatchEvent(new Event('beforeunload'))
    })
    // setSession fired at least once with null after flush.
    expect(m.setSession.mock.calls.length).toBeGreaterThan(setSessionCallsBefore)
    expect(m.setSession).toHaveBeenLastCalledWith({
      currentFilePath: null,
      scanId: 'test-scan'
    })

    // ── Resume on remount: getSession now returns currentFilePath='/m/c.mp3'.
    unmount()
    cleanup()
    useTaggerStore.getState().reset()
    installMock({
      files,
      session: {
        rootFolder: '/m',
        currentFilePath: '/m/c.mp3',
        scanId: 'test-scan',
        updatedAt: 1
      }
    })
    render(<TaggerView />)
    await waitFor(() => {
      expect(useTaggerStore.getState().currentIndex).toBe(2)
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'c.mp3'
      )
    })

    // ── Library-change resilience: remount with a session pointing at a path
    // not in the (new) queue → fall back to index 0.
    cleanup()
    useTaggerStore.getState().reset()
    installMock({
      files,
      session: {
        rootFolder: '/m',
        currentFilePath: '/missing/file.mp3',
        scanId: 'test-scan',
        updatedAt: 1
      }
    })
    render(<TaggerView />)
    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent(
        'a.mp3'
      )
    })
    expect(useTaggerStore.getState().currentIndex).toBe(0)
  })

  it('undo after Keep restores prior state via deleteEdit + index rewind', async () => {
    const files = [makeFile('/m/x.mp3'), makeFile('/m/y.mp3')]
    const m = installMock({ files })
    render(<TaggerView />)
    await waitFor(() => screen.getByRole('heading', { level: 3 }))

    // Edit + Keep.
    fireEvent.change(screen.getByLabelText('Genre'), {
      target: { value: 'Disco' }
    })
    fireEvent.click(screen.getByRole('button', { name: 'Sauver' }))
    settleSlide()
    await waitFor(() => {
      expect(m.saveEdit).toHaveBeenCalledTimes(1)
      expect(useTaggerStore.getState().currentIndex).toBe(1)
    })

    // Undo via the Annuler button.
    const undoBtn = screen.getByRole('button', { name: 'Annuler' })
    expect(undoBtn).not.toBeDisabled()
    fireEvent.click(undoBtn)
    settleSlide()
    await waitFor(() => {
      // Prior was null (no previous pending row) → deleteEdit.
      expect(m.deleteEdit).toHaveBeenCalledWith('/m/x.mp3')
      expect(useTaggerStore.getState().currentIndex).toBe(0)
      expect(useTaggerStore.getState().lastAction).toBeNull()
    })

    // Annuler now disabled again.
    expect(screen.getByRole('button', { name: 'Annuler' })).toBeDisabled()
  })
})
