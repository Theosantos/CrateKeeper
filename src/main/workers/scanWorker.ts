/**
 * Scan worker entry. Spawned by ScanController via:
 *   new Worker(path.join(__dirname, 'workers/scanWorker.js'), { workerData })
 *
 * Streams readdirp + music-metadata.parseFile, batches results, and posts
 * ScanEvent messages back to the main process. No DB access, no IPC to
 * renderer — main owns those.
 */
import { parentPort, workerData } from 'node:worker_threads'
import path from 'node:path'
import { readdirp } from 'readdirp'
import { parseFile } from 'music-metadata'
import { AUDIO_EXTS, rowFromMetadata, errorRow } from './scanCore'
import type { ScanEvent, ScannedFile } from '../../shared/ipc-types'

const BATCH_SIZE = 50
const BATCH_MS = 200

interface ScanWorkerData {
  folder: string
  scanId: string
}

const { folder, scanId } = workerData as ScanWorkerData
const port = parentPort
if (!port) {
  throw new Error('scanWorker.ts must be spawned as a Worker (parentPort missing)')
}

let cancelled = false
port.on('message', (m: unknown) => {
  if (m && typeof m === 'object' && (m as { type?: unknown }).type === 'cancel') {
    cancelled = true
  }
})

function post(event: ScanEvent): void {
  port!.postMessage(event)
}

async function run(): Promise<void> {
  const startedAt = Date.now()
  const buffer: ScannedFile[] = []
  let lastFlush = Date.now()
  let total = 0

  const flush = (): void => {
    if (buffer.length === 0) {
      return
    }
    const rows = buffer.splice(0)
    post({ type: 'rows', scanId, rows })
    lastFlush = Date.now()
  }

  try {
    const stream = readdirp(folder, {
      type: 'files',
      fileFilter: (entry) => {
        const ext = path.extname(entry.basename).toLowerCase()
        return (AUDIO_EXTS as readonly string[]).includes(ext)
      },
      alwaysStat: true
    })

    for await (const entry of stream) {
      if (cancelled) {
        break
      }
      total++
      const size = entry.stats?.size ?? 0
      try {
        const meta = await parseFile(entry.fullPath, { duration: true, skipCovers: true })
        buffer.push(rowFromMetadata(entry.fullPath, size, meta))
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        buffer.push(errorRow(entry.fullPath, size, message))
      }
      if (buffer.length >= BATCH_SIZE || Date.now() - lastFlush >= BATCH_MS) {
        flush()
      }
    }

    flush()
    if (cancelled) {
      post({ type: 'cancelled', scanId })
    } else {
      post({ type: 'done', scanId, totalFiles: total, durationMs: Date.now() - startedAt })
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    post({ type: 'error', scanId, message })
  }
}

void run()
