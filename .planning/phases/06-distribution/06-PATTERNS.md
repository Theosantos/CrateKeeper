# Phase 6: Distribution - Pattern Map

**Mapped:** 2026-06-22
**Files analyzed:** 5 (2 new TypeScript modules, 1 new shell script, 1 new YAML config, 1 modified JSON)
**Analogs found:** 4 / 5 (electron-builder.yml has no prior analog in repo)

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `electron-builder.yml` | config | — | `package.json` scripts block + `build/` resources | config-match (no prior yaml config exists) |
| `scripts/prepare-universal-ffmpeg.sh` | utility/build | batch | `node_modules/better-sqlite3/deps/download.sh` (only real shell script in tree) | structural-only (none in project `scripts/`) |
| `src/main/update/updater.ts` | service | request-response | `src/main/tagger/audioProtocol.ts` + `src/main/conversion/ffmpegPath.ts` | role-match (same main-process module shape) |
| `src/main/index.ts` | config/wiring | request-response | itself (modify in place) | self-analog |
| `package.json` | config | — | itself (modify in place) | self-analog |

---

## Pattern Assignments

### `electron-builder.yml` (config)

**Analog:** `package.json` scripts block (existing `build:mac`, `build:win`, `build:linux`, `build:unpack`) + `build/` directory (icons, entitlements plist).

**Existing build script block** (`package.json` lines 24–27):
```json
"build:unpack": "npm run build && electron-builder --dir",
"build:win":   "npm run build && electron-builder --win",
"build:mac":   "electron-vite build && electron-builder --mac",
"build:linux": "electron-vite build && electron-builder --linux"
```
Note: `build:mac` already diverges from the others — it skips `npm run typecheck` (uses `electron-vite build` directly). The updated `build:mac` will prepend the ffmpeg script to this existing shape.

**Existing build resources** (`build/`):
- `build/icon.icns` — macOS icon
- `build/icon.ico` — Windows icon
- `build/icon.png` — fallback
- `build/entitlements.mac.plist` — already contains `com.apple.security.cs.allow-jit` + two allow flags for hardened runtime (NOT used in v1 unsigned build but file must stay for v2 signing)

**Complete `electron-builder.yml` to create** (no prior analog; copy verbatim from RESEARCH.md §Code Examples):
```yaml
appId: com.theosantos.cratekeeper
productName: CrateKeeper

directories:
  buildResources: build
  output: dist

files:
  - out/**/*
  - "!**/.DS_Store"

asarUnpack:
  - node_modules/ffmpeg-static/**
  - "**/*.node"

mac:
  icon: build/icon.icns
  entitlementsInherit: build/entitlements.mac.plist
  identity: null
  hardenedRuntime: false
  target:
    - target: dmg
      arch: universal

dmg:
  sign: false

win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false
  allowToChangeInstallationDirectory: false
  perMachine: false

publish:
  provider: github
  owner: Theosantos
  repo: CrateKeeper
  releaseType: release
```

**Key decisions baked into this config:**
- `identity: null` — silences signing search (D-01 unsigned)
- `hardenedRuntime: false` — required when `identity: null`
- `dmg.sign: false` — no DMG signing attempt
- `asarUnpack` lists both ffmpeg-static and `*.node` explicitly (belt-and-suspenders over auto-detection)
- `releaseType: release` (not `draft`) so electron-updater feed works (RESEARCH Pitfall 4)

---

### `scripts/prepare-universal-ffmpeg.sh` (utility, batch)

**Analog:** No project-level shell scripts exist in `scripts/` (directory does not exist yet). The only `.sh` files in the repo are in `node_modules/`. Pattern comes entirely from RESEARCH.md §Pattern 2, with the Pitfall 5 fix applied.

**Pitfall 5 fix (important):** The RESEARCH.md §Pattern 2 script copies the current machine's binary as `ffmpeg-arm64-orig` — this fails on Intel Mac. The safer approach (noted in RESEARCH.md §Pitfall 5) always downloads BOTH architectures from the release URL, ignoring the locally installed binary. The planner must use this revised version:

**Complete script to create:**
```bash
#!/usr/bin/env bash
# scripts/prepare-universal-ffmpeg.sh
# Downloads arm64 + x64 ffmpeg binaries from ffmpeg-static release b6.1.1
# and lipo-merges them into a fat Universal binary for electron-builder.
# Must run BEFORE electron-builder --mac --arch universal.
# Safe to run on any macOS machine (Apple Silicon or Intel).

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "prepare-universal-ffmpeg: not on macOS, skipping"
  exit 0
fi

RELEASE_TAG="b6.1.1"
BASE_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE_TAG}"
TARGET_DIR="node_modules/ffmpeg-static"
FFMPEG_FINAL="${TARGET_DIR}/ffmpeg"
FFMPEG_X64="${TARGET_DIR}/ffmpeg-x64-dl"
FFMPEG_ARM64="${TARGET_DIR}/ffmpeg-arm64-dl"

echo "Preparing universal (fat) ffmpeg binary for macOS Universal build..."

# Check if already fat (idempotent)
if lipo -info "${FFMPEG_FINAL}" 2>/dev/null | grep -q "arm64 x86_64"; then
  echo "ffmpeg is already a fat binary, skipping"
  exit 0
fi

# Always download both architectures from release (Pitfall 5: don't rely on current machine binary)
echo "Downloading ffmpeg-darwin-arm64..."
curl -fL "${BASE_URL}/ffmpeg-darwin-arm64.gz" | gunzip > "${FFMPEG_ARM64}"
chmod +x "${FFMPEG_ARM64}"

echo "Downloading ffmpeg-darwin-x64..."
curl -fL "${BASE_URL}/ffmpeg-darwin-x64.gz" | gunzip > "${FFMPEG_X64}"
chmod +x "${FFMPEG_X64}"

# Merge with lipo
echo "Merging arm64 + x64 into fat binary..."
lipo -create "${FFMPEG_ARM64}" "${FFMPEG_X64}" -output "${FFMPEG_FINAL}"
chmod +x "${FFMPEG_FINAL}"

# Cleanup intermediates
rm -f "${FFMPEG_X64}" "${FFMPEG_ARM64}"

echo "Done: $(lipo -info ${FFMPEG_FINAL})"
# Expected: Architectures in the fat file: node_modules/ffmpeg-static/ffmpeg are: arm64 x86_64
```

**Shell conventions** (from `node_modules/better-sqlite3/deps/download.sh` as structural reference):
- `#!/usr/bin/env bash` shebang
- `set -euo pipefail` at top
- Echo progress messages throughout
- Cleanup of temp files before exit

---

### `src/main/update/updater.ts` (service, request-response)

**Analog:** `src/main/conversion/ffmpegPath.ts` (pure exported function, no class, no singleton) + `src/main/tagger/audioProtocol.ts` (uses `app`, `shell` from electron; platform/packaged guards; exported named function called from index.ts).

**Import pattern** from `src/main/tagger/audioProtocol.ts` (lines 1–5):
```typescript
import { protocol } from 'electron'
import path from 'node:path'
import { promises as fs } from 'node:fs'
import type { SettingsRepo } from '../db/settingsRepo'
import { AUDIO_EXTS } from '../workers/scanCore'
```
Adapt for updater: import from `electron` (not `node:*`), no internal repo deps.

**Platform guard pattern** from `src/main/index.ts` (line 63):
```typescript
...(process.platform === 'linux' ? { icon } : {}),
```
And from `src/main/index.ts` (line 164):
```typescript
isPackaged: app.isPackaged
```
The updater uses both `app.isPackaged` AND `process.platform` to gate logic (only run in packaged builds; different logic per OS).

**`app.isPackaged` guard convention** (established in `src/main/conversion/ffmpegPath.ts` via the `isPackaged` injection pattern and referenced in `src/main/index.ts` line 197):
```typescript
resolveFfmpegPath({ rawPath: ffmpegStatic, isPackaged: app.isPackaged })
```
The updater must use the same guard inline: `if (!app.isPackaged || process.platform !== 'win32') return`.

**Error handling pattern** from `src/main/tagger/applyController.ts` (lines 94–103):
```typescript
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
```
For the updater: errors are caught silently (D-08 graceful degrade) with `console.error` only — no re-throw, no user-visible error.

**Export shape** — matches the project convention of exporting named functions (not classes, not default exports). From `src/main/tagger/audioProtocol.ts` (line 111):
```typescript
export function registerAudioProtocol(settingsRepo: SettingsRepo): void {
```
And `src/main/conversion/ffmpegPath.ts` (line 17):
```typescript
export function resolveFfmpegPath(opts: { rawPath: string; isPackaged: boolean }): string {
```
Updater exports two named functions: `initWindowsUpdater(): void` and `checkForUpdatesMacOS(): Promise<void>`.

**JSDoc header convention** from `src/main/conversion/ffmpegPath.ts` (lines 1–16): block comment at top of file explaining purpose, pitfall references, and pure/side-effect notes. Updater file should follow this pattern.

**Complete `src/main/update/updater.ts` to create** (copy from RESEARCH.md §Pattern 3 — already matches project conventions exactly):
```typescript
import { autoUpdater } from 'electron-updater'
import { app, dialog, shell } from 'electron'

const GITHUB_RELEASES_URL = 'https://github.com/Theosantos/CrateKeeper/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/Theosantos/CrateKeeper/releases/latest'

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

    const data = (await res.json()) as { tag_name: string }
    const latestTag = data.tag_name?.replace(/^v/, '') ?? ''
    const currentVersion = app.getVersion()

    if (latestTag && latestTag !== currentVersion) {
      const { response } = await dialog.showMessageBox({
        type: 'info',
        title: 'Mise à jour disponible',
        message: `CrateKeeper ${latestTag} est disponible (vous avez ${currentVersion}).`,
        detail: 'Téléchargez la nouvelle version depuis la page Releases.',
        buttons: ['Voir les Releases', 'Plus tard'],
        defaultId: 0,
      })
      if (response === 0) {
        shell.openExternal(GITHUB_RELEASES_URL)
      }
    }
  } catch {
    // D-08: network failure → silent, continue
  }
}
```

---

### `src/main/index.ts` (modify — wiring)

**Self-analog.** The modification adds two import lines and two call-sites inside `app.whenReady().then(async () => { ... })`.

**Wiring pattern** (from existing `src/main/index.ts` lines 108–219): every Phase-N feature is added as a block inside `app.whenReady()` with a comment block explaining what it does. New updater calls follow this exact convention.

**Import insertion point** — after the existing last import (line 33, `const ffmpegStatic = require('ffmpeg-static') as string`):
```typescript
import { initWindowsUpdater, checkForUpdatesMacOS } from './update/updater'
```

**Call-site insertion point** — after `mainWindow = createWindow()` (line 211), before the `app.on('activate', ...)` block:
```typescript
// Phase 6: auto-update (Windows) + version-check notify (macOS)
initWindowsUpdater()
checkForUpdatesMacOS() // fire-and-forget; errors handled internally (D-08)
```

**Existing `app.whenReady` structure reference** (`src/main/index.ts` lines 108–219):
```typescript
app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.cratekeeper.app')  // line 110
  // ...
  registerDialogHandlers()     // Phase handlers registered here
  registerSettingsHandlers()
  // ...
  mainWindow = createWindow()  // line 211
  app.on('activate', function () { ... })  // line 213
})
```
The updater calls go AFTER `createWindow()` (mainWindow must exist for dialogs to have a parent).

---

### `package.json` (modify — version, dependency, build script)

**Self-analog.** Three targeted edits to the existing file.

**Current state** (`package.json` lines 2, 8–27, 29–68):

Version (line 3):
```json
"version": "0.1.0",
```
Change to:
```json
"version": "1.0.0",
```

`build:mac` script (line 27):
```json
"build:mac": "electron-vite build && electron-builder --mac",
```
Change to:
```json
"build:mac": "bash scripts/prepare-universal-ffmpeg.sh && electron-vite build && electron-builder --mac --arch universal",
```

Dependencies block (lines 29–42) — add `electron-updater` as a production dep AFTER human-verify checkpoint:
```json
"dependencies": {
  "@electron-toolkit/preload": "^3.0.2",
  "@electron-toolkit/utils": "^4.0.0",
  "@fontsource-variable/bricolage-grotesque": "^5.2.10",
  "@tanstack/react-virtual": "^3.13.26",
  "better-sqlite3": "^12.10.0",
  "csv-stringify": "^6.7.0",
  "electron-updater": "^6.8.9",   // ADD THIS LINE
  "ffmpeg-static": "^5.3.0",
  "music-metadata": "^11.12.3",
  "node-id3": "^0.2.9",
  "readdirp": "^5.0.0",
  "zustand": "^5.0.14"
},
```
`electron-updater` MUST be in `dependencies` (production), NOT `devDependencies` — it runs inside the packaged app at runtime (RESEARCH anti-patterns).

---

## Shared Patterns

### `app.isPackaged` + `process.platform` Guard
**Source:** `src/main/index.ts` line 164 (`isPackaged: app.isPackaged`) + line 63 (`process.platform === 'linux'`)
**Apply to:** `src/main/update/updater.ts` — both exported functions gate on this combination
```typescript
if (!app.isPackaged || process.platform !== 'win32') return
// and
if (!app.isPackaged || process.platform !== 'darwin') return
```

### Named Export (no default, no class)
**Source:** `src/main/tagger/audioProtocol.ts` lines 109, 111 + `src/main/conversion/ffmpegPath.ts` line 17
**Apply to:** `src/main/update/updater.ts`
All main-process modules export named functions. No default exports, no class instances, no module-level singletons.

### Silent Error Handling for Non-Critical Operations
**Source:** `src/main/tagger/audioProtocol.ts` lines 141–143 (`} catch { return new Response('Not Found', ...) }`)
**Apply to:** `src/main/update/updater.ts` — `checkForUpdatesMacOS` catch block must be silent (empty catch or console.error only)
```typescript
} catch {
  // D-08: network failure → silent, continue
}
```

### JSDoc Block Comment at File Top
**Source:** `src/main/conversion/ffmpegPath.ts` lines 1–16 + `src/main/tagger/applyController.ts` lines 1–22
**Apply to:** `src/main/update/updater.ts` — add a block comment explaining purpose, D-06/D-07/D-08 decision refs, and platform-specific behaviour before the first import.

### `console.error` for Main-Process Diagnostics
**Source:** `src/main/index.ts` lines 82, 86 (`console.error('[main] renderer process gone: ...')`)
**Apply to:** `src/main/update/updater.ts` `autoUpdater.on('error', ...)` handler
```typescript
console.error('[updater] error:', err.message)
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `electron-builder.yml` | config | — | No electron-builder config file exists in the repo (config was always implied by the `build:*` scripts but never written). Planner must use RESEARCH.md §Pattern 1 / §Code Examples as the primary source. |

---

## Metadata

**Analog search scope:** `src/main/`, `build/`, `package.json`, `node_modules/` (shells only)
**Files scanned:** 7 source files read in full (index.ts, ffmpegPath.ts, audioProtocol.ts, applyController.ts, scan/controller.ts excerpt, build/entitlements.mac.plist, package.json)
**Pattern extraction date:** 2026-06-22
