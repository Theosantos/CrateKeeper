import { protocol, net } from 'electron'
import path from 'node:path'
import type { SettingsRepo } from '../db/settingsRepo'
import { AUDIO_EXTS } from '../workers/scanCore'

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

    return net.fetch('file://' + abs)
  })
}
