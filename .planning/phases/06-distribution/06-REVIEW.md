---
phase: 06-distribution
reviewed: 2026-06-24T00:00:00Z
depth: standard
files_reviewed: 6
files_reviewed_list:
  - src/main/update/updater.ts
  - src/main/index.ts
  - scripts/prepare-universal-ffmpeg.sh
  - scripts/generate-icons.mjs
  - .github/workflows/release.yml
  - electron-builder.yml
findings:
  critical: 1
  warning: 6
  info: 5
  total: 12
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-06-24
**Depth:** standard
**Files Reviewed:** 6
**Status:** issues_found

## Summary

Reviewed the Phase 6 distribution surface: the cross-platform updater module
(`updater.ts`), main-process wiring (`index.ts`), the universal-ffmpeg
pre-build script, the icon-generation script, the GitHub Actions release
workflow, and the electron-builder config.

Overall the security posture is solid for an unsigned v1 build: the
`GITHUB_TOKEN` is mapped to `GH_TOKEN` via env and never echoed; the shell
script correctly uses `set -euo pipefail` and `curl -fL`, and `pipefail`
genuinely aborts the script when `curl` fails mid-pipe (verified). The
main-process security conventions (`contextIsolation: true`,
`nodeIntegration: false`, `sandbox: true`, external-link `openExternal`
handler) are intact and unchanged. The npm `--publish always` arg correctly
reaches `electron-builder` in both `build:win` and `build:mac` (verified that
npm forwards `-- args` to the last command of a `&&` chain).

The one real correctness defect is in the macOS update check: it compares
version strings with a raw `!==` inequality rather than a semver "is-newer"
comparison. This produces false "update available" prompts whenever the
installed version is not byte-for-byte equal to the latest *non-prerelease*
release tag — including the common case where the user runs a build that is
*ahead* of the latest stable release. The remaining items are robustness and
maintainability concerns, none of which block the app from running (the
graceful-degrade requirement D-08 is met — failures are swallowed).

## Critical Issues

### CR-01: macOS update check uses string inequality, not semver — false "update available" prompts

**File:** `src/main/update/updater.ts:68-72`
**Issue:** The "is there a newer version?" decision is a raw string comparison:

```ts
const latestTag = data.tag_name?.replace(/^v/, '') ?? ''
const currentVersion = app.getVersion()
if (latestTag && latestTag !== currentVersion) { /* show update dialog */ }
```

`!==` only answers "are these two strings different?", not "is the remote
version newer?". Two concrete failure modes, both of which fire a misleading
"Mise à jour disponible" dialog at every launch:

1. **Local build ahead of latest release.** The maintainer is on a Mac and
   `package.json` is already bumped to `1.0.0` (it is). If the latest *stable*
   GitHub release is still `0.9.0`, or if the running build is a notarized
   release candidate ahead of the published tag, `latestTag !== currentVersion`
   is true and the user is told to "downgrade" to an older Releases page. The
   GitHub `/releases/latest` endpoint also explicitly excludes prereleases and
   drafts, so a prerelease user is *always* told a (lower) stable version is
   "available".
2. **Cosmetic tag drift.** Any difference in formatting — e.g. the release is
   tagged `v1.0` while `app.getVersion()` is `1.0.0`, or a `+build` metadata
   suffix — trips the inequality even though the versions are semantically
   equal.

This is shipped behavior that runs on every macOS launch (`app.isPackaged &&
darwin`), so every macOS user is affected. The fix is to compare semantically
and only prompt when the remote is strictly greater.

**Fix:**
```ts
// Compare numeric version segments; only prompt when remote is strictly newer.
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

const latestTag = data.tag_name?.replace(/^v/, '') ?? ''
if (latestTag && isNewer(latestTag, app.getVersion())) {
  // ...show dialog
}
```
(Prefer the already-bundled `semver` — it is a transitive dep of
`electron-updater` — via `semver.gt(latestTag, currentVersion)` if you'd rather
not hand-roll the comparison.)

## Warnings

### WR-01: `dialog.showMessageBox(...).then(...)` has no `.catch` — unhandled rejection on the update-downloaded path

**File:** `src/main/update/updater.ts:37-49`
**Issue:** The Windows `update-downloaded` handler chains `.then()` on
`showMessageBox` but never attaches a `.catch()`. If the dialog promise rejects
(e.g. the window is destroyed mid-prompt, or a platform dialog error), it
surfaces as an unhandled promise rejection inside an event listener. That
violates the D-08 "any failure must never block/crash the app" contract for the
exact code path that handles updates. Note the file is otherwise careful to
`.catch()` `checkForUpdatesAndNotify()` (line 52), so this omission is
inconsistent.
**Fix:**
```ts
.then(({ response }) => {
  if (response === 0) autoUpdater.quitAndInstall()
})
.catch((err) => console.error('[updater] dialog error:', err))
```

### WR-02: `shell.openExternal(...)` result is discarded — unhandled rejection if the browser launch fails

**File:** `src/main/update/updater.ts:82`
**Issue:** `shell.openExternal` returns a `Promise<void>` that can reject (no
handler for the URL scheme, sandboxed environment, etc.). The result is dropped,
so a rejection becomes an unhandled promise rejection. Same D-08 concern as
WR-01.
**Fix:**
```ts
void shell.openExternal(GITHUB_RELEASES_URL).catch((err) =>
  console.error('[updater] openExternal failed:', err)
)
```

### WR-03: `res.json()` result is type-asserted, not validated — trusts external GitHub response shape

**File:** `src/main/update/updater.ts:68-69`
**Issue:** `const data = (await res.json()) as { tag_name: string }` asserts the
shape of an untrusted external API response without validation. The project's
own coding rules ("Never trust external data (API responses…)"; prefer `unknown`
+ narrowing over `as`) call for narrowing here. While `data.tag_name?.` does
guard against a missing field, the blanket `as` would also silently accept a
non-object body (e.g. a `{ message, documentation_url }` rate-limit JSON, which
GitHub returns with HTTP 403 — already filtered by `res.ok`, but 200-with-
unexpected-shape is still possible). Narrow explicitly so the contract is
enforced rather than asserted.
**Fix:**
```ts
const data: unknown = await res.json()
const tagName =
  typeof data === 'object' && data !== null && 'tag_name' in data
    ? String((data as { tag_name: unknown }).tag_name)
    : ''
const latestTag = tagName.replace(/^v/, '')
```

### WR-04: `if-no-files-found: ignore` silently masks a failed/empty build on publish runs

**File:** `.github/workflows/release.yml:71`
**Issue:** The artifact-upload step uses `if-no-files-found: ignore`, so if
`electron-builder` produced no `.dmg`/`.exe`/`.yml` (build failed to emit, wrong
output dir, signing abort), the workflow step succeeds green with zero
artifacts and no warning. On a tag-push release that means a "successful"
release run that published nothing. For a release pipeline whose entire purpose
is producing installers, the absence of an installer should be loud, not
silent — at minimum `warn`, ideally `error` for the upload safety net.
**Fix:**
```yaml
if-no-files-found: warn   # or 'error' to fail the run when nothing was built
```

### WR-05: No `concurrency` guard — overlapping tag pushes can double-publish to the same Release

**File:** `.github/workflows/release.yml:14-27`
**Issue:** The workflow triggers on `push: tags: v*` and `workflow_dispatch`
with `contents: write` and `--publish always`. With no `concurrency` group, two
near-simultaneous tag pushes (or a re-run while the first is in flight) run in
parallel and both call `electron-builder --publish always` against the same
GitHub Release, racing on asset upload / `latest.yml` overwrite. That can yield
a Release with mismatched `latest.yml` vs. installer (which then breaks the
Windows auto-update feed). Add a concurrency group keyed to the ref.
**Fix:**
```yaml
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

### WR-06: `build:mac` skips typecheck (and the native-rebuild prebuild hook) that `build:win` runs

**File:** `.github/workflows/release.yml:50-61` (driven by `package.json` `build:mac`)
**Issue:** The release matrix runs `npm run build:${platform}`. `build:win` is
`npm run build && electron-builder --win`, where `npm run build` runs
`typecheck` and fires the `prebuild` → `rebuild:electron` hook. `build:mac` is
`prepare-universal-ffmpeg.sh && electron-vite build && electron-builder --mac
--universal` — it bypasses `npm run build`, so the macOS release path **does not
typecheck** and does not run the `prebuild` native-rebuild hook. A type error
that would block the Windows installer would still ship in the macOS `.dmg`.
This asymmetry means the two platforms are not built to the same quality gate.
(`postinstall: electron-builder install-app-deps` covers native ABI for
packaging, so the rebuild gap is lower-risk than the missing typecheck.)
**Fix:** Run a typecheck step explicitly in the workflow before the build, or
align `build:mac` to invoke the shared `npm run build`:
```yaml
- name: Typecheck
  run: npm run typecheck
```
or change `build:mac` to
`"... && npm run build && electron-builder --mac --universal"`.

## Info

### IN-01: Repo owner/name is hardcoded and duplicated across four files — drift risk

**File:** `src/main/update/updater.ts:22-23` (also `electron-builder.yml:48-50`, `package.json` repository/homepage)
**Issue:** `Theosantos/CrateKeeper` appears as literal strings in the releases
URL, the API URL, the electron-builder `publish` block, and `package.json`.
They currently agree, but a repo rename/transfer requires editing four places;
a miss silently breaks the macOS update check (wrong API URL → 404 → swallowed,
so no user-visible error, just a permanently-silent updater). Consider deriving
the macOS URLs from `package.json` `repository.url` at build time, or at least
co-locating the constant.
**Fix:** Extract owner/repo to a single shared constant (or read from the
parsed `repository` field) consumed by `updater.ts`.

### IN-02: Magic number for the network timeout

**File:** `src/main/update/updater.ts:64`
**Issue:** `AbortSignal.timeout(5_000)` embeds a magic literal. Per the project
coding rules ("Use named constants for meaningful thresholds, delays, and
limits").
**Fix:** `const UPDATE_CHECK_TIMEOUT_MS = 5_000` at module scope.

### IN-03: Production `console.error` in the updater module

**File:** `src/main/update/updater.ts:34` (and `index.ts:83,87`)
**Issue:** The project rules ("No `console.log`/debug statements in production
code", "use proper logging libraries") flag raw `console.*`. The updater logs
errors via `console.error`. This is consistent with the existing `index.ts`
convention (which uses `eslint-disable no-console` comments), so it is a
pre-existing pattern, not new — but the new `updater.ts` lines lack the
`eslint-disable` comments the rest of the main process uses, so they may trip
lint. Flagged as Info for consistency, not correctness.
**Fix:** Route through the main-process logger if one exists, or add the
matching `// eslint-disable-next-line no-console` to stay consistent with
`index.ts`.

### IN-04: `generate-icons.mjs` does not validate that `build/icon.svg` exists before reading

**File:** `scripts/generate-icons.mjs:24,34`
**Issue:** `render()` calls `readFileSync(svg)` with no existence check; if
`build/icon.svg` is missing the failure is a raw `ENOENT` stack rather than a
clear "source icon not found" message. Low impact (dev-only script, fails
loudly either way), but a one-line guard improves DX.
**Fix:**
```js
import { existsSync } from 'node:fs'
if (!existsSync(svg)) {
  console.error(`Source icon not found: ${svg}`)
  process.exit(1)
}
```

### IN-05: macOS update dialog has no parent window — detached modal

**File:** `src/main/update/updater.ts:73-80`
**Issue:** `dialog.showMessageBox({...})` is called without a `BrowserWindow`
parent. On macOS the result is an app-modal (not window-modal) dialog that can
appear detached from the main window, and it fires from `checkForUpdatesMacOS()`
during `whenReady` regardless of whether the window has finished showing. Not a
bug (the call is intentionally fire-and-forget and the window is created just
before, per `index.ts:212-218`), but passing the parent window yields a
sheet-style, properly-attached dialog.
**Fix:** Thread the `mainWindow` into the call:
`dialog.showMessageBox(mainWindow, {...})`.

---

_Reviewed: 2026-06-24_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
