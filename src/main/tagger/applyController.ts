/**
 * applyController — Phase 5 Plan 02
 *
 * Sequential, single-active, per-file-retryable batch controller.
 *
 * Exports:
 *   createApplyController   — factory returning { applyPendingWrites }
 *   makeTaggerWriteSender   — push-channel sender for main→renderer events
 *
 * Design:
 * - Module-level `isRunning` guard prevents concurrent batch runs (T-05-TMP).
 * - Sequential per-file loop (one file at a time) — lighter than conversion
 *   parallelism and required for deterministic temp-name safety.
 * - Per-file try/catch: a failure leaves applied_at NULL so the file is
 *   retryable on the next Appliquer pass (D-05 non-destructive recovery).
 * - All deps injected — never import tagWriter/taggerRepo directly (mirrors
 *   scan controller for unit-testability).
 */
import type { WebContents } from 'electron'
import { IpcChannels } from '../../shared/ipc-types'
import type { TagWriteEvent, ApplyResult } from '../../shared/ipc-types'
import type { TaggerRepo } from './taggerRepo'
import { getWriteStrategy } from './tagWriter'
import type { Mp3TagInput, Mp4TagInput } from './tagWriter'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ApplyControllerDeps {
  taggerRepo: TaggerRepo
  writeMp3Tags: (filePath: string, input: Mp3TagInput) => Promise<void>
  writeMp4Tags: (filePath: string, input: Mp4TagInput, ffmpegPath: string) => Promise<void>
  ffmpegBinaryPath: string
  send: (channel: string, payload: TagWriteEvent) => void
  now?: () => number
}

export interface ApplyController {
  applyPendingWrites(): Promise<ApplyResult>
}

// ─── Single-active guard (module-level, mirrors scan controller) ──────────────

let isRunning = false

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Build an ApplyController bound to the provided deps.
 * All dependencies are injected — no module-level singletons consumed here.
 */
export function createApplyController(deps: ApplyControllerDeps): ApplyController {
  const now = deps.now ?? ((): number => Date.now())

  return {
    async applyPendingWrites(): Promise<ApplyResult> {
      if (isRunning) throw new Error('Un lot est déjà en cours')
      isRunning = true

      let totalWritten = 0
      let totalFailed = 0

      try {
        const pending = deps.taggerRepo.listPendingWrites()

        for (const edit of pending) {
          try {
            const strategy = getWriteStrategy(edit.filePath)

            if (strategy === 'mp3') {
              await deps.writeMp3Tags(edit.filePath, edit)
            } else if (strategy === 'mp4') {
              await deps.writeMp4Tags(edit.filePath, edit, deps.ffmpegBinaryPath)
            } else {
              // strategy === 'unsupported'
              throw new Error('format non supporté')
            }

            // Success: mark applied AFTER write completes (D-05)
            deps.taggerRepo.markApplied(edit.filePath, now())
            totalWritten++
            deps.send(IpcChannels.TaggerWriteEvent, {
              type: 'fileDone',
              filePath: edit.filePath,
              ok: true
            })
          } catch (err: unknown) {
            // Per-file failure: applied_at stays NULL → retryable (D-05)
            totalFailed++
            const error = err instanceof Error ? err.message : String(err)
            deps.send(IpcChannels.TaggerWriteEvent, {
              type: 'fileDone',
              filePath: edit.filePath,
              ok: false,
              error
            })
          }
        }

        deps.send(IpcChannels.TaggerWriteEvent, {
          type: 'done',
          totalWritten,
          totalFailed
        })

        return { totalWritten, totalFailed }
      } finally {
        isRunning = false
      }
    }
  }
}

// ─── Push sender ─────────────────────────────────────────────────────────────

/**
 * Build the main→renderer push sender for tagger write events.
 * Mirrors makeConversionSender from src/main/ipc/conversion.ts.
 *
 * The returned function is safe to call at any point — it no-ops when the
 * window has not yet been created or has been destroyed.
 */
export function makeTaggerWriteSender(
  getSender: () => WebContents | null
): (channel: string, payload: TagWriteEvent) => void {
  return (channel: string, payload: TagWriteEvent): void => {
    const wc = getSender()
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  }
}
