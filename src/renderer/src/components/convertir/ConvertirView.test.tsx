import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { CrateKeeperApi, ConversionEvent } from '../../../../shared/ipc-types'
import { useAppStore } from '../../store/useAppStore'
import { useConversionStore } from '../../store/useConversionStore'
import { ConvertirView } from './ConvertirView'

// jsdom + @tanstack/react-virtual: same shim used by the analyser table test.
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

type Bridge = {
  api: CrateKeeperApi
  emit: (e: ConversionEvent) => void
  unsubscribe: ReturnType<typeof vi.fn>
}

function installBridge(overrides: Partial<CrateKeeperApi> = {}): Bridge {
  let registered: ((e: ConversionEvent) => void) | null = null
  const unsubscribe = vi.fn()
  const api: CrateKeeperApi = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue('/music'),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    getSetting: vi.fn().mockResolvedValue(null),
    setSetting: vi.fn().mockResolvedValue(undefined),
    scan: {
      start: vi.fn().mockResolvedValue(''),
      cancel: vi.fn().mockResolvedValue(undefined),
      exportCsv: vi.fn().mockResolvedValue(null),
      onEvent: vi.fn().mockReturnValue(() => {})
    },
    conversion: {
      start: vi.fn().mockResolvedValue('conv-1'),
      cancel: vi.fn().mockResolvedValue(undefined),
      listResumable: vi.fn().mockResolvedValue([]),
      resume: vi.fn().mockResolvedValue(undefined),
      discard: vi.fn().mockResolvedValue(undefined),
      pickFiles: vi.fn().mockResolvedValue(null),
      onEvent: vi.fn((cb) => {
        registered = cb
        return unsubscribe
      })
    },
    tagger: {
      loadQueue: vi.fn().mockResolvedValue({ scanId: null, files: [], pendingEdits: {} }),
      saveEdit: vi.fn().mockResolvedValue(undefined),
      deleteEdit: vi.fn().mockResolvedValue(undefined),
      getSession: vi.fn().mockResolvedValue(null),
      setSession: vi.fn().mockResolvedValue(undefined),
      getGenrePresets: vi.fn().mockResolvedValue({ source: 'defaults', presets: [] })
    } as unknown as CrateKeeperApi['tagger'],
    ...overrides
  }
  globalThis.window.crateKeeper = api
  return {
    api,
    unsubscribe,
    emit: (e) => {
      if (registered === null) throw new Error('onEvent not subscribed')
      registered(e)
    }
  }
}

function resetStores(): void {
  useAppStore.setState({ activeTool: 'convertir', rootFolder: '/music' })
  useConversionStore.getState().reset()
}

describe('ConvertirView', () => {
  beforeEach(() => {
    installBridge()
    resetStores()
  })

  it('renders the 5 locked presets + Custom radio, with mp3-320 as default', () => {
    render(<ConvertirView />)
    expect(screen.getByRole('radio', { name: /MP3 320 kbps \(CBR\)/i })).toBeChecked()
    expect(screen.getByRole('radio', { name: /MP3 V0/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /AAC 256/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /FLAC \(lossless\)/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /WAV 16-bit/i })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Personnalisé/i })).toBeInTheDocument()
  })

  it('clicking Personnalisé opens the CustomPresetForm; FLAC choice disables bitrate', () => {
    render(<ConvertirView />)
    fireEvent.click(screen.getByRole('radio', { name: /Personnalisé/i }))
    expect(screen.getByLabelText(/Codec/i)).toBeInTheDocument()
    const bitrate = screen.getByLabelText(/Bitrate/i) as HTMLInputElement
    expect(bitrate.disabled).toBe(false)
    fireEvent.change(screen.getByLabelText(/Codec/i), { target: { value: 'flac' } })
    expect((screen.getByLabelText(/Bitrate/i) as HTMLInputElement).disabled).toBe(true)
  })

  it('Lancer button is disabled when pendingFilePaths is empty', () => {
    render(<ConvertirView />)
    const btn = screen.getByRole('button', { name: /^lancer$/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(true)
  })

  it('empty state renders Choisir des fichiers + Ouvrir l’Analyser when no selection', () => {
    render(<ConvertirView />)
    expect(screen.getByText(/Aucun fichier sélectionné/i)).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Choisir des fichiers/i })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /Ouvrir l’Analyser/i })
    ).toBeInTheDocument()
  })

  it('clicking Choisir des fichiers calls conversion.pickFiles and seeds the store', async () => {
    const pickFilesMock = vi
      .fn()
      .mockResolvedValue(['/music/a.mp3', '/music/b.flac'])
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue('conv-x'),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([]),
        resume: vi.fn().mockResolvedValue(undefined),
        discard: vi.fn().mockResolvedValue(undefined),
        pickFiles: pickFilesMock,
        onEvent: vi.fn().mockReturnValue(() => {})
      }
    })
    resetStores()
    render(<ConvertirView />)

    fireEvent.click(screen.getByRole('button', { name: /Choisir des fichiers/i }))

    await waitFor(() => {
      expect(pickFilesMock).toHaveBeenCalledTimes(1)
    })
    await waitFor(() => {
      expect(useConversionStore.getState().pendingFilePaths).toEqual([
        '/music/a.mp3',
        '/music/b.flac'
      ])
    })
  })

  it('Choisir des fichiers no-ops when pickFiles returns null (user cancelled)', async () => {
    const pickFilesMock = vi.fn().mockResolvedValue(null)
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue(''),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([]),
        resume: vi.fn().mockResolvedValue(undefined),
        discard: vi.fn().mockResolvedValue(undefined),
        pickFiles: pickFilesMock,
        onEvent: vi.fn().mockReturnValue(() => {})
      }
    })
    resetStores()
    render(<ConvertirView />)

    fireEvent.click(screen.getByRole('button', { name: /Choisir des fichiers/i }))

    await waitFor(() => {
      expect(pickFilesMock).toHaveBeenCalled()
    })
    expect(useConversionStore.getState().pendingFilePaths).toEqual([])
  })

  it('Lancer button enabled when pending paths present; clicking calls conversion.start + persists preset', async () => {
    const bridge = installBridge()
    resetStores()
    useConversionStore.getState().seedFilePaths(['/music/a.mp3', '/music/b.mp3'])

    render(<ConvertirView />)
    const btn = screen.getByRole('button', { name: /^lancer$/i }) as HTMLButtonElement
    expect(btn.disabled).toBe(false)
    fireEvent.click(btn)

    await waitFor(() => {
      expect(bridge.api.conversion.start).toHaveBeenCalledWith({
        rootFolder: '/music',
        filePaths: ['/music/a.mp3', '/music/b.mp3'],
        preset: expect.objectContaining({ slug: 'mp3-320' })
      })
    })
    expect(bridge.api.setSetting).toHaveBeenCalledWith(
      'conversion.lastPreset',
      expect.stringContaining('"mp3-320"')
    )
  })

  it('while running, button text changes to Annuler and click calls conversion.cancel', async () => {
    const bridge = installBridge()
    resetStores()
    useConversionStore.getState().seedFilePaths(['/music/a.mp3'])

    render(<ConvertirView />)
    fireEvent.click(screen.getByRole('button', { name: /^lancer$/i }))
    // Wait for store to flip status to running (after start resolves)
    await waitFor(() => {
      expect(useConversionStore.getState().status).toBe('running')
    })
    const cancelBtn = await screen.findByRole('button', { name: /^annuler$/i })
    fireEvent.click(cancelBtn)
    await waitFor(() => {
      expect(bridge.api.conversion.cancel).toHaveBeenCalledWith('conv-1')
    })
  })

  it('renders per-file rows and a global progress strip with French counter', () => {
    resetStores()
    useConversionStore.getState().seedFilePaths(['/music/a.mp3', '/music/b.mp3'])
    render(<ConvertirView />)
    expect(screen.getByText(/^0\/2 fichiers convertis$/)).toBeInTheDocument()
    // Per-file rows render basenames
    expect(screen.getByText('a.mp3')).toBeInTheDocument()
    expect(screen.getByText('b.mp3')).toBeInTheDocument()
  })

  it('summary line shows N converti, M en erreur, K ignorés when status=done', () => {
    resetStores()
    useConversionStore.setState({
      pendingFilePaths: ['/a', '/b', '/c'],
      fileStatuses: new Map([
        ['/a', 'done'],
        ['/b', 'error'],
        ['/c', 'skipped']
      ]),
      errors: [{ filePath: '/b', errorMessage: 'oops' }],
      status: 'done'
    })
    render(<ConvertirView />)
    expect(
      screen.getByText(/1 converti, 1 en erreur, 1 ignorés/)
    ).toBeInTheDocument()
  })

  it('on mount, reads conversion.lastPreset and applies setPreset when valid', async () => {
    installBridge({
      getSetting: vi
        .fn<CrateKeeperApi['getSetting']>()
        .mockResolvedValue(
          JSON.stringify({
            slug: 'flac',
            label: 'FLAC (lossless)',
            codec: 'flac',
            bitrateKbps: null,
            vbrQuality: null,
            sampleRate: null,
            extension: '.flac'
          })
        )
    })
    resetStores()

    render(<ConvertirView />)
    await waitFor(() => {
      expect(useConversionStore.getState().selectedPreset.slug).toBe('flac')
    })
  })

  it('subscribeEvents lifecycle: subscribes on mount, unsubscribes on unmount', () => {
    const bridge = installBridge()
    resetStores()
    const { unmount } = render(<ConvertirView />)
    expect(bridge.api.conversion.onEvent).toHaveBeenCalledTimes(1)
    unmount()
    expect(bridge.unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('progress events update the per-file row percentage', async () => {
    const bridge = installBridge()
    resetStores()
    useConversionStore.getState().seedFilePaths(['/music/a.mp3'])
    render(<ConvertirView />)

    bridge.emit({
      type: 'progress',
      conversionId: 'conv-1',
      filePath: '/music/a.mp3',
      percent: 42,
      phase: 'transcoding'
    })

    await waitFor(() => {
      expect(useConversionStore.getState().perFileProgress.get('/music/a.mp3')?.percent).toBe(42)
    })
  })

  it('clicking Retour à l’Analyser switches activeTool back to analyser', () => {
    resetStores()
    render(<ConvertirView />)
    fireEvent.click(screen.getByRole('button', { name: /Retour à l’Analyser/i }))
    expect(useAppStore.getState().activeTool).toBe('analyser')
  })

  // ─────────────────────── Plan 03-03 — Resume banner ───────────────────────

  it('on mount, calls listResumable exactly ONCE (LOCKED Pitfall 9: one-shot, not polling)', async () => {
    const bridge = installBridge()
    resetStores()
    const { rerender } = render(<ConvertirView />)
    await waitFor(() => {
      expect(bridge.api.conversion.listResumable).toHaveBeenCalled()
    })
    const callsAfterFirstRender = (
      bridge.api.conversion.listResumable as ReturnType<typeof vi.fn>
    ).mock.calls.length
    // Re-render should NOT trigger another listResumable.
    rerender(<ConvertirView />)
    rerender(<ConvertirView />)
    expect(
      (bridge.api.conversion.listResumable as ReturnType<typeof vi.fn>).mock.calls
        .length
    ).toBe(callsAfterFirstRender)
    expect(callsAfterFirstRender).toBe(1)
  })

  it('ResumeBanner renders NOTHING when listResumable returns []', async () => {
    installBridge()
    resetStores()
    render(<ConvertirView />)
    // The boot sweep returned no crashed batches — banner must not appear.
    expect(screen.queryByRole('region', { name: /Conversion à reprendre/i })).toBeNull()
  })

  it('ResumeBanner renders ABOVE PresetSelector when 1 crashed batch exists', async () => {
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue('conv-1'),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([
          {
            conversionId: 'c-crashed',
            rootFolder: '/music',
            preset: {
              slug: 'mp3-320',
              label: 'MP3 320 kbps (CBR)',
              codec: 'libmp3lame',
              bitrateKbps: 320,
              vbrQuality: null,
              sampleRate: null,
              extension: '.mp3'
            },
            outputDir: '/music/converted/mp3-320',
            pendingCount: 12,
            doneCount: 3,
            errorCount: 0,
            startedAt: 1_000
          }
        ]),
        resume: vi.fn().mockResolvedValue(undefined),
        discard: vi.fn().mockResolvedValue(undefined),
        pickFiles: vi.fn().mockResolvedValue(null),
        onEvent: vi.fn().mockReturnValue(() => {})
      } as CrateKeeperApi['conversion']
    })
    resetStores()
    render(<ConvertirView />)

    const banner = await screen.findByRole('region', { name: /Conversion à reprendre/i })
    expect(banner).toBeInTheDocument()
    expect(banner).toHaveTextContent('Reprendre la conversion de 12 fichiers ?')
    expect(banner).toHaveTextContent(/MP3 320 kbps/i)

    // Banner must appear ABOVE the preset radio group in DOM order.
    const presetRadio = screen.getByRole('radio', { name: /MP3 320 kbps \(CBR\)/i })
    expect(banner.compareDocumentPosition(presetRadio) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('clicking Reprendre calls conversion.resume and clears the banner', async () => {
    const resumeMock = vi.fn().mockResolvedValue(undefined)
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue('conv-1'),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([
          {
            conversionId: 'c-1',
            rootFolder: '/music',
            preset: {
              slug: 'mp3-320',
              label: 'MP3 320 kbps (CBR)',
              codec: 'libmp3lame',
              bitrateKbps: 320,
              vbrQuality: null,
              sampleRate: null,
              extension: '.mp3'
            },
            outputDir: '/music/out',
            pendingCount: 5,
            doneCount: 0,
            errorCount: 0,
            startedAt: 1_000
          }
        ]),
        resume: resumeMock,
        discard: vi.fn().mockResolvedValue(undefined),
        pickFiles: vi.fn().mockResolvedValue(null),
        onEvent: vi.fn().mockReturnValue(() => {})
      } as CrateKeeperApi['conversion']
    })
    resetStores()
    render(<ConvertirView />)

    const resumeBtn = await screen.findByRole('button', { name: /^Reprendre$/i })
    fireEvent.click(resumeBtn)

    await waitFor(() => {
      expect(resumeMock).toHaveBeenCalledWith('c-1')
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: /Conversion à reprendre/i })
      ).toBeNull()
    })
  })

  it('clicking Ignorer (supprimer) calls conversion.discard and clears the banner', async () => {
    const discardMock = vi.fn().mockResolvedValue(undefined)
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue('conv-1'),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([
          {
            conversionId: 'c-discard',
            rootFolder: '/music',
            preset: {
              slug: 'mp3-320',
              label: 'MP3 320 kbps (CBR)',
              codec: 'libmp3lame',
              bitrateKbps: 320,
              vbrQuality: null,
              sampleRate: null,
              extension: '.mp3'
            },
            outputDir: '/music/out',
            pendingCount: 2,
            doneCount: 0,
            errorCount: 0,
            startedAt: 1_000
          }
        ]),
        resume: vi.fn().mockResolvedValue(undefined),
        discard: discardMock,
        pickFiles: vi.fn().mockResolvedValue(null),
        onEvent: vi.fn().mockReturnValue(() => {})
      } as CrateKeeperApi['conversion']
    })
    resetStores()
    render(<ConvertirView />)

    const ignoreBtn = await screen.findByRole('button', { name: /Ignorer/i })
    fireEvent.click(ignoreBtn)

    await waitFor(() => {
      expect(discardMock).toHaveBeenCalledWith('c-discard')
    })
    await waitFor(() => {
      expect(
        screen.queryByRole('region', { name: /Conversion à reprendre/i })
      ).toBeNull()
    })
  })

  it('singular wording: pendingCount=1 renders "1 fichier ?" without trailing s', async () => {
    installBridge({
      conversion: {
        start: vi.fn().mockResolvedValue('conv-1'),
        cancel: vi.fn().mockResolvedValue(undefined),
        listResumable: vi.fn().mockResolvedValue([
          {
            conversionId: 'c-1',
            rootFolder: '/music',
            preset: {
              slug: 'mp3-320',
              label: 'MP3 320 kbps (CBR)',
              codec: 'libmp3lame',
              bitrateKbps: 320,
              vbrQuality: null,
              sampleRate: null,
              extension: '.mp3'
            },
            outputDir: '/music/out',
            pendingCount: 1,
            doneCount: 0,
            errorCount: 0,
            startedAt: 1_000
          }
        ]),
        resume: vi.fn().mockResolvedValue(undefined),
        discard: vi.fn().mockResolvedValue(undefined),
        pickFiles: vi.fn().mockResolvedValue(null),
        onEvent: vi.fn().mockReturnValue(() => {})
      } as CrateKeeperApi['conversion']
    })
    resetStores()
    render(<ConvertirView />)

    expect(
      await screen.findByText(/Reprendre la conversion de 1 fichier \?/i)
    ).toBeInTheDocument()
  })
})
