import { randomUUID } from 'node:crypto'
import type { ScanRepo } from './scanRepo'
import { IpcChannels, type ScanEvent } from '../../shared/ipc-types'

/**
 * Minimal worker-thread surface the controller depends on. Production wires
 * a real Node `Worker`; tests pass an EventEmitter-shaped fake.
 */
export interface WorkerLike {
  on(event: 'message', cb: (msg: ScanEvent) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  postMessage(msg: unknown): void
  terminate(): Promise<number>
}

export interface ScanControllerDeps {
  spawnWorker: (folder: string, scanId: string) => WorkerLike
  repo: ScanRepo
  send: (channel: string, payload: ScanEvent) => void
  now?: () => number
}

export interface ScanController {
  start(folder: string): Promise<string>
  cancel(scanId: string): Promise<void>
}

interface ActiveScan {
  scanId: string
  worker: WorkerLike
  settled: Promise<void>
  resolveSettled: () => void
}

/**
 * ScanController owns the worker lifecycle and event routing.
 *
 * Invariants:
 *   - At most ONE active scan at a time (RESEARCH Open Question 4).
 *   - Per batch: persist (repo.insertBatch) BEFORE notifying renderer (send).
 *   - Terminal events (done|cancelled|error) clear `activeScan` so the next
 *     start() spawns cleanly without the cancel path.
 */
export function createScanController(deps: ScanControllerDeps): ScanController {
  const now = deps.now ?? (() => Date.now())
  let activeScan: ActiveScan | null = null

  function clearActive(scanId: string): void {
    if (activeScan && activeScan.scanId === scanId) {
      activeScan.resolveSettled()
      activeScan = null
    }
  }

  function attachWorker(scanId: string, worker: WorkerLike, resolveSettled: () => void): void {
    worker.on('message', (msg: ScanEvent) => {
      if (!msg || typeof msg !== 'object') {
        return
      }
      switch (msg.type) {
        case 'rows':
          // Persist first, then notify — replay safety.
          deps.repo.insertBatch(msg.rows, msg.scanId)
          deps.send(IpcChannels.ScanEvent, msg)
          break
        case 'done':
          deps.repo.complete(msg.scanId, {
            status: 'done',
            totalFiles: msg.totalFiles,
            endedAt: now()
          })
          deps.send(IpcChannels.ScanEvent, msg)
          clearActive(msg.scanId)
          break
        case 'cancelled':
          deps.repo.complete(msg.scanId, {
            status: 'cancelled',
            endedAt: now()
          })
          deps.send(IpcChannels.ScanEvent, msg)
          clearActive(msg.scanId)
          break
        case 'error':
          deps.repo.complete(msg.scanId, {
            status: 'error',
            endedAt: now()
          })
          deps.send(IpcChannels.ScanEvent, msg)
          clearActive(msg.scanId)
          break
      }
    })

    worker.on('error', (err: Error) => {
      deps.repo.complete(scanId, { status: 'error', endedAt: now() })
      deps.send(IpcChannels.ScanEvent, { type: 'error', scanId, message: err.message })
      clearActive(scanId)
    })

    worker.on('exit', () => {
      // If the worker exits without emitting a terminal event, settle the
      // active promise so a queued start() can proceed.
      resolveSettled()
    })
  }

  async function cancelActive(): Promise<void> {
    if (!activeScan) {
      return
    }
    const prior = activeScan
    try {
      prior.worker.postMessage({ type: 'cancel' })
    } catch {
      // Worker may already have exited — ignore.
    }
    try {
      await prior.worker.terminate()
    } catch {
      // ditto
    }
    deps.repo.complete(prior.scanId, { status: 'cancelled', endedAt: now() })
    deps.send(IpcChannels.ScanEvent, { type: 'cancelled', scanId: prior.scanId })
    clearActive(prior.scanId)
    await prior.settled.catch(() => undefined)
  }

  return {
    async start(folder: string): Promise<string> {
      if (activeScan) {
        await cancelActive()
      }
      const scanId = randomUUID()
      deps.repo.replaceScanForFolder(scanId, folder, now())
      const worker = deps.spawnWorker(folder, scanId)
      let resolveSettled: () => void = () => {}
      const settled = new Promise<void>((res) => {
        resolveSettled = res
      })
      activeScan = { scanId, worker, settled, resolveSettled }
      attachWorker(scanId, worker, resolveSettled)
      return scanId
    },

    async cancel(scanId: string): Promise<void> {
      if (!activeScan || activeScan.scanId !== scanId) {
        return
      }
      await cancelActive()
    }
  }
}
