import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  CrateKeeperApi,
  GenrePresetsResult,
  PendingTagEdit,
  ScannedFile,
  TagWriteEvent,
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
  getPendingCount: ReturnType<typeof vi.fn>
  applyWrites: ReturnType<typeof vi.fn>
  onWriteEvent: ReturnType<typeof vi.fn>
}

function installMock(opts: {
  queue?: ScannedFile[]
  pendingEdits?: Record<string, PendingTagEdit>
  presets?: GenrePresetsResult
  muteSetting?: string | null
  pendingCount?: number
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
  const getPendingCount = vi.fn().mockResolvedValue(opts.pendingCount ?? 0)
  const applyWrites = vi.fn().mockResolvedValue(undefined)
  // onWriteEvent: captures callback so tests can drive events manually
  const onWriteEvent = vi.fn().mockReturnValue(() => {})

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
      getPendingCount,
      applyWrites,
      onWriteEvent
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
    setSetting,
    getPendingCount,
    applyWrites,
    onWriteEvent
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

  it('loadMuteSetting always resets muteEnabled to false (legacy setting ignored)', async () => {
    // The mute UI was removed; a persisted `tagger.muteEnabled=true` from
    // older sessions used to leave audio silenced with no way to unmute.
    // loadMuteSetting now ignores the persisted value and forces false.
    installMock({ muteSetting: 'true' })
    await useTaggerStore.getState().loadMuteSetting()
    expect(useTaggerStore.getState().muteEnabled).toBe(false)

    installMock({ muteSetting: null })
    await useTaggerStore.getState().loadMuteSetting()
    expect(useTaggerStore.getState().muteEnabled).toBe(false)
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

  // ───────────────────────── Plan 04-03: Undo state machine ─────────────────

  it('initial lastAction is null', () => {
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('keep sets lastAction with type=keep, filePath, prior, savedEdit (new ref each call)', async () => {
    installMock({ queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')] })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    const r1 = await useTaggerStore.getState().keep()
    const la1 = useTaggerStore.getState().lastAction
    expect(la1).not.toBeNull()
    expect(la1?.type).toBe('keep')
    expect(la1?.filePath).toBe('/m/a.mp3')
    expect(la1?.prior).toBeNull()
    expect(la1?.savedEdit?.genre).toBe('Techno')
    expect(r1?.prior).toBeNull()
    // Second keep produces a NEW LastAction instance.
    await useTaggerStore.getState().keep()
    const la2 = useTaggerStore.getState().lastAction
    expect(la2).not.toBe(la1)
    expect(la2?.filePath).toBe('/m/b.mp3')
  })

  it('skip sets lastAction with type=skip + filePath', async () => {
    installMock({ queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')] })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().skip()
    const la = useTaggerStore.getState().lastAction
    expect(la).toEqual({ type: 'skip', filePath: '/m/a.mp3' })
  })

  it('undo with lastAction=null is a no-op (state unchanged)', async () => {
    const api = installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    const before = useTaggerStore.getState()
    await useTaggerStore.getState().undo()
    const after = useTaggerStore.getState()
    expect(after.currentIndex).toBe(before.currentIndex)
    expect(after.pendingEdits).toBe(before.pendingEdits)
    expect(after.lastAction).toBeNull()
    expect(api.saveEdit).not.toHaveBeenCalled()
    expect(api.deleteEdit).not.toHaveBeenCalled()
  })

  it('undo with type=skip rewinds currentIndex by 1, clears lastAction, no IPC', async () => {
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().skip()
    expect(useTaggerStore.getState().currentIndex).toBe(1)
    await useTaggerStore.getState().undo()
    expect(useTaggerStore.getState().currentIndex).toBe(0)
    expect(useTaggerStore.getState().lastAction).toBeNull()
    expect(api.saveEdit).not.toHaveBeenCalled()
    expect(api.deleteEdit).not.toHaveBeenCalled()
  })

  it('undo with type=keep + prior=null calls deleteEdit, removes pending row, rewinds index', async () => {
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    await useTaggerStore.getState().keep()
    expect(useTaggerStore.getState().pendingEdits.has('/m/a.mp3')).toBe(true)

    await useTaggerStore.getState().undo()
    expect(api.deleteEdit).toHaveBeenCalledWith('/m/a.mp3')
    expect(useTaggerStore.getState().pendingEdits.has('/m/a.mp3')).toBe(false)
    expect(useTaggerStore.getState().currentIndex).toBe(0)
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('undo with type=keep + prior!=null calls saveEdit(prior), restores pending row, rewinds index', async () => {
    const priorEdit: PendingTagEdit = {
      filePath: '/m/a.mp3',
      genre: 'Disco',
      bpm: 110,
      key: '7A',
      artist: null,
      title: null,
      comment: null,
      rating: 3,
      updatedAt: 1,
      appliedAt: null
    }
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')],
      pendingEdits: { '/m/a.mp3': priorEdit }
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    await useTaggerStore.getState().keep()
    expect(
      useTaggerStore.getState().pendingEdits.get('/m/a.mp3')?.genre
    ).toBe('Techno')
    // saveEdit called once for the keep.
    expect(api.saveEdit).toHaveBeenCalledTimes(1)

    await useTaggerStore.getState().undo()
    // saveEdit called a second time with the prior values.
    expect(api.saveEdit).toHaveBeenCalledTimes(2)
    expect(api.saveEdit).toHaveBeenLastCalledWith(
      expect.objectContaining({
        filePath: '/m/a.mp3',
        genre: 'Disco',
        bpm: 110,
        key: '7A',
        rating: 3
      })
    )
    expect(api.deleteEdit).not.toHaveBeenCalled()
    expect(useTaggerStore.getState().pendingEdits.get('/m/a.mp3')).toEqual(
      priorEdit
    )
    expect(useTaggerStore.getState().currentIndex).toBe(0)
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('double-undo: second undo is a no-op (no extra IPC)', async () => {
    const api = installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    await useTaggerStore.getState().keep()
    await useTaggerStore.getState().undo()
    const saveCount = api.saveEdit.mock.calls.length
    const deleteCount = api.deleteEdit.mock.calls.length
    await useTaggerStore.getState().undo()
    expect(api.saveEdit.mock.calls.length).toBe(saveCount)
    expect(api.deleteEdit.mock.calls.length).toBe(deleteCount)
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('keep after undo replaces lastAction (no stacking — locked 1-level)', async () => {
    installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    useTaggerStore.getState().setDirtyEdit('genre', 'Techno')
    await useTaggerStore.getState().keep()
    await useTaggerStore.getState().undo()
    expect(useTaggerStore.getState().lastAction).toBeNull()
    // Now redo a keep.
    useTaggerStore.getState().setDirtyEdit('genre', 'House')
    await useTaggerStore.getState().keep()
    const la = useTaggerStore.getState().lastAction
    expect(la?.type).toBe('keep')
    expect(la?.savedEdit?.genre).toBe('House')
  })

  it('lastAction transitions create a NEW object reference each time', async () => {
    installMock({
      queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3'), makeFile('/m/c.mp3')]
    })
    await useTaggerStore.getState().loadQueue()
    await useTaggerStore.getState().keep()
    const r1 = useTaggerStore.getState().lastAction
    useTaggerStore.getState().skip()
    const r2 = useTaggerStore.getState().lastAction
    expect(r2).not.toBe(r1)
    expect(r2?.type).toBe('skip')
  })

  it('reset clears lastAction back to null', async () => {
    installMock({ queue: [makeFile('/m/a.mp3'), makeFile('/m/b.mp3')] })
    await useTaggerStore.getState().loadQueue()
    await useTaggerStore.getState().keep()
    expect(useTaggerStore.getState().lastAction).not.toBeNull()
    useTaggerStore.getState().reset()
    expect(useTaggerStore.getState().lastAction).toBeNull()
  })

  it('loadQueue stores scanId on state', async () => {
    installMock({ queue: [makeFile('/m/a.mp3')] })
    await useTaggerStore.getState().loadQueue()
    expect(useTaggerStore.getState().scanId).toBe('scan-1')
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

  // ────────────── Phase 5 Plan 05-03: applyWrites + loadPendingWriteCount ──────

  it('loadPendingWriteCount sets pendingWriteCount from bridge', async () => {
    installMock({ pendingCount: 5 })
    await useTaggerStore.getState().loadPendingWriteCount()
    expect(useTaggerStore.getState().pendingWriteCount).toBe(5)
  })

  it('applyWrites: subscribes before invoking; isApplying true during apply', async () => {
    const api = installMock({ pendingCount: 2 })
    // Make applyWrites never resolve so we can observe the intermediate state.
    let resolveApply!: () => void
    api.applyWrites.mockReturnValue(
      new Promise<void>((r) => {
        resolveApply = r
      })
    )
    // Drive events manually from the captured callback.
    let capturedCb: ((e: TagWriteEvent) => void) | null = null
    api.onWriteEvent.mockImplementation((cb: (e: TagWriteEvent) => void) => {
      capturedCb = cb
      return () => {}
    })

    const promise = useTaggerStore.getState().applyWrites()

    // onWriteEvent must be called BEFORE applyWrites.
    expect(api.onWriteEvent).toHaveBeenCalledBefore(api.applyWrites)
    expect(useTaggerStore.getState().isApplying).toBe(true)
    expect(useTaggerStore.getState().applyResult).toBeNull()
    expect(useTaggerStore.getState().writeResults.size).toBe(0)

    // Simulate fileDone events.
    capturedCb!({ type: 'fileDone', filePath: '/m/a.mp3', ok: true })
    expect(useTaggerStore.getState().writeResults.get('/m/a.mp3')).toEqual({ ok: true })

    capturedCb!({ type: 'fileDone', filePath: '/m/b.mp3', ok: false, error: 'write error' })
    expect(useTaggerStore.getState().writeResults.get('/m/b.mp3')).toEqual({
      ok: false,
      error: 'write error'
    })

    // Simulate done event.
    capturedCb!({ type: 'done', totalWritten: 1, totalFailed: 1 })
    expect(useTaggerStore.getState().isApplying).toBe(false)
    expect(useTaggerStore.getState().applyResult).toEqual({
      totalWritten: 1,
      totalFailed: 1
    })

    resolveApply()
    await promise
  })

  it('applyWrites: writeResults Map identity changes on each fileDone (immutability)', async () => {
    const api = installMock({ pendingCount: 2 })
    let capturedCb: ((e: TagWriteEvent) => void) | null = null
    api.onWriteEvent.mockImplementation((cb: (e: TagWriteEvent) => void) => {
      capturedCb = cb
      return () => {}
    })
    let resolveApply!: () => void
    api.applyWrites.mockReturnValue(new Promise<void>((r) => { resolveApply = r }))

    void useTaggerStore.getState().applyWrites()
    const before = useTaggerStore.getState().writeResults

    capturedCb!({ type: 'fileDone', filePath: '/m/a.mp3', ok: true })
    const after = useTaggerStore.getState().writeResults
    expect(after).not.toBe(before)

    resolveApply()
  })

  it('applyWrites: on rejection sets applyError, clears isApplying, calls unsub', async () => {
    const api = installMock({ pendingCount: 1 })
    const mockUnsub = vi.fn()
    api.onWriteEvent.mockReturnValue(mockUnsub)
    api.applyWrites.mockRejectedValue(new Error('network failure'))

    await useTaggerStore.getState().applyWrites()

    expect(useTaggerStore.getState().isApplying).toBe(false)
    expect(useTaggerStore.getState().applyError).toBe('network failure')
    expect(mockUnsub).toHaveBeenCalledOnce()
  })

  it('applyWrites: re-entry is a no-op while isApplying=true', async () => {
    const api = installMock({ pendingCount: 1 })
    let capturedCb: ((e: TagWriteEvent) => void) | null = null
    api.onWriteEvent.mockImplementation((cb: (e: TagWriteEvent) => void) => {
      capturedCb = cb
      return () => {}
    })
    let resolveApply!: () => void
    api.applyWrites.mockReturnValue(new Promise<void>((r) => { resolveApply = r }))

    void useTaggerStore.getState().applyWrites()
    expect(useTaggerStore.getState().isApplying).toBe(true)

    // Second call while already applying should be a no-op.
    await useTaggerStore.getState().applyWrites()
    expect(api.onWriteEvent).toHaveBeenCalledTimes(1)
    expect(api.applyWrites).toHaveBeenCalledTimes(1)

    capturedCb!({ type: 'done', totalWritten: 1, totalFailed: 0 })
    resolveApply()
  })

  it('applyWrites: done event triggers loadPendingWriteCount refresh', async () => {
    const api = installMock({ pendingCount: 3 })
    let capturedCb: ((e: TagWriteEvent) => void) | null = null
    api.onWriteEvent.mockImplementation((cb: (e: TagWriteEvent) => void) => {
      capturedCb = cb
      return () => {}
    })
    api.getPendingCount.mockResolvedValueOnce(3).mockResolvedValueOnce(0)
    let resolveApply!: () => void
    api.applyWrites.mockReturnValue(new Promise<void>((r) => { resolveApply = r }))

    void useTaggerStore.getState().applyWrites()
    // Trigger done.
    capturedCb!({ type: 'done', totalWritten: 3, totalFailed: 0 })
    resolveApply()

    // Wait for the refreshed count after done.
    await new Promise<void>((r) => setTimeout(r, 0))
    expect(api.getPendingCount).toHaveBeenCalledTimes(1)
  })
})
