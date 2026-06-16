import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createApplyController, makeTaggerWriteSender } from './applyController'
import type { TaggerRepo } from './taggerRepo'
import type { PendingTagEdit, TagWriteEvent } from '../../shared/ipc-types'
import type { Mp3TagInput, Mp4TagInput } from './tagWriter'
import type { WebContents } from 'electron'

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const MP3_EDIT: PendingTagEdit = {
  filePath: '/Music/track.mp3',
  genre: 'House',
  bpm: 128,
  key: '8A',
  artist: 'DJ Test',
  title: 'Test Track',
  comment: null,
  rating: 4,
  updatedAt: 1000,
  appliedAt: null
}

const M4A_EDIT: PendingTagEdit = {
  filePath: '/Music/track.m4a',
  genre: 'Techno',
  bpm: 140,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null,
  updatedAt: 1000,
  appliedAt: null
}

const OK2_EDIT: PendingTagEdit = {
  filePath: '/Music/ok2.mp3',
  genre: 'Trance',
  bpm: null,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null,
  updatedAt: 1000,
  appliedAt: null
}

const THROW_EDIT: PendingTagEdit = {
  filePath: '/Music/throws.mp3',
  genre: 'Drum',
  bpm: null,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null,
  updatedAt: 1000,
  appliedAt: null
}

const FLAC_EDIT: PendingTagEdit = {
  filePath: '/Music/track.flac',
  genre: 'Ambient',
  bpm: null,
  key: null,
  artist: null,
  title: null,
  comment: null,
  rating: null,
  updatedAt: 1000,
  appliedAt: null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeTaggerRepo(edits: PendingTagEdit[] = []): TaggerRepo {
  return {
    upsertEdit: vi.fn(),
    deleteEdit: vi.fn(),
    getEdit: vi.fn(() => null),
    listEditsByPaths: vi.fn(() => new Map()),
    getSession: vi.fn(() => null),
    setSession: vi.fn(),
    topGenres: vi.fn(() => []),
    listPendingWrites: vi.fn(() => edits),
    markApplied: vi.fn()
  } as unknown as TaggerRepo
}

// ─── Tests ────────────────────────────────────────────────────────────────────

// Typed helpers so vi.fn() can be passed to createApplyController without cast noise.
type WriteFn3 = (filePath: string, input: Mp3TagInput) => Promise<void>
type WriteFn4 = (filePath: string, input: Mp4TagInput, ffmpegPath: string) => Promise<void>
type SendFn = (channel: string, payload: TagWriteEvent) => void

describe('createApplyController', () => {
  const NOW = 2000
  let writeMp3Tags: WriteFn3
  let writeMp4Tags: WriteFn4
  let send: SendFn & ReturnType<typeof vi.fn>

  beforeEach(() => {
    writeMp3Tags = vi.fn(() => Promise.resolve()) as unknown as WriteFn3
    writeMp4Tags = vi.fn(() => Promise.resolve()) as unknown as WriteFn4
    send = vi.fn() as unknown as SendFn & ReturnType<typeof vi.fn>
  })

  it('happy path: 1 mp3 + 1 m4a — writes both, markApplied for each, returns correct totals', async () => {
    const repo = makeTaggerRepo([MP3_EDIT, M4A_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    const result = await controller.applyPendingWrites()

    expect(writeMp3Tags).toHaveBeenCalledWith(MP3_EDIT.filePath, MP3_EDIT)
    expect(writeMp4Tags).toHaveBeenCalledWith(M4A_EDIT.filePath, M4A_EDIT, '/fake/ffmpeg')
    expect(repo.markApplied).toHaveBeenCalledWith(MP3_EDIT.filePath, NOW)
    expect(repo.markApplied).toHaveBeenCalledWith(M4A_EDIT.filePath, NOW)
    expect(result).toEqual({ totalWritten: 2, totalFailed: 0 })
  })

  it('order: write is attempted BEFORE markApplied', async () => {
    const order: string[] = []
    writeMp3Tags = vi.fn(() => { order.push('write'); return Promise.resolve() }) as unknown as WriteFn3
    const repo = makeTaggerRepo([MP3_EDIT])
    const markApplied = vi.fn(() => { order.push('markApplied') })
    repo.markApplied = markApplied

    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    await controller.applyPendingWrites()

    expect(order).toEqual(['write', 'markApplied'])
  })

  it('per-file failure: throwing file does not call markApplied for that file', async () => {
    writeMp3Tags = vi.fn(async (fp: string) => {
      if (fp === THROW_EDIT.filePath) throw new Error('write failed')
    }) as unknown as WriteFn3
    const repo = makeTaggerRepo([THROW_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    await controller.applyPendingWrites()

    expect(repo.markApplied).not.toHaveBeenCalled()
  })

  it('per-file isolation (D-05): batch continues after one failure', async () => {
    writeMp3Tags = vi.fn(async (fp: string) => {
      if (fp === THROW_EDIT.filePath) throw new Error('write failed')
    }) as unknown as WriteFn3
    const repo = makeTaggerRepo([MP3_EDIT, THROW_EDIT, OK2_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    const result = await controller.applyPendingWrites()

    expect(result).toEqual({ totalWritten: 2, totalFailed: 1 })
    expect(repo.markApplied).toHaveBeenCalledWith(MP3_EDIT.filePath, NOW)
    expect(repo.markApplied).toHaveBeenCalledWith(OK2_EDIT.filePath, NOW)
    expect(repo.markApplied).not.toHaveBeenCalledWith(THROW_EDIT.filePath, expect.anything())
  })

  it('events: fileDone ok:true sent for success, fileDone ok:false+error for failure, done at end', async () => {
    writeMp3Tags = vi.fn(async (fp: string) => {
      if (fp === THROW_EDIT.filePath) throw new Error('boom')
    }) as unknown as WriteFn3
    const repo = makeTaggerRepo([MP3_EDIT, THROW_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    await controller.applyPendingWrites()

    const calls = send.mock.calls
    // fileDone ok:true for MP3_EDIT
    expect(calls).toContainEqual([
      'tagger:write-event',
      { type: 'fileDone', filePath: MP3_EDIT.filePath, ok: true }
    ])
    // fileDone ok:false for THROW_EDIT
    expect(calls).toContainEqual([
      'tagger:write-event',
      { type: 'fileDone', filePath: THROW_EDIT.filePath, ok: false, error: 'boom' }
    ])
    // done event last
    const lastCall = calls[calls.length - 1]
    expect(lastCall).toEqual([
      'tagger:write-event',
      { type: 'done', totalWritten: 1, totalFailed: 1 }
    ])
  })

  it('single-active guard: second concurrent call throws', async () => {
    let resolvePending!: () => void
    writeMp3Tags = vi.fn(
      () => new Promise<void>((res) => { resolvePending = res })
    ) as unknown as WriteFn3
    const repo = makeTaggerRepo([MP3_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    // Start first call — it will hang on writeMp3Tags
    const first = controller.applyPendingWrites()
    // Second call must throw immediately
    await expect(controller.applyPendingWrites()).rejects.toThrow('Un lot est déjà en cours')
    // Let first call finish
    resolvePending()
    await first
  })

  it('unsupported ext (.flac): reported as fileDone ok:false, markApplied not called', async () => {
    const repo = makeTaggerRepo([FLAC_EDIT])
    const controller = createApplyController({
      taggerRepo: repo,
      writeMp3Tags,
      writeMp4Tags,
      ffmpegBinaryPath: '/fake/ffmpeg',
      send,
      now: () => NOW
    })

    const result = await controller.applyPendingWrites()

    expect(result).toEqual({ totalWritten: 0, totalFailed: 1 })
    expect(repo.markApplied).not.toHaveBeenCalled()
    const fileDoneCall = send.mock.calls.find(
      (c) => c[1]?.type === 'fileDone' && c[1]?.filePath === FLAC_EDIT.filePath
    )
    expect(fileDoneCall?.[1]?.ok).toBe(false)
  })
})

describe('makeTaggerWriteSender', () => {
  it('sends to webContents when available', () => {
    const send = vi.fn()
    const wc = { isDestroyed: () => false, send } as unknown as WebContents
    const sender = makeTaggerWriteSender(() => wc)
    sender('tagger:write-event', { type: 'done', totalWritten: 1, totalFailed: 0 })
    expect(send).toHaveBeenCalledWith('tagger:write-event', {
      type: 'done',
      totalWritten: 1,
      totalFailed: 0
    })
  })

  it('no-ops when getSender returns null', () => {
    const sender = makeTaggerWriteSender(() => null)
    // Should not throw
    expect(() =>
      sender('tagger:write-event', { type: 'done', totalWritten: 0, totalFailed: 0 })
    ).not.toThrow()
  })

  it('no-ops when webContents is destroyed', () => {
    const send = vi.fn()
    const wc = { isDestroyed: () => true, send } as unknown as WebContents
    const sender = makeTaggerWriteSender(() => wc)
    sender('tagger:write-event', { type: 'done', totalWritten: 0, totalFailed: 0 })
    expect(send).not.toHaveBeenCalled()
  })
})
