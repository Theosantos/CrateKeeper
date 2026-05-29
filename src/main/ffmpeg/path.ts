import { app } from 'electron'
import ffmpegStatic from 'ffmpeg-static'

/**
 * Resolve the path to the bundled ffmpeg binary.
 *
 * In a packaged Electron app, native binaries inside `app.asar` cannot be
 * executed (asar archives are read-only and inaccessible to spawn). The
 * electron-builder.yml `asarUnpack` entry copies the binary into
 * `app.asar.unpacked/` at packaging time; this helper rewrites the resolved
 * path accordingly when running packaged (project pitfall — RESEARCH Pattern 4).
 *
 * Wired now in Phase 1 (used in Phase 3 conversion pipeline).
 */
export function resolveFfmpegPath(): string {
  const resolved = ffmpegStatic as unknown as string | null
  if (!resolved) {
    throw new Error('ffmpeg-static did not resolve a binary path on this platform')
  }
  return app.isPackaged ? resolved.replace('app.asar', 'app.asar.unpacked') : resolved
}
