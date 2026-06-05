import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CrateKeeperApi,
  GenrePresetsResult,
  PendingTagEdit,
  ScannedFile,
  TaggerQueueResult
} from '../../../shared/ipc-types'
import { selectCurrentFile, useTaggerStore } from './useTaggerStore'

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

interface MockedTaggerApi {
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
  queue?: ScannedFile[]
  pendingEdits?: Record<string, PendingTagEdit>
  presets?: GenrePresetsResult
  muteSetting?: string | null
} = {}): MockedTaggerApi {
  const queueResult: TaggerQueueResult = {
    scanId: 'scan-1',
    files: opts.queue ?? [],
    pendingEdits: opts.pendingEdits ?? {}
  }
  const loadQueue = vi.fn().mockResolvedValue(queueResult)
  const saveEdit = vi.fn().mockResolvedValue(undefined)
  const deleteEdit = vi.fn().mockResolvedValue(undefined)
  const getSession = vi.fn().mockResolvedValue(null)
  const setSession = vi.fn().mockResolvedValue(undefined)
  const getGenrePresets = vi
    .fn()
    .mockResolvedValue(
      opts.presets ?? {
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
      }
    )
  const getSetting = vi.fn().mockResolvedValue(opts.muteSetting ?? null)
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

describe('useTaggerStore', () => {
  beforeEach(() => {
    useTaggerStore.getState().reset()
  })

  it('initial state matches defaults', () => {
    const s = useTaggerStore.getState()
    expect(s.status).toBe('loading')
    expect(s.queue).toEqual([])
    expect(s.currentIndex).toBe(0)
    expect(s.dirtyEdits.size).toBe(0)
    expect(s.pendingEdits.size).toBe(0)
    expect(s.genrePresets).toEqual([])
    expect(s.muteEnabled).toBe(false)
  })

  it('loadQueue with empty files sets status=empty', async () => {
    installMock({ queue: [] })
    await useTaggerStore.getState().loadQueue()
    expect(useTaggerStore.getState().status).toBe('empty')
  })

  it('loadQueue seeds queue + pendingEdits + status=ready', async () => {
    const f1 = makeFile('/m/a.mp3')
    const f2 = makeFile('/m/b.mp3')
    const pending: PendingTagEdit = {
      filePath: '/m/a.mp3',
      genre: 'House',
      bpm: 124,
      key: '8A',
      artist: null,
      title: null,
      comment: null,
      rating: 4,
      updatedAt: 1,
      appliedAt: null
    }
    installMock({
      queue: [f1, f2],
      pendingEdits: { '/m/a.mp3': pending }
    })
    await useTaggerStore.getState().loadQueue()
    const s = useTaggerStore.getState()
    expect(s.status).toBe('ready')
    expect(s.queue).toHaveLength(2)
    expect(s.pendingEdits.get('/m/a.mp3')).toEqual(pending)
    expect(s.currentIndex).toBe(0)
  })

  it('loadGenrePresets stores presets + source', async () => {
    installMock({
      presets: {
        source: 'library',
        presets: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
      }
    })
    await useTaggerStore.getState().loadGenrePresets()
    const s = useTaggerStore.getState()
    expect(s.genrePresets).toHaveLength(9)
    expect(s.genrePresetsSource).toBe('library')
  })

  it('loadMuteSetting reads from settings:get and defaults to false on null', async () => {
    installMock({ muteSetting: null })
    await useTaggerStore.getState().loadMuteSetting()
    expect(useTaggerStore.getState().muteEnabled).toBe(false)

    installMock({ muteSetting: 'true' })
    await useTaggerStore.getState().loadMuteSetting()
    expect(useTaggerStore.getState().muteEnabled).toBe(true)
  })

  it('setDirtyEdit produces a NEW Map instance (immutability)', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    const before = useTaggerStore.getState().dirtyEdits
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    const after = useTaggerStore.getState().dirtyEdits
    expect(after).not.toBe(before)
    expect(after.get('/m/a.mp3')?.genre).toBe('Techno')
  })

  it('setDirtyEdit clears the field when value is empty string', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    useTaggerStore.getState().setDirtyEdit('genre', '')
    expect(
      useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre
    ).toBeNull()
  })

  it('applyPreset(3) sets genre to genrePresets[2]', async () => {
    installMock({
      queue: [makeFile('/m/a.mp3')],
      presets: {
        source: 'defaults',
        presets: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
      }
    })
    await useTaggerStore.getState().loadQueue()
    await useTaggerStore.getState().loadGenrePresets()
    useTaggerStore.getState().applyPreset(3)
    expect(
      useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.genre
    ).toBe('C')
  })

  it('applyPreset out-of-range (0 / 10) is a no-op', async () => {
    installMock({
      queue: [makeFile('/m/a.mp3')],
      presets: {
        source: 'defaults',
        presets: ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']
      }
    })
    await useTaggerStore.getState().loadQueue()
    await useTaggerStore.getState().loadGenrePresets()
    const before = useTaggerStore.getState().dirtyEdits
    useTaggerStore.getState().applyPreset(0)
    useTaggerStore.getState().applyPreset(10)
    expect(useTaggerStore.getState().dirtyEdits).toBe(before)
  })

  it('applySplit sets artist + title in a single new Map instance', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    const before = useTaggerStore.getState().dirtyEdits
    useTaggerStore
      .getState()
      .applySplit({ artist: 'Daft Punk', title: 'Around The World' })
    const after = useTaggerStore.getState().dirtyEdits
    expect(after).not.toBe(before)
    const e = after.get('/m/a.mp3')
    expect(e?.artist).toBe('Daft Punk')
    expect(e?.title).toBe('Around The World')
  })

  it('setRating sets 1-5 ratings', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setRating(3)
    expect(
      useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.rating
    ).toBe(3)
  })

  it('setRating(N) on current rating === N clears to null (toggle)', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setRating(4)
    useTaggerStore.getState().setRating(4)
    expect(
      useTaggerStore.getState().dirtyEdits.get('/m/a.mp3')?.rating
    ).toBeNull()
  })

  it('setMute persists via setSetting', async () => {
    const api = installMock()
    await useTaggerStore.getState().setMute(true)
    expect(useTaggerStore.getState().muteEnabled).toBe(true)
    expect(api.setSetting).toHaveBeenCalledWith('tagger.muteEnabled', 'true')
  })

  it('toggleMute flips and persists', async () => {
    const api = installMock()
    await useTaggerStore.getState().toggleMute()
    expect(useTaggerStore.getState().muteEnabled).toBe(true)
    await useTaggerStore.getState().toggleMute()
    expect(useTaggerStore.getState().muteEnabled).toBe(false)
    expect(api.setSetting).toHaveBeenCalledTimes(2)
  })

  it('keep persists via saveEdit, updates pendingEdits with NEW Map, advances index', async () => {
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    useTaggerStore.getState().setRating(5)
    const beforePending = useTaggerStore.getState().pendingEdits

    const result = await useTaggerStore.getState().keep()

    expect(api.saveEdit).toHaveBeenCalledWith(
      expect.objectContaining({
        filePath: '/m/a.mp3',
        genre: 'Techno',
        rating: 5
      })
    )
    const afterPending = useTaggerStore.getState().pendingEdits
    expect(afterPending).not.toBe(beforePending)
    expect(afterPending.get('/m/a.mp3')?.genre).toBe('Techno')
    expect(afterPending.get('/m/a.mp3')?.rating).toBe(5)
    expect(useTaggerStore.getState().currentIndex).toBe(1)
    expect(useTaggerStore.getState().dirtyEdits.has('/m/a.mp3')).toBe(false)
    expect(result?.filePath).toBe('/m/a.mp3')
    expect(result?.prior).toBeNull()
  })

  it('skip advances index without calling saveEdit; discards dirty edits', async () => {
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    useTaggerStore.getState().skip()
    expect(api.saveEdit).not.toHaveBeenCalled()
    expect(useTaggerStore.getState().currentIndex).toBe(1)
    expect(useTaggerStore.getState().dirtyEdits.has('/m/a.mp3')).toBe(false)
  })

  it('keep at last index still advances (index goes out of bounds)', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    await useTaggerStore.getState().keep()
    expect(useTaggerStore.getState().currentIndex).toBe(1)
    expect(useTaggerStore.getState().status).toBe('ready')
  })

  it('selectCurrentFile returns queue[currentIndex] or null', async () => {
    installMock({ queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')] })
    await useTaggerStore.getState().loadQueue()
    expect(selectCurrentFile(useTaggerStore.getState())?.path).toBe('/m/a.mp3')
    useTaggerStore.getState().skip()
    expect(selectCurrentFile(useTaggerStore.getState())?.path).toBe('/m/b.mp3')
    useTaggerStore.getState().skip()
    expect(selectCurrentFile(useTaggerStore.getState())).toBeNull()
  })
})
