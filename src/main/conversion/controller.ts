import { randomUUID } from 'node:crypto'
import path from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { ConversionRepo } from './conversionRepo'
import type { Preset, ConversionEvent, ResumableBatch } from '../../shared/ipc-types'
import { IpcChannels } from '../../shared/ipc-types'

/** Single-active invariant violation — handler maps this to a clean rejection. */
export class BatchAlreadyActive extends Error {
  constructor() {
    super('A conversion batch is already active')
    this.name = 'BatchAlreadyActive'
  }
}

/**
 * Internal worker→controller message. Superset of the public ConversionEvent:
 * adds `fileStart` (controller hook for flipping conversion_files.status to
 * 'running'). The controller does NOT forward fileStart to the renderer
 * (plan-checker SUGGESTION 2 — kept main-internal).
 */
export type WorkerMessage =
  | ConversionEvent
  | { type: 'fileStart'; conversionId: string; filePath: string }

export interface WorkerLike {
  on(event: 'message', cb: (msg: WorkerMessage) => void): unknown
  on(event: 'error', cb: (err: Error) => void): unknown
  on(event: 'exit', cb: (code: number) => void): unknown
  postMessage(msg: unknown): void
  terminate(): Promise<number>
}

export interface ConversionWorkerSpawnData {
  conversionId: string
  files: string[]
  ffmpegPath: string
  preset: Preset
  outputDir: string
  parallelism: number
}

export interface ConversionControllerDeps {
  spawnWorker: (data: ConversionWorkerSpawnData) => WorkerLike
  repo: ConversionRepo
  send: (channel: string, payload: ConversionEvent) => void
  resolveFfmpegPath: (opts: { rawPath: string; isPackaged: boolean }) => string
  getFfmpegRawPath: () => string
  isPackaged: boolean
  cpuCount?: () => number
  now?: () => number
  heartbeatMs?: number
  /**
   * Override directory creation (tests pass a no-op). Production uses
   * `fs.mkdir(dir, { recursive: true })`.
   */
  ensureDir?: (dir: string) => Promise<void>
}

export interface ConversionStartParams {
  rootFolder: string
  filePaths: string[]
  preset: Preset
}

export interface ConversionController {
  start(params: ConversionStartParams): Promise<string>
  cancel(conversionId: string): Promise<void>
  resume(conversionId: string): Promise<void>
  listResumable(): ResumableBatch[]
}

interface ActiveConversion {
  conversionId: string
  worker: WorkerLike
  heartbeatTimer: ReturnType<typeof setInterval> | null
  settled: Promise<void>
  resolveSettled: () => void
  workerSettled: Promise<void>
  resolveWorkerSettled: () => void
}

const DEFAULT_HEARTBEAT_MS = 5_000
const CANCEL_SETTLE_TIMEOUT_MS = 5_000

function computeParallelism(cpuCount: number): number {
  return Math.max(1, Math.min(cpuCount - 1, 4))
}

/**
 * ConversionController owns the lifecycle of a single active conversion batch.
 *
 * Invariants:
 *   - LOCKED single-active (D-CONV-CONCURRENCY): start() while active throws
 *     BatchAlreadyActive. Prior batch is NOT pre-empted (unlike scan).
 *   - Persist-then-forward: repo.updateFile is awaited before send(...) on
 *     every fileDone path (test asserts via invocationCallOrder).
 *   - SIGTERM-first cancel (Pitfall 5): postMessage('cancel') → await worker
 *     'cancelled' (or 5s timeout) → worker.terminate() → repo.complete →
 *     send → clearActive.
 *   - Heartbeat every 5s (configurable via heartbeatMs); cleared on every
 *     terminal transition.
 */
export function createConversionController(
  deps: ConversionControllerDeps
): ConversionController {
  const now = deps.now ?? (() => Date.now())
  const heartbeatMs = deps.heartbeatMs ?? DEFAULT_HEARTBEAT_MS
  const cpuCount = deps.cpuCount ?? (() => os.cpus().length)
  const ensureDir =
    deps.ensureDir ?? (async (dir: string): Promise<void> => {
      await fs.mkdir(dir, { recursive: true })
    })

  let active: ActiveConversion | null = null

  function clearActive(conversionId: string): void {
    if (active && active.conversionId === conversionId) {
      if (active.heartbeatTimer !== null) {
        clearInterval(active.heartbeatTimer)
      }
      active.resolveSettled()
      active = null
    }
  }

  function attachWorker(conversionId: string, worker: WorkerLike): void {
    worker.on('message', (msg: WorkerMessage) => {
      if (!msg || typeof msg !== 'object') return

      switch (msg.type) {
        case 'fileStart':
          // Internal — flip the persisted row to 'running'; NOT forwarded.
          deps.repo.updateFile(conversionId, msg.filePath, { status: 'running' })
          return

        case 'progress':
          // Volatile — no repo writes. Just forward.
          deps.send(IpcChannels.ConversionEvent, msg)
          return

        case 'fileDone':
          // Persist FIRST, then notify (assertion target).
          deps.repo.updateFile(conversionId, msg.filePath, {
            status: msg.status,
            errorMessage: msg.errorMessage,
            outputPath: msg.outputPath
          })
          deps.send(IpcChannels.ConversionEvent, msg)
          return

        case 'done':
          deps.repo.complete(conversionId, { status: 'done', endedAt: now() })
          deps.send(IpcChannels.ConversionEvent, msg)
          if (active && active.conversionId === conversionId) {
            active.resolveWorkerSettled()
          }
          clearActive(conversionId)
          return

        case 'cancelled':
          // Repo + send happen in cancel() — here we only release the
          // worker-settled promise so cancel() can proceed to terminate().
          if (active && active.conversionId === conversionId) {
            active.resolveWorkerSettled()
          }
          return

        case 'error':
          deps.repo.complete(conversionId, { status: 'crashed', endedAt: now() })
          deps.send(IpcChannels.ConversionEvent, msg)
          if (active && active.conversionId === conversionId) {
            active.resolveWorkerSettled()
          }
          clearActive(conversionId)
          return
      }
    })

    worker.on('error', (err: Error) => {
      deps.repo.complete(conversionId, { status: 'crashed', endedAt: now() })
      deps.send(IpcChannels.ConversionEvent, {
        type: 'error',
        conversionId,
        message: err.message
      })
      if (active && active.conversionId === conversionId) {
        active.resolveWorkerSettled()
      }
      clearActive(conversionId)
    })

    worker.on('exit', () => {
      // If the worker exits without emitting a terminal event, treat as crash.
      if (active && active.conversionId === conversionId) {
        // Defensive — covers Pitfall 5 worst case (worker dies silently).
        deps.repo.complete(conversionId, { status: 'crashed', endedAt: now() })
        deps.send(IpcChannels.ConversionEvent, {
          type: 'error',
          conversionId,
          message: 'worker exited unexpectedly'
        })
        active.resolveWorkerSettled()
        clearActive(conversionId)
      }
    })
  }

  return {
    async start({ rootFolder, filePaths, preset }): Promise<string> {
      if (active !== null) {
        throw new BatchAlreadyActive()
      }

      const conversionId = randomUUID()
      const outputDir = path.join(rootFolder, 'converted', preset.slug)
      await ensureDir(outputDir)

      const startedAt = now()
      deps.repo.createConversion({
        id: conversionId,
        rootFolder,
        preset,
        outputDir,
        startedAt
      })
      deps.repo.insertFileBatch(
        filePaths.map((p) => ({ filePath: p, status: 'pending' as const })),
        conversionId
      )

      const ffmpegPath = deps.resolveFfmpegPath({
        rawPath: deps.getFfmpegRawPath(),
        isPackaged: deps.isPackaged
      })

      const parallelism = computeParallelism(cpuCount())

      const worker = deps.spawnWorker({
        conversionId,
        files: filePaths,
        ffmpegPath,
        preset,
        outputDir,
        parallelism
      })

      let resolveSettled: () => void = () => {}
      const settled = new Promise<void>((res) => {
        resolveSettled = res
      })
      let resolveWorkerSettled: () => void = () => {}
      const workerSettled = new Promise<void>((res) => {
        resolveWorkerSettled = res
      })

      const heartbeatTimer = setInterval(() => {
        try {
          deps.repo.bumpHeartbeat(conversionId, now())
        } catch {
          // Race with terminal — ignore.
        }
      }, heartbeatMs)

      active = {
        conversionId,
        worker,
        heartbeatTimer,
        settled,
        resolveSettled,
        workerSettled,
        resolveWorkerSettled
      }

      attachWorker(conversionId, worker)

      return conversionId
    },

    async cancel(conversionId: string): Promise<void> {
      if (active === null || active.conversionId !== conversionId) {
        return
      }
      const a = active

      // SIGTERM-first ordering (Pitfall 5):
      // 1. postMessage('cancel') — worker iterates live children + SIGTERMs each
      try {
        a.worker.postMessage({ type: 'cancel' })
      } catch {
        // Worker may already have exited.
      }

      // 2. Await worker 'cancelled' (or 5s timeout fallback)
      const timeoutPromise = new Promise<void>((res) => {
        setTimeout(res, CANCEL_SETTLE_TIMEOUT_MS)
      })
      await Promise.race([a.workerSettled, timeoutPromise])

      // 3. worker.terminate() — safety net
      try {
        await a.worker.terminate()
      } catch {
        // ditto
      }

      // 4. repo.complete + send
      deps.repo.complete(conversionId, { status: 'cancelled', endedAt: now() })
      deps.send(IpcChannels.ConversionEvent, { type: 'cancelled', conversionId })

      // 5. clearActive (also clears heartbeat timer)
      clearActive(conversionId)
    },

    async resume(_conversionId: string): Promise<void> {
      throw new Error(
        'conversion:resume not implemented in Plan 03-01; see Plan 03-03'
      )
    },

    listResumable(): ResumableBatch[] {
      return deps.repo.findResumable()
    }
  }
}
