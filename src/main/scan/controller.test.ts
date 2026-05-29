import { describe, it, expect, beforeEach, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import {
  createScanController,
  type ScanController,
  type ScanControllerDeps,
  type WorkerLike
} from './controller'
import type { ScanRepo } from './scanRepo'
import type { ScanEvent, ScannedFile } from '../../shared/ipc-types'
import { IpcChannels } from '../../shared/ipc-types'

class FakeWorker extends EventEmitter implements WorkerLike {
  postMessage = vi.fn()
  terminate = vi.fn(() => Promise.resolve(0))
}

function makeRepo(): ScanRepo {
  return {
    createScan: vi.fn(),
    replaceScanForFolder: vi.fn(),
    insertBatch: vi.fn(),
    complete: vi.fn(),
    getScan: vi.fn(),
    listFiles: vi.fn(),
    iterateFiles: vi.fn(),
    deleteScansForFolder: vi.fn()
  } as unknown as ScanRepo
}

function row(p: string): ScannedFile {
  return {
    path: p,
    format: 'MP3',
    bitrate: 320,
    sizeBytes: 1,
    sampleRate: 44100,
    durationSeconds: 1,
    hasGenre: true,
    hasBpm: true,
    hasKey: true,
    parsedOk: true,
    errorMessage: null
  }
}

describe('ScanController', () => {
  let workers: FakeWorker[]
  let spawnWorker: ScanControllerDeps['spawnWorker']
  let repo: ScanRepo
  let send: ScanControllerDeps['send']
  let controller: ScanController
  let nowVal: number

  beforeEach(() => {
    workers = []
    spawnWorker = vi.fn<(folder: string, scanId: string) => WorkerLike>((
      _folder: string,
      _scanId: string
    ) => {
      const w = new FakeWorker()
      workers.push(w)
      return w
    })
    repo = makeRepo()
    send = vi.fn<(channel: string, payload: ScanEvent) => void>()
    nowVal = 1_000
    const deps: ScanControllerDeps = {
      spawnWorker,
      repo,
      send,
      now: () => nowVal
    }
    controller = createScanController(deps)
  })

  it('start returns a uuid scanId and calls replaceScanForFolder + spawnWorker', async () => {
    const id = await controller.start('/Music')
    expect(typeof id).toBe('string')
    expect(id.length).toBeGreaterThan(0)
    expect(repo.replaceScanForFolder).toHaveBeenCalledWith(id, '/Music', 1_000)
    expect(spawnWorker).toHaveBeenCalledWith('/Music', id)
  })

  it("forwards 'rows' batches: persists FIRST then sends to renderer", async () => {
    const id = await controller.start('/M')
    const w = workers[0]
    const rows = [row('/M/a.mp3'), row('/M/b.mp3')]
    const event: ScanEvent = { type: 'rows', scanId: id, rows }
    w.emit('message', event)

    expect(repo.insertBatch).toHaveBeenCalledWith(rows, id)
    expect(send).toHaveBeenCalledWith(IpcChannels.ScanEvent, event)

    // Persist BEFORE notify.
    const insertOrder = (repo.insertBatch as unknown as { mock: { invocationCallOrder: number[] } })
      .mock.invocationCallOrder[0]
    const sendOrder = (send as unknown as { mock: { invocationCallOrder: number[] } }).mock
      .invocationCallOrder[0]
    expect(insertOrder).toBeLessThan(sendOrder)
  })

  it("on 'done' calls repo.complete + forwards event + clears active scan", async () => {
    const id = await controller.start('/M')
    const w = workers[0]
    nowVal = 5_000
    const event: ScanEvent = { type: 'done', scanId: id, totalFiles: 42, durationMs: 1234 }
    w.emit('message', event)

    expect(repo.complete).toHaveBeenCalledWith(id, {
      status: 'done',
      totalFiles: 42,
      endedAt: 5_000
    })
    expect(send).toHaveBeenCalledWith(IpcChannels.ScanEvent, event)

    // Active cleared: starting again should spawn a NEW worker without
    // touching the prior one (no cancel path).
    const w0PostCount = w.postMessage.mock.calls.length
    await controller.start('/M')
    expect(w.postMessage.mock.calls.length).toBe(w0PostCount)
    expect(workers).toHaveLength(2)
  })

  it("on 'error' marks scan status=error and forwards", async () => {
    const id = await controller.start('/M')
    const w = workers[0]
    nowVal = 7_000
    const event: ScanEvent = { type: 'error', scanId: id, message: 'boom' }
    w.emit('message', event)

    expect(repo.complete).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ status: 'error', endedAt: 7_000 })
    )
    expect(send).toHaveBeenCalledWith(IpcChannels.ScanEvent, event)
  })

  it("single-active-scan: start while running cancels prior worker and spawns a new one", async () => {
    const firstId = await controller.start('/M')
    const firstWorker = workers[0]

    const secondId = await controller.start('/M')

    expect(firstWorker.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(firstWorker.terminate).toHaveBeenCalled()
    expect(workers).toHaveLength(2)
    expect(secondId).not.toBe(firstId)
  })

  it("cancel terminates the active worker, completes status=cancelled, and forwards", async () => {
    const id = await controller.start('/M')
    const w = workers[0]
    nowVal = 9_000
    await controller.cancel(id)

    expect(w.postMessage).toHaveBeenCalledWith({ type: 'cancel' })
    expect(w.terminate).toHaveBeenCalled()
    expect(repo.complete).toHaveBeenCalledWith(
      id,
      expect.objectContaining({ status: 'cancelled', endedAt: 9_000 })
    )
    expect(send).toHaveBeenCalledWith(
      IpcChannels.ScanEvent,
      expect.objectContaining({ type: 'cancelled', scanId: id })
    )
  })

  it('cancel on a non-active scanId is a no-op', async () => {
    await controller.cancel('does-not-exist')
    expect(repo.complete).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
