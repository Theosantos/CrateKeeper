/**
 * Conversion worker entry. Spawned by ConversionController via:
 *   new Worker(path.join(__dirname, 'workers/conversionWorker.js'), { workerData })
 *
 * Runs an intra-batch ffmpeg pool of `min(cpus-1, 4)` slot-runners. Each
 * slot pulls the next pending file, spawns ffmpeg via child_process.spawn,
 * parses stderr for `time=HH:MM:SS.MS`, batches progress events
 * (BATCH_SIZE=20, BATCH_MS=200), and flushes per-file completion events
 * immediately.
 *
 * Carry-forwards from Phase 2 scanWorker:
 *   - top-level IIFE run() with try/catch posting {type:'error'} on unhandled
 *   - parentPort cancel signal flips a local boolean
 *   - no electron import, no conversionRepo import — controller owns persistence
 *
 * SIGTERM-first cancel (Pitfall 5): on {type:'cancel'} from parent, the worker
 *   1) sets cancelled = true (stops pulling new files)
 *   2) kills all live ffmpeg children with SIGTERM
 *   3) awaits slot-runners (they observe non-zero exit codes from the killed
 *      children and clean up partial outputs via fs.unlink)
 *   4) posts a single {type:'cancelled'} event when done
 * The controller only calls worker.terminate() AFTER receiving 'cancelled'
 * as a safety net — never before.
 *
 * NOTE: `fileStart` is an INTERNAL message (controller hook for flipping
 *   conversion_files.status='running'); it is NOT in the public
 *   ConversionEvent union exposed in shared/ipc-types.ts (plan-checker
 *   SUGGESTION 2). The controller forwards only the public 5 members.
 */
import { parentPort, workerData } from 'node:worker_threads'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs/promises'
import {
  parseFfmpegTimeProgress,
  parseFfmpegDuration,
  computeOutputPath
} from './conversionCore'
import { buildFfmpegArgs } from '../conversion/presets'
import type { Preset, ConversionEvent } from '../../shared/ipc-types'

const BATCH_SIZE = 20
const BATCH_MS = 200

interface ConversionWorkerData {
  conversionId: string
  files: string[]
  ffmpegPath: string
  preset: Preset
  outputDir: string
  parallelism: number
}

/**
 * Internal worker→controller message. Superset of the public ConversionEvent
 * union: includes `fileStart` which the controller uses to flip
 * conversion_files.status to 'running' but does NOT forward to the renderer.
 */
type WorkerMessage =
  | ConversionEvent
  | { type: 'fileStart'; conversionId: string; filePath: string }

const data = workerData as ConversionWorkerData
const port = parentPort
if (!port) {
  throw new Error('conversionWorker.ts must be spawned as a Worker (parentPort missing)')
}

let cancelled = false
const live = new Set<ChildProcess>()
const progressBuffer: ConversionEvent[] = []
let lastFlush = Date.now()

function post(msg: WorkerMessage): void {
  port!.postMessage(msg)
}

function flushProgress(): void {
  if (progressBuffer.length === 0) return
  const drained = progressBuffer.splice(0)
  for (const evt of drained) {
    post(evt)
  }
  lastFlush = Date.now()
}

port.on('message', (m: unknown) => {
  if (m && typeof m === 'object' && (m as { type?: unknown }).type === 'cancel') {
    cancelled = true
    for (const child of live) {
      try {
        child.kill('SIGTERM')
      } catch {
        // child may already have exited
      }
    }
  }
})

async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

async function convertOne(src: string): Promise<void> {
  if (cancelled) return
  const out = computeOutputPath(src, data.outputDir, data.preset)

  // Skip-on-conflict policy (D-CONV-OUTPUT).
  if (await fileExists(out)) {
    post({
      type: 'fileDone',
      conversionId: data.conversionId,
      filePath: src,
      status: 'skipped',
      outputPath: out,
      errorMessage: 'output_exists'
    })
    return
  }

  // Flip the conversion_files row to 'running' via internal hook.
  post({ type: 'fileStart', conversionId: data.conversionId, filePath: src })

  const args = buildFfmpegArgs(src, out, data.preset)
  const child = spawn(data.ffmpegPath, args, {
    stdio: ['ignore', 'ignore', 'pipe']
  })
  live.add(child)

  let duration: number | null = null
  child.stderr!.setEncoding('utf8')
  child.stderr!.on('data', (chunk: string) => {
    if (duration === null) {
      duration = parseFfmpegDuration(chunk)
    }
    const t = parseFfmpegTimeProgress(chunk)
    if (t !== null && duration !== null && duration > 0) {
      const percent = Math.min(100, Math.max(0, Math.round((t / duration) * 100)))
      progressBuffer.push({
        type: 'progress',
        conversionId: data.conversionId,
        filePath: src,
        percent,
        phase: 'transcoding'
      })
      if (
        progressBuffer.length >= BATCH_SIZE ||
        Date.now() - lastFlush >= BATCH_MS
      ) {
        flushProgress()
      }
    }
  })

  const exitCode = await new Promise<number>((resolve) => {
    child.on('exit', (code) => resolve(code ?? 1))
    child.on('error', () => resolve(1))
  })
  live.delete(child)

  // Flush any pending progress before terminal event so renderer sees the
  // final percent on this file.
  flushProgress()

  if (cancelled) {
    await fs.unlink(out).catch(() => undefined)
    // Do NOT post fileDone for cancelled files — the batch-level 'cancelled'
    // event covers them.
    return
  }

  if (exitCode === 0) {
    post({
      type: 'fileDone',
      conversionId: data.conversionId,
      filePath: src,
      status: 'done',
      outputPath: out,
      errorMessage: null
    })
  } else {
    await fs.unlink(out).catch(() => undefined)
    post({
      type: 'fileDone',
      conversionId: data.conversionId,
      filePath: src,
      status: 'error',
      outputPath: null,
      errorMessage: `ffmpeg exited with code ${exitCode}`
    })
  }
}

async function run(): Promise<void> {
  let idx = 0
  const next = (): string | null => {
    if (cancelled || idx >= data.files.length) return null
    return data.files[idx++]
  }

  const slotRunner = async (): Promise<void> => {
    while (true) {
      const f = next()
      if (f === null) return
      try {
        await convertOne(f)
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        post({
          type: 'fileDone',
          conversionId: data.conversionId,
          filePath: f,
          status: 'error',
          outputPath: null,
          errorMessage: message
        })
      }
    }
  }

  const slots = Array.from(
    { length: Math.max(1, data.parallelism) },
    () => slotRunner()
  )
  await Promise.all(slots)
  flushProgress()

  post(
    cancelled
      ? { type: 'cancelled', conversionId: data.conversionId }
      : { type: 'done', conversionId: data.conversionId }
  )
}

run().catch((err) => {
  const message = err instanceof Error ? err.message : String(err)
  post({ type: 'error', conversionId: data.conversionId, message })
})
