/**
 * Cross-platform update surface for the packaged app.
 *
 * - Windows (D-06): electron-updater drives the NSIS auto-update feed
 *   (works on unsigned builds). Downloads in the background, then offers a
 *   restart-to-install dialog.
 * - macOS (D-07): notify-only. No Squirrel.Mac (which would require signing);
 *   instead a lightweight GitHub-API check nudges the user to the Releases
 *   page when a newer tag exists.
 * - Both (D-08): graceful degrade. Any failure (offline, rate limit, no
 *   newer release) must NEVER block or crash the app — errors are logged or
 *   swallowed, the app continues normally.
 *
 * Both functions are no-ops in dev and off-platform (`app.isPackaged` +
 * `process.platform` guards), matching the project's named-export, no-class
 * main-process module convention (cf. conversion/ffmpegPath.ts,
 * tagger/audioProtocol.ts).
 */
import { autoUpdater } from 'electron-updater'
import { app, dialog, shell } from 'electron'

const GITHUB_RELEASES_URL = 'https://github.com/Theosantos/CrateKeeper/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/Theosantos/CrateKeeper/releases/latest'

/**
 * True only when `remote` is a strictly newer semver than `local`. Compares
 * numeric segments (build/prerelease suffix ignored) so we never prompt a
 * "downgrade" when the running build is ahead of the latest stable tag, and so
 * cosmetic formatting (v1.0 vs 1.0.0) doesn't trip a false update.
 */
function isNewer(remote: string, local: string): boolean {
  const r = remote.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  const l = local.split('-')[0].split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const a = r[i] ?? 0
    const b = l[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

/** Wire Windows auto-update (NSIS). No-op outside packaged builds. */
export function initWindowsUpdater(): void {
  if (!app.isPackaged || process.platform !== 'win32') return

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => {
    // D-08: graceful degrade — log but never block the app
    console.error('[updater] error:', err.message)
  })

  autoUpdater.on('update-downloaded', () => {
    dialog
      .showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: 'Une nouvelle version de CrateKeeper est prête. Redémarrer maintenant ?',
        buttons: ['Redémarrer', 'Plus tard'],
        defaultId: 0,
      })
      .then(({ response }) => {
        if (response === 0) autoUpdater.quitAndInstall()
      })
      // D-08: a dialog failure must never surface as an unhandled rejection
      .catch((err) => console.error('[updater] update-downloaded dialog error:', err?.message))
  })

  // Fire-and-forget — error event handles failures
  autoUpdater.checkForUpdatesAndNotify().catch(() => {
    /* already handled by 'error' event */
  })
}

/** macOS: notify-only version check via GitHub API (D-07). No Squirrel.Mac. */
export async function checkForUpdatesMacOS(): Promise<void> {
  if (!app.isPackaged || process.platform !== 'darwin') return

  try {
    const res = await fetch(LATEST_RELEASE_API, {
      headers: { 'User-Agent': `CrateKeeper/${app.getVersion()}` },
      signal: AbortSignal.timeout(5_000), // D-08: don't block on slow network
    })
    if (!res.ok) return

    // Never trust the external response shape — narrow instead of asserting.
    const data: unknown = await res.json()
    const tagName =
      typeof data === 'object' && data !== null && 'tag_name' in data
        ? String((data as { tag_name: unknown }).tag_name)
        : ''
    const latestTag = tagName.replace(/^v/, '')
    const currentVersion = app.getVersion()

    if (latestTag && isNewer(latestTag, currentVersion)) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: `CrateKeeper ${latestTag} est disponible (vous avez ${currentVersion}).`,
        detail: 'Téléchargez la nouvelle version depuis la page Releases.',
        buttons: ['Voir les Releases', 'Plus tard'],
        defaultId: 0,
      })
      if (response === 0) {
        // D-08: openExternal can reject; swallow it like the rest of the check.
        void shell.openExternal(GITHUB_RELEASES_URL).catch((err) =>
          console.error('[updater] openExternal failed:', err?.message)
        )
      }
    }
  } catch {
    // D-08: network failure → silent, continue
  }
}
