import { protocol } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { SettingsRepo } from '../db/settingsRepo'
import { AUDIO_EXTS } from '../workers/scanCore'

/**
 * Parse a single HTTP Range header value (RFC 7233) of the form
 * "bytes=start-end". Returns null when the header is malformed or
 * unsatisfiable, in which case the caller should serve the full file.
 */
export function parseRange(
  header: string | null,
  size: number
): { start: number; end: number } | null {
  if (header === null) return null
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (m === null) return null
  const startStr = m[1]
  const endStr = m[2]
  let start: number
  let end: number
  if (startStr === '' && endStr === '') return null
  if (startStr === '') {
    // Suffix range: last N bytes.
    const suffix = Number(endStr)
    if (!Number.isFinite(suffix) || suffix <= 0) return null
    start = Math.max(0, size - suffix)
    end = size - 1
  } else {
    start = Number(startStr)
    end = endStr === '' ? size - 1 : Number(endStr)
  }
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null
  if (start < 0 || end < start || start >= size) return null
  if (end >= size) end = size - 1
  return { start, end }
}

/**
 * Read only [start, end] (inclusive) of a file into a fresh standalone
 * Uint8Array. Uses a file handle + partial read so we never load the whole
 * file per request — the media element issues many Range requests during
 * playback and on every seek, and reading the entire file each time spiked
 * main-process memory until it crashed (white-screen renderer).
 *
 * `new Uint8Array(buf)` copies into a brand-new ArrayBuffer, so there is no
 * aliasing with Node's internal Buffer pool.
 */
async function readFileRange(
  abs: string,
  start: number,
  end: number
): Promise<Uint8Array> {
  const length = Math.max(0, end - start + 1)
  const fh = await fs.open(abs, 'r')
  try {
    const buf = Buffer.alloc(length)
    if (length > 0) {
      await fh.read(buf, 0, length, start)
    }
    return new Uint8Array(buf)
  } finally {
    await fh.close()
  }
}

/**
 * MIME type mapping for the AUDIO_EXTS allowlist. Chromium's <audio> element
 * requires a recognised audio Content-Type to actually decode and play the
 * stream — without it the resource loads silently. `net.fetch('file://...')`
 * does not always set a useful Content-Type, so we overwrite it explicitly
 * based on the file extension we already validated above.
 */
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.aiff': 'audio/aiff',
  '.aif': 'audio/aiff'
}

/**
 * Custom protocol scheme used by the Tagger preview <audio> element.
 *
 * URLs look like `cratekeeper://audio/<encoded-absolute-path>` so the
 * renderer never receives a raw `file://` URL (which would bypass CSP and
 * would not stream cleanly via a privileged-scheme handler).
 *
 * Pitfall 2 — the scheme MUST be registered via
 * `protocol.registerSchemesAsPrivileged(...)` BEFORE `app.whenReady()`. The
 * call lives in src/main/index.ts; this module owns the protocol.handle
 * registration which runs inside whenReady (it needs a settingsRepo).
 *
 * Threat mitigations:
 *   - T-4-01: path resolved + checked against settings.rootFolder before
 *     streaming; any path outside the allowlist returns 403.
 *   - T-4-02: extension allowlist (AUDIO_EXTS) gates the file; mismatches
 *     return 415.
 */

const ROOT_FOLDER_KEY = 'rootFolder'

export const AUDIO_PROTOCOL_SCHEME = 'cratekeeper'

export function registerAudioProtocol(settingsRepo: SettingsRepo): void {
  protocol.handle(AUDIO_PROTOCOL_SCHEME, async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'audio') {
      return new Response('Not Found', { status: 404 })
    }

    // Strip leading slash before decoding so paths starting with '/' (POSIX
    // absolute) survive the URL parser cleanly.
    const decoded = decodeURIComponent(url.pathname.replace(/^\//, ''))
    const abs = path.resolve(decoded)

    const root = settingsRepo.get(ROOT_FOLDER_KEY)
    if (root === null || abs === root || !abs.startsWith(root + path.sep)) {
      // T-4-01: never serve files outside settings.rootFolder.
      return new Response('Forbidden', { status: 403 })
    }

    const ext = path.extname(abs).toLowerCase()
    if (!(AUDIO_EXTS as readonly string[]).includes(ext)) {
      // T-4-02: extension allowlist defence-in-depth.
      return new Response('Unsupported Media Type', { status: 415 })
    }

    // Serve with explicit Content-Length + Range support, reading ONLY the
    // requested bytes (not the whole file) so repeated seeks / range requests
    // don't spike main-process memory.
    const mime = AUDIO_MIME[ext] ?? 'application/octet-stream'
    let size: number
    try {
      const stat = await fs.stat(abs)
      size = stat.size
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const range = parseRange(request.headers.get('Range'), size)
    try {
      if (range !== null) {
        const { start, end } = range
        const slice = await readFileRange(abs, start, end)
        return new Response(slice as BodyInit, {
          status: 206,
          statusText: 'Partial Content',
          headers: {
            'Content-Type': mime,
            'Content-Length': String(slice.byteLength),
            'Content-Range': `bytes ${start}-${end}/${size}`,
            'Accept-Ranges': 'bytes',
            // renderer fetch()es this URL cross-origin to decode the waveform.
            'Access-Control-Allow-Origin': '*',
            'Cache-Control': 'no-store'
          }
        })
      }

      const full = await readFileRange(abs, 0, size - 1)
      return new Response(full as BodyInit, {
        status: 200,
        headers: {
          'Content-Type': mime,
          'Content-Length': String(full.byteLength),
          'Accept-Ranges': 'bytes',
          // renderer fetch()es this URL cross-origin to decode the waveform.
          'Access-Control-Allow-Origin': '*',
          'Cache-Control': 'no-store'
        }
      })
    } catch {
      return new Response('Not Found', { status: 404 })
    }
  })
}
