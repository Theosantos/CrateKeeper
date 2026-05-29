import { afterEach, describe, expect, it } from 'vitest'
import { promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ScannedFile } from '../../shared/ipc-types'
import { CSV_COLUMNS, streamCsv } from './csvExport'

/**
 * Tiny RFC 4180 CSV parser — supports doubled-quote escaping inside quoted
 * fields, embedded commas, and embedded LF/CRLF inside quoted fields.
 * Sufficient for round-trip assertions against csv-stringify's known output.
 */
function parseCsv(input: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let inQuotes = false
  let i = 0
  while (i < input.length) {
    const c = input[i]
    if (inQuotes) {
      if (c === '"') {
        if (input[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i += 1
        continue
      }
      field += c
      i += 1
      continue
    }
    if (c === '"') {
      inQuotes = true
      i += 1
      continue
    }
    if (c === ',') {
      row.push(field)
      field = ''
      i += 1
      continue
    }
    if (c === '\r') {
      // swallow; \n handles end-of-row
      i += 1
      continue
    }
    if (c === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i += 1
      continue
    }
    field += c
    i += 1
  }
  // Final field/row if no trailing newline
  if (field.length > 0 || row.length > 0) {
    row.push(field)
    rows.push(row)
  }
  return rows
}

function makeRow(overrides: Partial<ScannedFile> = {}): ScannedFile {
  return {
    path: '/music/track.mp3',
    format: 'mp3',
    bitrate: 320,
    sizeBytes: 1_000_000,
    sampleRate: 44_100,
    durationSeconds: 200,
    hasGenre: true,
    hasBpm: false,
    hasKey: true,
    parsedOk: true,
    errorMessage: null,
    ...overrides
  }
}

const tempPaths: string[] = []

function tempCsvPath(): string {
  const p = path.join(tmpdir(), `dj-utils-csv-${randomUUID()}.csv`)
  tempPaths.push(p)
  return p
}

afterEach(async () => {
  while (tempPaths.length > 0) {
    const p = tempPaths.pop()!
    try {
      await fs.unlink(p)
    } catch {
      // ignore
    }
  }
})

describe('streamCsv', () => {
  it('writes a header-only CSV for an empty iterator', async () => {
    const target = tempCsvPath()
    await streamCsv([], target)
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed.length).toBe(1)
    expect(parsed[0]).toEqual([...CSV_COLUMNS])
  })

  it('writes header + N data rows preserving column order', async () => {
    const target = tempCsvPath()
    const rows: ScannedFile[] = [
      makeRow({ path: '/a.mp3', format: 'mp3' }),
      makeRow({ path: '/b.flac', format: 'flac', bitrate: null }),
      makeRow({ path: '/c.m4a', format: 'm4a', parsedOk: false, errorMessage: 'bad atoms' })
    ]
    await streamCsv(rows, target)
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed.length).toBe(4)
    expect(parsed[0]).toEqual([...CSV_COLUMNS])
    expect(parsed[1][CSV_COLUMNS.indexOf('path')]).toBe('/a.mp3')
    expect(parsed[2][CSV_COLUMNS.indexOf('format')]).toBe('flac')
    expect(parsed[2][CSV_COLUMNS.indexOf('bitrate')]).toBe('')
    expect(parsed[3][CSV_COLUMNS.indexOf('parsedOk')]).toBe('false')
    expect(parsed[3][CSV_COLUMNS.indexOf('errorMessage')]).toBe('bad atoms')
  })

  it('escapes paths containing a comma so they round-trip as a single field', async () => {
    const target = tempCsvPath()
    const tricky = '/Music/Artist, Band/Song.mp3'
    await streamCsv([makeRow({ path: tricky })], target)
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed.length).toBe(2)
    expect(parsed[1][CSV_COLUMNS.indexOf('path')]).toBe(tricky)
  })

  it('escapes double-quote inside a path (doubled-quote per RFC 4180)', async () => {
    const target = tempCsvPath()
    const tricky = '/Music/Said "Hi"/x.mp3'
    await streamCsv([makeRow({ path: tricky })], target)
    const content = await fs.readFile(target, 'utf8')
    // raw content should contain the doubled-quote marker
    expect(content).toContain('""Hi""')
    const parsed = parseCsv(content)
    expect(parsed[1][CSV_COLUMNS.indexOf('path')]).toBe(tricky)
  })

  it('preserves an embedded newline inside a quoted field', async () => {
    const target = tempCsvPath()
    const tricky = '/Music/Multi\nLine/x.mp3'
    await streamCsv([makeRow({ path: tricky })], target)
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed.length).toBe(2)
    expect(parsed[1][CSV_COLUMNS.indexOf('path')]).toBe(tricky)
  })

  it("emits booleans as 'true' / 'false' (stable, spreadsheet-readable)", async () => {
    const target = tempCsvPath()
    await streamCsv(
      [
        makeRow({ hasGenre: true, hasBpm: true, hasKey: true, parsedOk: true }),
        makeRow({ hasGenre: false, hasBpm: false, hasKey: false, parsedOk: false })
      ],
      target
    )
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed[1][CSV_COLUMNS.indexOf('hasGenre')]).toBe('true')
    expect(parsed[1][CSV_COLUMNS.indexOf('parsedOk')]).toBe('true')
    expect(parsed[2][CSV_COLUMNS.indexOf('hasGenre')]).toBe('false')
    expect(parsed[2][CSV_COLUMNS.indexOf('parsedOk')]).toBe('false')
  })

  it('emits errorMessage on parsedOk=false rows', async () => {
    const target = tempCsvPath()
    await streamCsv(
      [makeRow({ parsedOk: false, errorMessage: 'EACCES /private/track.mp3' })],
      target
    )
    const content = await fs.readFile(target, 'utf8')
    const parsed = parseCsv(content)
    expect(parsed[1][CSV_COLUMNS.indexOf('parsedOk')]).toBe('false')
    expect(parsed[1][CSV_COLUMNS.indexOf('errorMessage')]).toBe('EACCES /private/track.mp3')
  })

  it('handles 5000 rows from an iterator without buffering everything in one string', async () => {
    const target = tempCsvPath()
    const N = 5000

    function* gen(): IterableIterator<ScannedFile> {
      for (let i = 0; i < N; i++) {
        yield makeRow({ path: `/music/track-${i}.mp3` })
      }
    }

    await streamCsv(gen(), target)
    const stat = await fs.stat(target)
    // Header row + N data rows; lower-bound sanity check (each row > 40 bytes).
    expect(stat.size).toBeGreaterThan(N * 40)
    // Confirm row count by counting newlines (each row terminated by LF).
    const content = await fs.readFile(target, 'utf8')
    const lineCount = content.split('\n').filter((l) => l.length > 0).length
    expect(lineCount).toBe(N + 1)
  })
})
