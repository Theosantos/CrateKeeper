import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  createConversionController,
  BatchAlreadyActive,
  type ConversionController,
  type ConversionControllerDeps,
  type WorkerLike,
  type WorkerMessage,
  type ConversionWorkerSpawnData
} from './controller'
import type { ConversionRepo } from './conversionRepo'
import { PRESETS } from './presets'
import type { Preset } from '../../shared/ipc-types'
import { IpcChannels } from '../../shared/ipc-types'

const MP3_320: Preset = PRESETS[0]

class FakeWorker extends EventEmitter implements WorkerLike {
  postMessage = vi.fn()
  terminate = vi.fn(() => Promise.resolve(0))
}

function makeRepo(): ConversionRepo {
  return {
    createConversion: vi.fn(),
    insertFileBatch: vi.fn(),
    updateFile: vi.fn(),
    bumpHeartbeat: vi.fn(),
    complete: vi.fn(),
    findResumable: vi.fn(() => []),
    markStaleAsCrashed: vi.fn(() => 0),
    getResumablePending: vi.fn(() => []),
    listFiles: vi.fn(() => []),
    deleteConversion: vi.fn(),
    getConversion: vi.fn(() => null),
    updateConversionStatus: vi.fn()
  } as unknown as ConversionRepo
}

interface Harness {
  controller: ConversionController
  workers: FakeWorker[]
  spawnedData: ConversionWorkerSpawnData[]
  repo: ConversionRepo
  send: ConversionControllerDeps['send']
  resolveFfmpegPath: ConversionControllerDeps['resolveFfmpegPath']
  ensureDir: ConversionControllerDeps['ensureDir']
  setNow: (n: number) => void
}

function makeHarness(opts: { cpuCount?: number; heartbeatMs?: number } = {}): Harness {
  const workers: FakeWorker[] = []
  const spawnedData: ConversionWorkerSpawnData[] = []
  const spawnWorker: ConversionControllerDeps['spawnWorker'] = (data) => {
    spawnedData.push(data)
    const w = new FakeWorker()
    workers.push(w)
    return w
  }
  const repo = makeRepo()
  const send = vi.fn()
  const resolveFfmpegPath = vi.fn((o: { rawPath: string }) => `${o.rawPath}.RESOLVED`)
  const ensureDir = vi.fn(async () => {})
  let nowVal = 1_000
  const deps: ConversionControllerDeps = {
    spawnWorker,
    repo,
    send,
    resolveFfmpegPath,
    getFfmpegRawPath: () => '/raw',
    isPackaged: true,
    cpuCount: () => opts.cpuCount ?? 8,
    now: () => nowVal,
    heartbeatMs: opts.heartbeatMs ?? 5_000,
    ensureDir
  }
  const controller = createConversionController(deps)
  return {
    controller,
    workers,
    spawnedData,
    repo,
    send,
    resolveFfmpegPath,
    ensureDir,
    setNow: (n: number) => {
      nowVal = n
    }
  }
}

describe('ConversionController', () => {
  let h: Harness

  beforeEach(() => {
    h = makeHarness()
  })

  describe('start', () => {
    it('returns a uuid, persists the batch + files, spawns the worker', async () => {
      const id = await h.controller.start({
        rootFolder: '/Music',
        filePaths: ['/Music/a.mp3'],
        preset: MP3_320
      })
      expect(typeof id).toBe('string')
      expect(id.length).toBeGreaterThan(0)
      expect(h.repo.createConversion).toHaveBeenCalledWith(
        expect.objectContaining({
          id,
          rootFolder: '/Music',
          preset: MP3_320,
          outputDir: '/Music/converted/mp3-320',
          startedAt: 1_000
        })
      )
      expect(h.repo.insertFileBatch).toHaveBeenCalledWith(
        [{ filePath: '/Music/a.mp3', status: 'pending' }],
        id
      )
      expect(h.spawnedData).toHaveLength(1)
      expect(h.spawnedData[0]).toEqual(
        expect.objectContaining({
          conversionId: id,
          files: ['/Music/a.mp3'],
          ffmpegPath: '/raw.RESOLVED',
          preset: MP3_320,
          outputDir: '/Music/converted/mp3-320',
          parallelism: expect.any(Number)
        })
      )
    })

    it('parallelism = min(cpus-1, 4) — clamped at 4 for many-cpu hosts', async () => {
      h = makeHarness({ cpuCount: 16 })
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      expect(h.spawnedData[0].parallelism).toBe(4)
    })

    it('parallelism = max(1, ...) — floor at 1 for single-CPU hosts', async () => {
      h = makeHarness({ cpuCount: 1 })
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      expect(h.spawnedData[0].parallelism).toBe(1)
    })

    it('throws BatchAlreadyActive when called while a batch is active (LOCKED single-active)', async () => {
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      await expect(
        h.controller.start({
          rootFolder: '/M',
          filePaths: ['/M/b.mp3'],
          preset: MP3_320
        })
      ).rejects.toBeInstanceOf(BatchAlreadyActive)
      // Prior batch is NOT pre-empted — no cancel postMessage on the live worker.
      expect(h.workers[0].postMessage).not.toHaveBeenCalledWith({ type: 'cancel' })
    })

    it('resolves ffmpegPath via the injected helper (Pitfall 1 wiring)', async () => {
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      expect(h.resolveFfmpegPath).toHaveBeenCalledWith({
        rawPath: '/raw',
        isPackaged: true
      })
      expect(h.spawnedData[0].ffmpegPath).toBe('/raw.RESOLVED')
    })

    it('ensures the output directory exists before spawning the worker', async () => {
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      expect(h.ensureDir).toHaveBeenCalledWith('/M/converted/mp3-320')
    })
  })

  describe('event forwarding', () => {
    let id: string
    let w: FakeWorker

    beforeEach(async () => {
      id = await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      w = h.workers[0]
    })

    it('progress events forward to renderer but do NOT touch the repo', () => {
      const msg: WorkerMessage = {
        type: 'progress',
        conversionId: id,
        filePath: '/M/a.mp3',
        percent: 42,
        phase: 'transcoding'
      }
      w.emit('message', msg)
      expect(h.send).toHaveBeenCalledWith(IpcChannels.ConversionEvent, msg)
      expect(h.repo.updateFile).not.toHaveBeenCalled()
    })

    it('fileStart internal event flips conversion_files row to running — NOT forwarded', () => {
      w.emit('message', {
        type: 'fileStart',
        conversionId: id,
        filePath: '/M/a.mp3'
      } as WorkerMessage)
      expect(h.repo.updateFile).toHaveBeenCalledWith(id, '/M/a.mp3', {
        status: 'running'
      })
      // Not forwarded to the renderer.
      const fwd = (h.send as unknown as ReturnType<typeof vi.fn>).mock.calls.filter(
        (c) => (c[1] as { type?: unknown })?.type === 'fileStart'
      )
      expect(fwd).toHaveLength(0)
    })

    it("fileDone success: persists FIRST then forwards (invocationCallOrder)", () => {
      const msg = {
        type: 'fileDone' as const,
        conversionId: id,
        filePath: '/M/a.mp3',
        status: 'done' as const,
        outputPath: '/M/converted/mp3-320/a.mp3',
        errorMessage: null
      }
      w.emit('message', msg)
      expect(h.repo.updateFile).toHaveBeenCalledWith(id, '/M/a.mp3', {
        status: 'done',
        errorMessage: null,
        outputPath: '/M/converted/mp3-320/a.mp3'
      })
      expect(h.send).toHaveBeenCalledWith(IpcChannels.ConversionEvent, msg)
      const updOrder = (h.repo.updateFile as unknown as { mock: { invocationCallOrder: number[] } })
        .mock.invocationCallOrder.at(-1)!
      const sendOrder = (h.send as unknown as { mock: { invocationCallOrder: number[] } })
        .mock.invocationCallOrder.at(-1)!
      expect(updOrder).toBeLessThan(sendOrder)
    })

    it('fileDone error: persists errorMessage; batch does NOT terminate', () => {
      const msg = {
        type: 'fileDone' as const,
        conversionId: id,
        filePath: '/M/a.mp3',
        status: 'error' as const,
        outputPath: null,
        errorMessage: 'ffmpeg exited with code 1'
      }
      w.emit('message', msg)
      expect(h.repo.updateFile).toHaveBeenCalledWith(id, '/M/a.mp3', {
        status: 'error',
        errorMessage: 'ffmpeg exited with code 1',
        outputPath: null
      })
      // Batch did NOT auto-complete on a per-file error (CONV-04).
      expect(h.repo.complete).not.toHaveBeenCalled()
    })

    it("fileDone skipped: persists with 'output_exists' message and continues", () => {
      const msg = {
        type: 'fileDone' as const,
        conversionId: id,
        filePath: '/M/a.mp3',
        status: 'skipped' as const,
        outputPath: '/M/converted/mp3-320/a.mp3',
        errorMessage: 'output_exists'
      }
      w.emit('message', msg)
      expect(h.repo.updateFile).toHaveBeenCalledWith(id, '/M/a.mp3', {
        status: 'skipped',
        errorMessage: 'output_exists',
        outputPath: '/M/converted/mp3-320/a.mp3'
      })
      expect(h.repo.complete).not.toHaveBeenCalled()
    })

    it("batch 'done' completes the row and clears active", async () => {
      h.setNow(5_000)
      w.emit('message', { type: 'done', conversionId: id })
      expect(h.repo.complete).toHaveBeenCalledWith(id, {
        status: 'done',
        endedAt: 5_000
      })
      expect(h.send).toHaveBeenCalledWith(IpcChannels.ConversionEvent, {
        type: 'done',
        conversionId: id
      })
      // active cleared — next start() spawns a brand new worker.
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/b.mp3'],
        preset: MP3_320
      })
      expect(h.workers).toHaveLength(2)
    })

    it("worker 'error' triggers crashed-complete + forwards", async () => {
      h.setNow(7_000)
      w.emit('error', new Error('boom'))
      expect(h.repo.complete).toHaveBeenCalledWith(id, {
        status: 'crashed',
        endedAt: 7_000
      })
      expect(h.send).toHaveBeenCalledWith(
        IpcChannels.ConversionEvent,
        expect.objectContaining({ type: 'error', conversionId: id, message: 'boom' })
      )
    })

    it("worker exits silently — synthesised 'crashed' + 'error' send", () => {
      h.setNow(8_000)
      w.emit('exit', 1)
      expect(h.repo.complete).toHaveBeenCalledWith(id, {
        status: 'crashed',
        endedAt: 8_000
      })
      expect(h.send).toHaveBeenCalledWith(
        IpcChannels.ConversionEvent,
        expect.objectContaining({
          type: 'error',
          conversionId: id,
          message: 'worker exited unexpectedly'
        })
      )
    })
  })

  describe('cancel — SIGTERM-first ordering (Pitfall 5)', () => {
    it('postMessage(cancel) FIRST, then awaits cancelled, then terminate, then repo.complete (strict order)', async () => {
      const id = await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      const w = h.workers[0]
      h.setNow(9_000)

      const cancelP = h.controller.cancel(id)

      // Wait a microtask so cancel() has time to call postMessage.
      await Promise.resolve()
      expect(w.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
      // terminate not called yet — controller is awaiting worker 'cancelled'.
      expect(w.terminate).not.toHaveBeenCalled()

      // Simulate worker honouring the cancel.
      w.emit('message', { type: 'cancelled', conversionId: id })
      await cancelP

      // Final order: postMessage → terminate → repo.complete
      const postOrder = w.postMessage.mock.invocationCallOrder[0]
      const termOrder = w.terminate.mock.invocationCallOrder[0]
      const completeOrder = (h.repo.complete as unknown as { mock: { invocationCallOrder: number[] } })
        .mock.invocationCallOrder[0]
      expect(postOrder).toBeLessThan(termOrder)
      expect(termOrder).toBeLessThan(completeOrder)

      expect(h.repo.complete).toHaveBeenCalledWith(id, {
        status: 'cancelled',
        endedAt: 9_000
      })
      expect(h.send).toHaveBeenCalledWith(
        IpcChannels.ConversionEvent,
        expect.objectContaining({ type: 'cancelled', conversionId: id })
      )
    })

    it('cancel on a non-active id is a no-op (no repo writes, no postMessage)', async () => {
      await h.controller.cancel('does-not-exist')
      expect(h.repo.complete).not.toHaveBeenCalled()
      expect(h.send).not.toHaveBeenCalled()
    })
  })

  describe('heartbeat timer', () => {
    beforeEach(() => {
      vi.useFakeTimers({ shouldAdvanceTime: false })
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('bumps heartbeat every heartbeatMs while active', async () => {
      h = makeHarness({ heartbeatMs: 5_000 })
      const id = await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      expect(h.repo.bumpHeartbeat).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5_000)
      expect(h.repo.bumpHeartbeat).toHaveBeenCalledTimes(1)
      expect(h.repo.bumpHeartbeat).toHaveBeenCalledWith(id, expect.any(Number))
      vi.advanceTimersByTime(5_000)
      expect(h.repo.bumpHeartbeat).toHaveBeenCalledTimes(2)
    })

    it('clears the timer on terminal done', async () => {
      h = makeHarness({ heartbeatMs: 5_000 })
      const id = await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      const w = h.workers[0]
      w.emit('message', { type: 'done', conversionId: id })
      const callsBefore = (h.repo.bumpHeartbeat as unknown as ReturnType<typeof vi.fn>).mock
        .calls.length
      vi.advanceTimersByTime(10_000)
      const callsAfter = (h.repo.bumpHeartbeat as unknown as ReturnType<typeof vi.fn>).mock
        .calls.length
      expect(callsAfter).toBe(callsBefore)
    })
  })

  describe('resume — Plan 03-03', () => {
    function seedCrashedRow(id: string, files: string[]): void {
      ;(h.repo.getConversion as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id,
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/converted/mp3-320',
        status: 'crashed',
        startedAt: 100,
        endedAt: 200,
        heartbeatAt: 100
      })
      ;(h.repo.getResumablePending as ReturnType<typeof vi.fn>).mockReturnValueOnce(files)
    }

    it('re-spawns the worker with the original preset + only the resumable file list', async () => {
      seedCrashedRow('c-resume', ['/M/a.mp3', '/M/c.flac'])
      h.setNow(7_000)
      await h.controller.resume('c-resume')

      expect(h.repo.getConversion).toHaveBeenCalledWith('c-resume')
      expect(h.repo.getResumablePending).toHaveBeenCalledWith('c-resume')
      // Resurrects status + refreshes heartbeat BEFORE spawning worker.
      expect(h.repo.updateConversionStatus).toHaveBeenCalledWith('c-resume', 'running')
      expect(h.repo.bumpHeartbeat).toHaveBeenCalledWith('c-resume', 7_000)
      expect(h.spawnedData).toHaveLength(1)
      expect(h.spawnedData[0]).toEqual(
        expect.objectContaining({
          conversionId: 'c-resume',
          files: ['/M/a.mp3', '/M/c.flac'],
          preset: MP3_320,
          outputDir: '/M/converted/mp3-320'
        })
      )
      // Ordering: updateConversionStatus + bumpHeartbeat both happen before
      // spawnWorker so the boot sweep can't immediately re-crash the row.
      const updateOrder = (h.repo.updateConversionStatus as ReturnType<typeof vi.fn>)
        .mock.invocationCallOrder[0]
      const bumpOrder = (h.repo.bumpHeartbeat as ReturnType<typeof vi.fn>)
        .mock.invocationCallOrder[0]
      expect(updateOrder).toBeLessThan(bumpOrder)
    })

    it('throws BatchAlreadyActive when a batch is already running (LOCKED single-active)', async () => {
      await h.controller.start({
        rootFolder: '/M',
        filePaths: ['/M/a.mp3'],
        preset: MP3_320
      })
      await expect(h.controller.resume('whatever')).rejects.toBeInstanceOf(
        BatchAlreadyActive
      )
      // resume should not touch the DB once it has rejected.
      expect(h.repo.updateConversionStatus).not.toHaveBeenCalled()
    })

    it('throws "Batch not resumable" when row is missing', async () => {
      ;(h.repo.getConversion as ReturnType<typeof vi.fn>).mockReturnValueOnce(null)
      await expect(h.controller.resume('missing-id')).rejects.toThrow(
        /not resumable/i
      )
      expect(h.spawnedData).toHaveLength(0)
    })

    it('throws "Batch not resumable" when row status is cancelled (LOCKED)', async () => {
      ;(h.repo.getConversion as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'c-cancelled',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        status: 'cancelled',
        startedAt: 100,
        endedAt: 200,
        heartbeatAt: 100
      })
      await expect(h.controller.resume('c-cancelled')).rejects.toThrow(
        /not resumable/i
      )
      expect(h.spawnedData).toHaveLength(0)
    })

    it('throws "Batch not resumable" when row status is done', async () => {
      ;(h.repo.getConversion as ReturnType<typeof vi.fn>).mockReturnValueOnce({
        id: 'c-done',
        rootFolder: '/M',
        preset: MP3_320,
        outputDir: '/M/out',
        status: 'done',
        startedAt: 100,
        endedAt: 200,
        heartbeatAt: 100
      })
      await expect(h.controller.resume('c-done')).rejects.toThrow(/not resumable/i)
    })

    it('with no pending files: cleanly completes status=done without spawning a worker', async () => {
      seedCrashedRow('c-empty', [])
      h.setNow(8_000)
      await h.controller.resume('c-empty')
      expect(h.spawnedData).toHaveLength(0)
      expect(h.repo.complete).toHaveBeenCalledWith('c-empty', {
        status: 'done',
        endedAt: 8_000
      })
      expect(h.send).toHaveBeenCalledWith(IpcChannels.ConversionEvent, {
        type: 'done',
        conversionId: 'c-empty'
      })
    })

    it('after resume completes, active is set so a follow-up start rejects', async () => {
      seedCrashedRow('c-active', ['/M/x.mp3'])
      await h.controller.resume('c-active')
      await expect(
        h.controller.start({
          rootFolder: '/M',
          filePaths: ['/M/y.mp3'],
          preset: MP3_320
        })
      ).rejects.toBeInstanceOf(BatchAlreadyActive)
    })
  })

  describe('listResumable', () => {
    it('delegates to repo.findResumable', () => {
      h.controller.listResumable()
      expect(h.repo.findResumable).toHaveBeenCalled()
    })
  })

  describe('markStaleAsCrashed — boot sweep wrapper (Pitfall 9)', () => {
    it('delegates to repo.markStaleAsCrashed and returns the count', () => {
      ;(h.repo.markStaleAsCrashed as ReturnType<typeof vi.fn>).mockReturnValueOnce(3)
      const n = h.controller.markStaleAsCrashed({ thresholdMs: 30_000, now: 9_999 })
      expect(n).toBe(3)
      expect(h.repo.markStaleAsCrashed).toHaveBeenCalledWith({
        thresholdMs: 30_000,
        now: 9_999
      })
    })

    it('does NOT spawn a worker and does NOT touch activeConversion', async () => {
      h.controller.markStaleAsCrashed({ thresholdMs: 30_000, now: 1 })
      expect(h.spawnedData).toHaveLength(0)
      // active is null, so a subsequent start() must succeed (no leftover state).
      await expect(
        h.controller.start({
          rootFolder: '/M',
          filePaths: ['/M/a.mp3'],
          preset: MP3_320
        })
      ).resolves.toBeTruthy()
    })
  })
})
