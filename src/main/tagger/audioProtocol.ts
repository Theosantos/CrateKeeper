import { protocol } from 'electron'
import path from 'node:path'
import { promises as fs, createReadStream } from 'node:fs'
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
 * Stream a Node fs ReadStream as a Web ReadableStream so it can be the
 * body of a Response. Errors propagate to the controller; close cleans up.
 */
function fileRangeStream(abs: string, start: number, end: number): ReadableStream<Uint8Array> {
  const nodeStream = createReadStream(abs, { start, end })
  return new ReadableStream<Uint8Array>({
    start(controller) {
      nodeStream.on('data', (chunk: string | Buffer) => {
        const buf =
          typeof chunk === 'string'
            ? new TextEncoder().encode(chunk)
            : new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength)
        controller.enqueue(buf)
      })
      nodeStream.on('end', () => controller.close())
      nodeStream.on('error', (err) => controller.error(err))
    },
    cancel() {
      nodeStream.destroy()
    }
  })
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

    // Serve the file ourselves with explicit Content-Length + Range support.
    // net.fetch('file://...') does not surface a usable Content-Length and
    // does not honour Range requests, which broke <audio> seek (seeking
    // snapped back to 0 because the buffered range stayed at 0).
    const mime = AUDIO_MIME[ext] ?? 'application/octet-stream'
    let size: number
    try {
      const stat = await fs.stat(abs)
      size = stat.size
    } catch {
      return new Response('Not Found', { status: 404 })
    }

    const range = parseRange(request.headers.get('Range'), size)
    if (range !== null) {
      const { start, end } = range
      const length = end - start + 1
      return new Response(fileRangeStream(abs, start, end), {
        status: 206,
        statusText: 'Partial Content',
        headers: {
          'Content-Type': mime,
          'Content-Length': String(length),
          'Content-Range': `bytes ${start}-${end}/${size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': 'no-store'
        }
      })
    }

    return new Response(fileRangeStream(abs, 0, Math.max(0, size - 1)), {
      status: 200,
      headers: {
        'Content-Type': mime,
        'Content-Length': String(size),
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-store'
      }
    })
  })
}
