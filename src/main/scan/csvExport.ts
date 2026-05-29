import { createWriteStream } from 'node:fs'
import { stringify } from 'csv-stringify'
import type { ScannedFile } from '../../shared/ipc-types'

/**
 * Locked column set + order — public contract for downstream tooling.
 * Any change here is a breaking change to the exported CSV format.
 */
export const CSV_COLUMNS = [
  'path',
  'format',
  'bitrate',
  'sizeBytes',
  'sampleRate',
  'durationSeconds',
  'hasGenre',
  'hasBpm',
  'hasKey',
  'parsedOk',
  'errorMessage'
] as const

export type CsvColumn = (typeof CSV_COLUMNS)[number]

/**
 * Stream a ScannedFile iterator to a CSV file at `savePath`.
 *
 * Pipes `csv-stringify` into `fs.createWriteStream`, then iterates the source
 * one row at a time. Constant memory regardless of row count — RESEARCH 02
 * Pitfall 7 (CSV memory blowup) mitigation. Never use `stringify.sync`.
 *
 * - RFC 4180 escaping handled by csv-stringify (commas, doubled-quotes, newlines).
 * - Booleans cast to 'true' / 'false' for spreadsheet readability (stable contract).
 *
 * Accepts a synchronous Iterable (better-sqlite3 12 `stmt.iterate()` is sync) and
 * an AsyncIterable for flexibility.
 */
export async function streamCsv(
  rowsIter: Iterable<ScannedFile> | AsyncIterable<ScannedFile>,
  savePath: string
): Promise<void> {
  const out = createWriteStream(savePath)
  const stringifier = stringify({
    header: true,
    columns: CSV_COLUMNS as unknown as string[],
    cast: {
      boolean: (v: boolean) => (v ? 'true' : 'false')
    }
  })

  return new Promise<void>((resolve, reject) => {
    let settled = false
    const fail = (err: Error): void => {
      if (settled) return
      settled = true
      reject(err)
    }
    const done = (): void => {
      if (settled) return
      settled = true
      resolve()
    }

    stringifier.on('error', fail)
    out.on('error', fail)
    out.on('finish', done)

    stringifier.pipe(out)
    // Drive the iterator. Wrapped in an async IIFE so we can `await` async iterables.
    ;(async () => {
      try {
        for await (const row of rowsIter as AsyncIterable<ScannedFile>) {
          // Respect backpressure: pause on a falsy write until 'drain'.
          if (!stringifier.write(row)) {
            await new Promise<void>((res) => stringifier.once('drain', () => res()))
          }
        }
        stringifier.end()
      } catch (err) {
        fail(err instanceof Error ? err : new Error(String(err)))
      }
    })()
  })
}
