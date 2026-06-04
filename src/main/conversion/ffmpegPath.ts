import path from 'node:path'

/**
 * Resolve the ffmpeg-static binary path, rewriting the asar archive prefix to
 * its `app.asar.unpacked` counterpart in packaged builds. electron-builder
 * must include `asarUnpack: ["**\/node_modules/ffmpeg-static/**"]` in its
 * config (Phase 6 finalizes that file; this helper makes the runtime correct
 * regardless).
 *
 * Pure & synchronous — no fs touches, no process.* reads. Inject `isPackaged`
 * from `app.isPackaged` at the call site (controller construction in main).
 *
 * RESEARCH Pitfall 1: `require('ffmpeg-static')` returns a path inside
 * `app.asar` in production; ffmpeg cannot execve from within an asar archive,
 * so the path must be rewritten to `app.asar.unpacked` at runtime.
 */
export function resolveFfmpegPath(opts: {
  rawPath: string
  isPackaged: boolean
}): string {
  if (!opts.isPackaged) {
    return opts.rawPath
  }
  // Use platform-aware separator (path.sep) so the rewrite works on both
  // POSIX (`/app.asar/`) and Windows (`\app.asar\`) layouts.
  const sep = path.sep
  return opts.rawPath.split(`${sep}app.asar${sep}`).join(`${sep}app.asar.unpacked${sep}`)
}
