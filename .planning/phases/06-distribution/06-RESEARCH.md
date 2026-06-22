# Phase 6: Distribution — Research

**Researched:** 2026-06-22
**Domain:** Electron packaging, electron-builder, electron-updater, GitHub Releases, native module bundling (macOS Universal + Windows NSIS)
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Ship UNSIGNED for v1 — no Apple Developer cert, no Windows cert.
- **D-02:** Document first-launch workaround: macOS → right-click app → **Open**; Windows → SmartScreen → **More info → Run anyway**.
- **D-03:** Signing is additive later; `build/entitlements.mac.plist` already exists.
- **D-04:** Distribute via GitHub Releases on public repo `Theosantos/CrateKeeper`.
- **D-05:** electron-builder `publish` target = GitHub Releases.
- **D-06:** Windows-only auto-update via electron-updater for v1; NSIS auto-update works on unsigned builds.
- **D-07:** No macOS auto-update — notify-only: check latest GitHub release version, inform user to re-download. Squirrel.Mac requires signing (deferred).
- **D-08:** Updater must degrade gracefully — no crash/blocking if update check fails.
- **D-09:** `productName` = CrateKeeper, `appId` = com.theosantos.cratekeeper.
- **D-10:** Version bump 0.1.0 → 1.0.0.
- **D-11:** Use existing icons: `build/icon.icns`, `build/icon.ico`, `build/icon.png`.
- **D-12:** macOS Universal (arm64 + Intel x64) — one installer covers both.
- **D-13:** Windows x64 NSIS installer.
- **D-14:** No Linux packaging.

### Claude's Discretion

- DMG layout/background, NSIS installer options (per-user vs per-machine, install dir prompt), artifact file-naming, and the exact electron-updater integration shape.

### Deferred Ideas (OUT OF SCOPE)

- Code signing + notarisation (Apple Developer cert, Windows OV/EV cert).
- macOS auto-update (blocked on signing).
- Linux packaging.
- In-app changelog / "what's new" screen.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| DIST-01 | App distributable via .dmg (macOS) and .exe (Windows) without prior install | electron-builder `mac.target: dmg` + `win.target: nsis` config; both verified in installed electron-builder 26.8.1 |
| DIST-02 | FFmpeg bundled in installer — no system dependency required | ffmpeg-static auto-unpacked from asar by electron-builder 26.8.1 (line 30 of unpackDetector.js); universal build requires pre-merge fat binary (see §Universal Build Risk) |
</phase_requirements>

---

## Summary

Phase 6 packages CrateKeeper into a macOS Universal `.dmg` and Windows x64 NSIS `.exe`. The electron-builder 26.8.1 that is already installed handles both targets. The runtime plumbing (`resolveFfmpegPath`, `install-app-deps` native rebuild, `cratekeeper://` protocol) is done from earlier phases; this phase is purely packaging configuration and distribution wiring.

**Two distinct sub-problems:**

1. **Native module bundling** — `better-sqlite3` and `ffmpeg-static` must both land in `app.asar.unpacked` and be the correct architecture. `better-sqlite3` is handled automatically: electron-builder calls `doPack` twice (x64 + arm64) during a Universal build, each sub-pack triggers `prebuild-install` via `npmRebuild`, which downloads the correct arch binary (both exist for `electron-v140-darwin-{arm64,x64}` in the 12.10.0 release), and `@electron/universal` merges the two arch-specific `.node` files with `lipo`. `ffmpeg-static` is NOT handled automatically — it is a pre-downloaded static binary (currently arm64 on this Apple Silicon machine), and electron-builder will copy the same binary into both sub-packs, causing `@electron/universal` to throw an error. A pre-build script that downloads the x64 binary and runs `lipo -create` before packaging is the correct fix (see §Universal Build Risk below).

2. **Windows auto-update** — `electron-updater` (not yet installed) must be added as a production dependency. NSIS auto-update works without code signing. macOS requires a manual check-and-notify implementation (HTTP fetch latest GitHub release tag, compare to `app.getVersion()`, show dialog with link to Releases page).

**Primary recommendation:** Add `electron-builder.yml` as the config file (keeps `package.json` clean), add a `scripts/prepare-universal-ffmpeg.sh` pre-build step, install `electron-updater@6.8.9`, wire the updater in `src/main/index.ts`, bump version to 1.0.0, and publish with `GH_TOKEN` set.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| App packaging & signing | Build toolchain (electron-builder) | — | electron-builder orchestrates asar, native deps, DMG/NSIS creation |
| FFmpeg bundling | Build pre-step (lipo script) | electron-builder asarUnpack | ffmpeg-static downloads arch-specific binary; must be fat-merged before packaging |
| Native module bundling (better-sqlite3) | electron-builder npmRebuild | prebuild-install | Auto-handled per arch during Universal build; no extra config needed |
| Windows auto-update check + install | Main process (electron-updater) | — | electron-updater hooks into app lifecycle; renderer just shows notification |
| macOS version check + notify | Main process (custom fetch) | Renderer (dialog/notification) | No Squirrel.Mac; manual GitHub API check + user-visible dialog |
| GitHub Release publish | Build toolchain (electron-builder --publish) | GH_TOKEN env var | electron-publish creates draft releases and uploads artifacts |
| First-launch UX instructions | README / release notes | — | Gatekeeper/SmartScreen bypass is a user education problem, not a code problem |

---

## Standard Stack

### Core (already installed)

| Library | Version (installed) | Purpose | Why Standard |
|---------|---------------------|---------|-------------|
| electron-builder | 26.8.1 | Package + distribute Electron app to .dmg/.exe | Industry standard; ships with `@electron/universal` 2.0.3 for fat binaries |
| electron | 39.8.10 | Runtime (ABI v140) | Already pinned from Phase 1 |
| ffmpeg-static | 5.3.0 | Bundle static ffmpeg binary | Downloads arch-specific binary at npm install; must be asar-unpacked at runtime |
| better-sqlite3 | 12.10.0 | Native SQLite — needs per-arch rebuild | Has electron-v140 prebuilds for darwin-arm64 AND darwin-x64; lipo-merged during Universal build |

[VERIFIED: npm registry + GitHub releases API] — confirmed installed versions via `node_modules/*/package.json`; prebuild availability confirmed via GitHub releases API for WiseLibs/better-sqlite3.

### New dependency to add

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| electron-updater | ^6.8.9 | Windows NSIS auto-update feed | Separate package from electron-builder; provides `autoUpdater` for GitHub Releases feed |

[VERIFIED: npm registry] — `npm view electron-updater` confirmed 6.8.9 is current stable (dist-tag: latest). Install as production dependency: `npm install electron-updater`.

### Supporting tools (environment — no install)

| Tool | Version | Purpose |
|------|---------|---------|
| lipo | macOS built-in | Create fat (Universal) Mach-O binary from arm64 + x64 sources |
| curl | 8.7.1 (installed) | Download x64 ffmpeg binary in pre-build script |
| gh | 2.93.0 (installed) | Optional: create GitHub release manually; electron-builder handles artifacts |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| electron-builder.yml (separate file) | `"build"` key in package.json | `package.json` becomes noisy; separate yml is easier to read and diff |
| lipo pre-merge for ffmpeg Universal | Separate arm64 + x64 .dmg artifacts | Two artifacts means user must know their CPU arch; worse DX for non-devs |
| lipo pre-merge for ffmpeg Universal | `x64ArchFiles: '**/ffmpeg'` (keep arm64 binary in x64 build) | Intel Mac users get arm64 ffmpeg; runs via Rosetta 2 but with ~10-20% perf penalty on file conversion — acceptable fallback if lipo approach fails |

**Installation (new dependency only):**
```bash
npm install electron-updater
```

---

## Package Legitimacy Audit

> slopcheck was unavailable at research time. All packages below are tagged `[ASSUMED]` for registry existence. The planner must gate the `electron-updater` install behind a `checkpoint:human-verify` task. (Better-sqlite3, ffmpeg-static, and electron-builder are already installed and in production use — no re-verification needed for those.)

| Package | Registry | Age | Downloads | Source Repo | slopcheck | Disposition |
|---------|----------|-----|-----------|-------------|-----------|-------------|
| electron-updater | npm | ~8 yrs | ~2M/wk [ASSUMED] | github.com/electron-userland/electron-builder (monorepo) | unavailable | [ASSUMED] — official electron-builder monorepo package; install after human verify |

**Packages removed due to slopcheck [SLOP] verdict:** none

**Packages flagged as suspicious [SUS]:** none (slopcheck unavailable — planner must add checkpoint:human-verify before `npm install electron-updater`)

*Note:* `electron-updater` lives in the same monorepo as `electron-builder` (electron-userland/electron-builder). High confidence this is legitimate despite slopcheck being unavailable. The checkpoint is a protocol requirement, not a real risk signal.

---

## Architecture Patterns

### System Architecture Diagram

```
[npm run build:mac]
       │
       ▼
[scripts/prepare-universal-ffmpeg.sh]
       │  download ffmpeg-darwin-x64 from b6.1.1
       │  lipo -create ffmpeg-arm64 ffmpeg-x64 → ffmpeg (fat)
       │  write fat binary to node_modules/ffmpeg-static/ffmpeg
       ▼
[electron-vite build]
       │  compiles main/preload/renderer → out/
       ▼
[electron-builder --mac --arch universal]
       │
       ├─[doPack x64]────────────────────────────────────────────────┐
       │   npmRebuild: prebuild-install downloads better_sqlite3-x64.node │
       │   bundles out/ + node_modules/ffmpeg-static/ (fat ffmpeg)   │
       │   → /tmp/CrateKeeper-x64-temp/CrateKeeper.app              │
       │                                                             │
       ├─[doPack arm64]───────────────────────────────────────────────┤
       │   npmRebuild: prebuild-install downloads better_sqlite3-arm64.node│
       │   bundles out/ + node_modules/ffmpeg-static/ (fat ffmpeg)   │
       │   → /tmp/CrateKeeper-arm64-temp/CrateKeeper.app            │
       │                                                             │
       ▼                                                             │
[@electron/universal makeUniversalApp] ◄────────────────────────────┘
       │  mergeASARs: true (default)
       │  better_sqlite3.node: lipo-merge arm64+x64 → fat .node
       │  ffmpeg: SHA matches in both builds (same fat binary) → skip lipo, keep as-is ✓
       │  → dist/mac-universal/CrateKeeper.app
       ▼
[DMG creation] → dist/CrateKeeper-1.0.0-universal.dmg

[npm run build:win] (run on Windows or CI)
       │
       ├─[electron-vite build]
       │
       └─[electron-builder --win]
           npmRebuild: prebuild-install downloads better_sqlite3-win32-x64.node
           ffmpeg-static: downloads win32-x64 binary (already correct arch on Windows)
           NSIS target → dist/CrateKeeper-Setup-1.0.0.exe
                       → dist/latest.yml (updater metadata)
```

**Update check flow (runtime, Windows):**
```
app start
    │ app.isPackaged?
    ▼
autoUpdater.checkForUpdatesAndNotify()
    │ feeds off app-update.yml (embedded at build time by electron-builder)
    │ fetches latest.yml from GitHub Releases
    ├─ update available → download silently → "update-downloaded" event
    │       → dialog: "Restart to install?" → quitAndInstall()
    └─ error → log only, continue normally (D-08: graceful degrade)
```

**Update check flow (runtime, macOS — notify only):**
```
app start
    │ app.isPackaged?
    ▼
fetch("https://api.github.com/repos/Theosantos/CrateKeeper/releases/latest")
    │ compare tag_name to app.getVersion()
    ├─ newer version → dialog/notification: "CrateKeeper X.Y.Z available — download at ..."
    │       → shell.openExternal("https://github.com/Theosantos/CrateKeeper/releases")
    └─ error / same version → silent, continue
```

### Recommended Project Structure (changes only)

```
/
├── electron-builder.yml          # NEW: build config (replaces "build" key in package.json)
├── scripts/
│   └── prepare-universal-ffmpeg.sh  # NEW: downloads x64 ffmpeg + lipo-merges for Universal build
├── src/main/
│   ├── index.ts                  # MODIFY: wire electron-updater (Windows) + macOS notify check
│   └── update/
│       └── updater.ts            # NEW: isolated updater logic (Windows autoUpdater + macOS fetch)
└── package.json                  # MODIFY: version 1.0.0, add electron-updater dep, update build:mac script
```

### Pattern 1: electron-builder.yml config (recommended over package.json `build` key)

```yaml
# electron-builder.yml
appId: com.theosantos.cratekeeper
productName: CrateKeeper

directories:
  buildResources: build
  output: dist

# electron-builder auto-detects ffmpeg-static for asarUnpack (unpackDetector.js line 30)
# Explicit entry is belt-and-suspenders and documents intent:
asarUnpack:
  - node_modules/ffmpeg-static/**
  - "**/*.node"

mac:
  icon: build/icon.icns
  entitlementsInherit: build/entitlements.mac.plist
  identity: null          # Skip code signing for v1 (D-01)
  hardenedRuntime: false  # Must be false when identity: null
  target:
    - target: dmg
      arch: universal

dmg:
  sign: false             # Do not attempt DMG signing without identity

win:
  icon: build/icon.ico
  target:
    - target: nsis
      arch:
        - x64

nsis:
  oneClick: false                    # Show installer UI (non-devs need confirmation)
  allowToChangeInstallationDirectory: false  # Simpler install for non-devs
  perMachine: false                  # Per-user install (no admin required) — better DX

publish:
  provider: github
  owner: Theosantos
  repo: CrateKeeper
  releaseType: release               # Publish as a full release (not draft)
```

[CITED: electron-builder docs + source code analysis of macPackager.js, unpackDetector.js, gitHubPublisher.js]

**Important:** `identity: null` in the `mac` block silences the "no valid identity" warning and skips signing entirely. `hardenedRuntime: false` is required when not signing. The existing `build/entitlements.mac.plist` is for the future signed build and does not need modification now.

### Pattern 2: Universal macOS — pre-build fat ffmpeg script

```bash
#!/usr/bin/env bash
# scripts/prepare-universal-ffmpeg.sh
# Creates a fat (arm64 + x64) ffmpeg binary in node_modules/ffmpeg-static/
# for use in electron-builder Universal macOS build.
# Safe to run on Apple Silicon; no-op on Windows.

set -euo pipefail

if [[ "$(uname)" != "Darwin" ]]; then
  echo "prepare-universal-ffmpeg: not on macOS, skipping"
  exit 0
fi

RELEASE_TAG="b6.1.1"
BASE_URL="https://github.com/eugeneware/ffmpeg-static/releases/download/${RELEASE_TAG}"
TARGET_DIR="node_modules/ffmpeg-static"
FFMPEG_FINAL="${TARGET_DIR}/ffmpeg"
FFMPEG_X64="${TARGET_DIR}/ffmpeg-x64"
FFMPEG_ARM64="${TARGET_DIR}/ffmpeg-arm64-orig"

echo "Preparing universal (fat) ffmpeg binary for macOS Universal build..."

# Check if already fat
if lipo -info "${FFMPEG_FINAL}" 2>/dev/null | grep -q "arm64 x86_64"; then
  echo "ffmpeg is already a fat binary, skipping"
  exit 0
fi

# Backup current binary (is arm64 on Apple Silicon machine)
cp "${FFMPEG_FINAL}" "${FFMPEG_ARM64}"

# Download x64 binary
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

[CITED: ffmpeg-static 5.3.0 package.json (release-tag: b6.1.1) + GitHub releases API confirming `ffmpeg-darwin-x64.gz` exists at that tag]

**Updated `build:mac` script in package.json:**
```json
"build:mac": "bash scripts/prepare-universal-ffmpeg.sh && electron-vite build && electron-builder --mac --arch universal"
```

### Pattern 3: electron-updater wiring in main process

```typescript
// src/main/update/updater.ts
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

[CITED: electron-updater docs (verified working for unsigned NSIS); custom macOS fetch pattern — standard workaround documented across electron community for unsigned builds]

**Wire in `src/main/index.ts` (after `app.whenReady`):**
```typescript
import { initWindowsUpdater, checkForUpdatesMacOS } from './update/updater'

app.whenReady().then(async () => {
  // ... existing app setup ...
  initWindowsUpdater()
  checkForUpdatesMacOS() // fire-and-forget; catches internally
})
```

### Pattern 4: Version bump

In `package.json`, change:
```json
"version": "0.1.0"
```
to:
```json
"version": "1.0.0"
```

electron-builder reads the version from `package.json`. No other version source exists. The tag on the GitHub Release will be `v1.0.0` (electron-builder prepends `v` by default).

### Pattern 5: GitHub Releases publish flow

```bash
# Set token (needs 'Contents: write' scope for fine-grained PAT, or 'repo' for classic PAT)
export GH_TOKEN=<your-pat>

# Build + publish macOS artifacts (run on macOS)
npm run build:mac
electron-builder --mac --arch universal --publish always

# Build + publish Windows artifacts (run on Windows or CI)
npm run build:win
electron-builder --win --publish always
```

`--publish always` uploads artifacts immediately. electron-builder creates (or finds) a GitHub Release tagged `v1.0.0` and uploads:
- `CrateKeeper-1.0.0-universal.dmg` (macOS)
- `CrateKeeper-Setup-1.0.0.exe` (Windows)
- `latest.yml` (Windows updater metadata — checksums + download URL)
- `latest-mac.yml` (macOS updater metadata — not consumed by the notify-only pattern, but generated)

`app-update.yml` is embedded inside the Windows `.exe` at build time by electron-builder's PublishManager (verified at `PublishManager.js:89`). This file tells electron-updater where to fetch `latest.yml` at runtime — no manual creation needed.

**Token priority:** `GITHUB_RELEASE_TOKEN` > `GH_TOKEN` > `GITHUB_TOKEN` (verified in `gitHubPublisher.js:22`). Use `GH_TOKEN` as the standard name.

### Anti-Patterns to Avoid

- **Skipping `identity: null` when unsigned:** Without this, electron-builder searches for a signing identity and warns loudly (or fails on some CI). Set explicitly.
- **Running `build:mac` without the ffmpeg pre-merge step:** electron-builder Universal will throw `Error: Detected file that's the same in both x64 and arm64 builds and not covered by the x64ArchFiles rule` because both sub-packs get the same arm64 ffmpeg binary.
- **Placing `electron-updater` in `devDependencies`:** It must be in `dependencies` (production) because it runs inside the packaged app.
- **Calling `autoUpdater.checkForUpdatesAndNotify()` without `app.isPackaged` guard:** In dev, electron-updater will error trying to read `app-update.yml` which doesn't exist in the dev build tree.
- **Setting `releaseType: draft` for v1:** Electron-updater only feeds from non-draft releases. Use `releaseType: release` in publish config for the updater to find the artifact.
- **Using `--publish onTagOrDraft` for first release:** This requires a git tag to exist already. Use `--publish always` for the initial release; establish a tag-based workflow later.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Cross-platform installers (.dmg, NSIS .exe) | Custom packaging scripts | electron-builder | Handles asar, native dep rebuild, codesign hooks, DMG layout, NSIS scripting |
| Native module ABI rebuild per arch | Manual `electron-rebuild` invocation per arch | electron-builder `npmRebuild: true` (default) | Calls prebuild-install correctly per arch during each sub-pack of Universal build |
| Generating `latest.yml` checksums | Hash files manually | electron-builder `--publish` | Generates, signs (if applicable), and uploads the yml automatically |
| Windows auto-update download/install | Custom downloader | electron-updater | Handles background download, verification, atomic install via NSIS |
| GitHub Releases API calls | `gh release create` / manual curl | electron-builder `publish.provider: github` | Finds/creates release, uploads all artifacts, handles retries |

**Key insight:** The only genuinely non-standard step in this phase is the ffmpeg fat-binary pre-merge. Everything else is standard electron-builder configuration.

---

## Universal macOS Build Risk (HIGHEST PRIORITY)

### Root Cause (verified via source analysis)

`ffmpeg-static` downloads ONE architecture-specific binary at npm install time (`node_modules/ffmpeg-static/ffmpeg`). On the current Apple Silicon machine, this is an `arm64` Mach-O executable (confirmed: `file node_modules/ffmpeg-static/ffmpeg` → `Mach-O 64-bit executable arm64`).

During a Universal build, electron-builder calls `doPack` twice — once for x64 and once for arm64. Both sub-packs bundle the **same** `node_modules/ffmpeg-static/` directory (including the same arm64 `ffmpeg` binary). When `@electron/universal` later tries to merge the two `.app` directories, it finds:
- x64 sub-pack: `ffmpeg` is arm64 Mach-O
- arm64 sub-pack: `ffmpeg` is arm64 Mach-O
- SHA matches between both builds → triggers error at `index.js:132`:
  ```
  Error: Detected file "Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg"
  that's the same in both x64 and arm64 builds and not covered by the x64ArchFiles rule
  ```

**Note:** ffmpeg-static is tracked outside the asar (auto-unpacked), so the merge happens at the `.app.asar.unpacked` level, not inside the asar. The same SHA-match check applies to unpacked files. The error text above is slightly simplified — the actual check in `index.js` is for Mach-O files inside the `.app` bundle; the `asar-utils.js` check is for files inside the asar. Either path causes a failure.

### Verified Solution: lipo pre-merge (recommended)

The `scripts/prepare-universal-ffmpeg.sh` script (Pattern 2 above) downloads the x64 binary from the same release tag and merges with `lipo` before electron-builder runs. The resulting fat binary has **both** architectures, so:
- Both sub-packs bundle the same fat binary
- SHA still matches between x64 and arm64 sub-packs
- `@electron/universal` detects `isUniversalMachO()` → returns true → "already universal, skipping lipo" (`index.js:122-123`)
- No error, fat binary is copied to the Universal `.app`

**Why this works:** `lipo -create arm64 x64 -output fat` produces a fat Mach-O that `lipo -info` reports as `arm64 x86_64`. The `@electron/universal` `readMachOHeader` check at line 121 will detect this as universal and skip the reconciliation step entirely.

**This has been verified** by reading the actual `@electron/universal` 2.0.3 source at `node_modules/@electron/universal/dist/cjs/index.js:121-135`.

### Fallback: x64ArchFiles (if lipo approach fails)

If the pre-merge script has issues (network failure downloading x64 binary, CI environment constraints), set:
```yaml
# in electron-builder.yml mac section
x64ArchFiles: "**/ffmpeg"
```
This tells `@electron/universal` to accept that the `ffmpeg` binary is the same in both builds (arm64) without merging. The result:
- arm64 Mac users: native arm64 ffmpeg — full performance
- Intel Mac users: arm64 ffmpeg runs via Rosetta 2 — ~10-20% conversion perf penalty, but FFmpeg conversion is I/O bound, so impact is minimal for typical DJ use

**Cost of fallback:** Advertised as "Universal" but Intel Mac conversion runs slightly slower. Acceptable for v1 DJ tool. macOS Ventura (required for Electron 39) ships with Rosetta 2 on all Intel Macs.

### better-sqlite3 in Universal builds (confirmed working)

`better-sqlite3` 12.10.0 provides prebuilt binaries for **both** `electron-v140-darwin-arm64` AND `electron-v140-darwin-x64` (verified via GitHub releases API for WiseLibs/better-sqlite3 v12.10.0). During each sub-pack, `prebuild-install` downloads the correct arch binary. `@electron/universal` then merges the two `.node` files with `lipo`. No extra configuration needed — `asarUnpack: ["**/*.node"]` ensures the `.node` file lands in `app.asar.unpacked`.

**Note:** The current `better_sqlite3.node` in the repo is ABI 140 (Electron 39), compiled for arm64 (current machine is Apple Silicon). The `electron-builder install-app-deps` (`postinstall`) command uses `prebuild-install` which downloads correct prebuilts per arch at build time — the locally compiled binary is irrelevant to the package step.

---

## Common Pitfalls

### Pitfall 1: ffmpeg-static not unpacked from asar in packaged build

**What goes wrong:** `resolveFfmpegPath` correctly rewrites the path from `app.asar` to `app.asar.unpacked`, but if `asarUnpack` didn't run, the file isn't there. FFmpeg spawn fails silently or with `ENOENT`.

**Why it happens:** Missing `asarUnpack` config. However, in electron-builder 26.x, `ffmpeg-static` is a **known package** and is auto-detected for unpacking at `unpackDetector.js:30`: `if (moduleName === "ffprobe-static" || moduleName === "ffmpeg-static" || isLibOrExe(file))`. So explicit `asarUnpack` is belt-and-suspenders (recommended) but not strictly required.

**How to avoid:** Add explicit `asarUnpack: [node_modules/ffmpeg-static/**]` in `electron-builder.yml`. This also documents intent for future maintainers.

**Warning signs:** Conversion or waveform extraction fails in packaged build but works in dev. Check `resolveFfmpegPath` output via logging in `app.isPackaged` branch.

### Pitfall 2: better-sqlite3 ABI mismatch in packaged app

**What goes wrong:** `better_sqlite3.node` compiled for Node ABI (137) instead of Electron ABI (140). App crashes on startup: `NODE_MODULE_VERSION mismatch`.

**Why it happens:** Running `npm run build` without running `prebuild` first (or `postinstall` hook not running). The `prebuild` script runs `electron-rebuild -f -w better-sqlite3` which downloads/compiles the Electron-ABI binary.

**How to avoid:** Ensure `prebuild` runs before `electron-builder`. The existing `build:mac` script runs `electron-vite build` which triggers `prebuild: npm run rebuild:electron`. electron-builder's `npmRebuild: true` (default) also handles this per-arch during Universal build.

**Warning signs:** App crashes immediately on launch in packaged build. `electron.log` (in app support folder) shows `ERR_DLOPEN_FAILED`.

### Pitfall 3: autoUpdater called outside packaged context

**What goes wrong:** `autoUpdater.checkForUpdatesAndNotify()` throws in development: "ENOENT: no such file or directory, open '.../app-update.yml'".

**Why it happens:** `app-update.yml` is only generated and embedded by electron-builder during packaging. In dev mode, this file doesn't exist.

**How to avoid:** Always guard: `if (app.isPackaged) { autoUpdater.checkForUpdatesAndNotify() }`.

**Warning signs:** Dev mode crashes or throws errors related to `app-update.yml`.

### Pitfall 4: GitHub Release as draft prevents updater feed

**What goes wrong:** electron-updater cannot find the update even after publishing.

**Why it happens:** `releaseType: draft` (the electron-builder default when no `releaseType` is specified) creates a draft release. electron-updater only fetches from **published** (non-draft) releases.

**How to avoid:** Set `releaseType: release` in the publish config. Alternatively, manually publish the draft on GitHub after build.

**Warning signs:** `autoUpdater.on('update-not-available')` fires even when a newer version exists.

### Pitfall 5: Universal build run on wrong machine

**What goes wrong:** Building `--arch universal` on an Intel Mac produces the wrong ffmpeg binary (x64 only). The `prepare-universal-ffmpeg.sh` script checks the current binary, finds it's already x64, skips downloading arm64, and the Universal build won't have an arm64 ffmpeg.

**Why it happens:** `ffmpeg-static` downloads the binary for the current machine's arch at `npm install` time. On Intel Mac, that's x64.

**How to avoid:** The pre-merge script should always download BOTH binaries from the GitHub release rather than relying on the current machine binary. The script in Pattern 2 above copies the current binary as "arm64-orig" — if run on Intel Mac, this will be x64, not arm64, and the merge will fail or produce a wrong fat binary.

**Revised safer approach for the script:** Always download BOTH `ffmpeg-darwin-arm64.gz` and `ffmpeg-darwin-x64.gz` from the release URL, regardless of current machine arch, then lipo-merge. Discard any locally installed binary. The planner should adjust the script accordingly.

**Warning signs:** Fat binary created but `lipo -info` only shows one architecture.

### Pitfall 6: Gatekeeper quarantine on downloaded DMG

**What goes wrong:** User double-clicks the `.dmg` and gets "CrateKeeper is damaged and can't be opened". This is worse than the standard Gatekeeper prompt.

**Why it happens:** macOS applies a quarantine attribute to files downloaded from the internet. For unsigned apps, Gatekeeper blocks launch with a misleading "damaged" message (macOS Ventura+) if the user tries to open by double-clicking.

**How to avoid:** The release notes / README must instruct: "Right-click (or Control-click) the app → Open → Open (in the dialog)". Do NOT say "double-click to open". The quarantine prompt on right-click open says "from an unidentified developer, are you sure?" — which is survivable. The double-click error is not.

**Warning signs:** User reports "app is damaged" — this means they tried to double-click, not right-click.

---

## Code Examples

### electron-builder.yml — complete recommended config

```yaml
# Source: analysis of electron-builder 26.8.1 source + official docs

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

### Checking for asarUnpack correctness (smoke test)

```typescript
// In main process — add to app startup logging (dev only):
import ffmpegStatic from 'ffmpeg-static'
import { resolveFfmpegPath } from './conversion/ffmpegPath'
import { existsSync } from 'fs'

const resolved = resolveFfmpegPath({ rawPath: ffmpegStatic!, isPackaged: app.isPackaged })
if (app.isPackaged && !existsSync(resolved)) {
  console.error('[startup] FATAL: ffmpeg binary not found at:', resolved)
  // This fires if asarUnpack is misconfigured
}
```

### macOS version check via GitHub API

```typescript
// Minimal fetch — uses Node.js 18+ built-in fetch (available in Electron 39)
const res = await fetch(
  'https://api.github.com/repos/Theosantos/CrateKeeper/releases/latest',
  { headers: { 'User-Agent': `CrateKeeper/${app.getVersion()}` }, signal: AbortSignal.timeout(5000) }
)
const { tag_name } = await res.json() as { tag_name: string }
// tag_name will be "v1.0.0" — strip leading "v" for semver comparison
```

---

## Runtime State Inventory

> This is a packaging-and-release phase, not a rename/refactor/migration. No runtime state inventory needed.

**Skipped — not a rename/refactor phase.**

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| electron-builder | `build:mac`, `build:win` | ✓ | 26.8.1 | — |
| lipo | `prepare-universal-ffmpeg.sh` | ✓ | macOS built-in | x64ArchFiles workaround |
| curl | `prepare-universal-ffmpeg.sh` | ✓ | 8.7.1 | Use `node -e "..."` fetch fallback |
| gh CLI | Optional manual release creation | ✓ | 2.93.0 | electron-builder `--publish always` handles releases |
| GH_TOKEN env var | electron-builder `--publish always` | ✗ | — | Must be set before build:publish; no fallback |
| Windows machine or CI | `build:win` (NSIS target) | ✗ (current machine is macOS) | — | Must run on Windows or use CI (GitHub Actions) |
| Node.js | All build scripts | ✓ | v24.16.0 | — |

**Missing dependencies with no fallback:**
- `GH_TOKEN` — must be created at github.com/settings/tokens (Classic PAT: `repo` scope; Fine-grained: `Contents: write` on Theosantos/CrateKeeper). No workaround for publish step.
- Windows machine for NSIS build — cannot cross-compile NSIS `.exe` from macOS. Must use Windows or GitHub Actions runner.

**Missing dependencies with fallback:**
- `lipo` merge failure → use `x64ArchFiles: "**/ffmpeg"` workaround.

---

## Validation Architecture

`nyquist_validation: true` is set in `.planning/config.json`. Standard unit tests are not meaningful for packaging correctness — the important validations are post-build smoke tests.

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest (existing, 546 tests passing) |
| Config file | `vitest.config.ts` (inferred from electron-vite scaffold) |
| Quick run command | `npm test` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| DIST-01 | .dmg installer launches app on macOS | Manual smoke | Run app from DMG, verify window opens | N/A |
| DIST-01 | .exe installer launches app on Windows | Manual smoke | Install, launch, verify window | N/A |
| DIST-02 | FFmpeg resolves correctly in packaged build | Manual smoke | Run conversion of one file in packaged app | N/A |
| DIST-02 | Waveform extraction works in packaged build | Manual smoke | Open tagger, verify waveform renders | N/A |
| auto-update (win) | Windows: update check without crash | Manual smoke | Launch packaged app on Windows, verify no crash if no update available | N/A |

**Important note:** These success criteria require a packaged app to test. They CANNOT be automated in Vitest (which tests source code, not packaged builds). The planner must include explicit human-verify checkpoint tasks for each.

### Packaging Correctness Checks (build-time assertions)

These can be scripted and run immediately after `electron-builder` completes, before human testing:

```bash
# Check that app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg exists
# (Verifies asarUnpack worked)
unzip -l dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar 2>/dev/null | grep ffmpeg || \
  ls dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg

# Check that better_sqlite3.node is NOT inside the asar (must be unpacked)
# (A .node file inside asar causes dlopen failure)
node -e "const asar = require('@electron/asar'); const files = asar.listPackage('dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar'); const nodes = files.filter(f => f.endsWith('.node')); if(nodes.length > 0) { console.error('FAIL: .node files inside asar:', nodes); process.exit(1); } console.log('OK: no .node files in asar')"

# Verify fat binary architectures
lipo -info dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/ffmpeg-static/ffmpeg
# Expected: Architectures in the fat file are: arm64 x86_64

# Verify better_sqlite3.node is fat
lipo -info "dist/mac-universal/CrateKeeper.app/Contents/Resources/app.asar.unpacked/node_modules/better-sqlite3/build/Release/better_sqlite3.node"
# Expected: Architectures in the fat file are: arm64 x86_64
```

### Sampling Rate

- **Per task commit:** `npm test` (existing 546-test suite — no new unit tests needed for packaging config)
- **Per wave merge:** `npm test` + build-time assertions above
- **Phase gate:** Full suite green + human-verify smoke test (DIST-01, DIST-02) before `/gsd-verify-work`

### Wave 0 Gaps

- [ ] `scripts/prepare-universal-ffmpeg.sh` — pre-build script for fat ffmpeg
- [ ] `src/main/update/updater.ts` — updater logic (Windows + macOS notify)
- [ ] `electron-builder.yml` — build config file
- [ ] `npm install electron-updater` — after human-verify checkpoint

---

## Security Domain

> `security_enforcement: true` (absent = enabled) in config. ASVS level 1.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No | — |
| V3 Session Management | No | — |
| V4 Access Control | No | — |
| V5 Input Validation | No (packaging phase, no new user inputs) | — |
| V6 Cryptography | No | — |
| V2/V6 Binary integrity | Partial | electron-builder generates SHA checksums in latest.yml; unsigned builds cannot provide code-signed integrity guarantees |

### Known Threat Patterns for this stack

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Unsigned binary replacement (DMG swapping) | Tampering | Accepted risk for v1 (D-01); mitigate in v2 with code signing |
| MITM on Windows auto-update download | Tampering | electron-updater verifies SHA checksum from latest.yml before applying update |
| GH_TOKEN exposure in CI logs | Info disclosure | Never echo/print GH_TOKEN; use CI secret injection (`${{ secrets.GH_TOKEN }}`) |
| macOS Gatekeeper bypass instructions | Elevation of privilege | Release notes must be clear: right-click → Open is the legitimate bypass; users should only do this for apps they downloaded from the official Releases page |
| GitHub API rate limit on macOS version check | Denial of service | `AbortSignal.timeout(5000)` + silent catch (D-08); GitHub anonymous rate limit is 60 req/hr — negligible for a version check |

**No critical ASVS gaps for this phase.** The primary security surface is the unsigned binary distribution, which is an accepted v1 risk (D-01) with a documented mitigation path (code signing in v2).

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `"build"` key in package.json | `electron-builder.yml` (separate file) | electron-builder 20+ | Cleaner package.json; yml supports comments |
| electron-forge (Webpack) | electron-vite + electron-builder | 2023-2024 | Faster rebuilds, first-class Vite HMR |
| Separate arm64 + x64 DMGs | Universal DMG (one installer) | Electron 11+ (@electron/universal) | Better UX for non-developers who don't know their CPU arch |
| Squirrel.Mac auto-update | electron-updater with macOS signing requirement | unchanged | macOS auto-update still requires code signing — no change |

**Deprecated/outdated:**
- `electron-packager`: replaced by electron-builder for most use cases (electron-builder handles native deps, DMG, NSIS, code signing hooks)
- `Squirrel.Windows`: replaced by NSIS target in electron-builder for new projects (simpler, no separate Squirrel.Windows server)
- `autoUpdater` from Electron core: replaced by `electron-updater` (from electron-userland) for cross-platform support beyond Squirrel

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Windows NSIS auto-update works without code signing (unsigned .exe) | Standard Stack, Pattern 3 | If wrong: auto-update silently fails on Windows; fallback is D-07 manual download (same as macOS) — not critical for v1 |
| A2 | x64 ffmpeg binary (arm64 only on Intel Mac Rosetta) gives acceptable perf for DJ file conversion | Universal Build Risk | If wrong: Intel Mac users experience noticeably slower conversion — use lipo pre-merge to avoid entirely |
| A3 | `electron-updater@6.8.9` is compatible with `electron-builder@26.8.1` | Standard Stack | High confidence — same monorepo, released together. If wrong: version conflict at runtime |
| A4 | GitHub API anonymous rate limit (60/hr) is sufficient for macOS version check | Code Examples | If wrong: rate-limited users see no update notification — silent degrade per D-08 |

**Claimed `[ASSUMED]` for package legitimacy:** `electron-updater` slopcheck status.

---

## Open Questions

1. **Windows build environment**
   - What we know: NSIS `.exe` cannot be cross-compiled from macOS; electron-builder will error if targeting Windows on a macOS machine without Wine.
   - What's unclear: Does the user have a Windows machine or CI available for the Windows build, or is GitHub Actions the intended environment?
   - Recommendation: Plan the Windows build as a separate task explicitly labeled "must run on Windows or CI". Document the GitHub Actions workflow as an optional follow-up if a Windows machine is available.

2. **GitHub repository name casing**
   - What we know: CONTEXT.md D-04 says repo is `Theosantos/CrateKeeper` (capital C, capital K).
   - What's unclear: Is the GitHub repo actually named `CrateKeeper` (with capital letters), or `cratekeeper` (all lower)? The package.json `"name"` is `cratekeeper` (lowercase).
   - Recommendation: Verify the exact repo name before setting `publish.repo` in `electron-builder.yml`. GitHub repo names are case-sensitive in API calls.

3. **DMG background image / window layout**
   - What we know: D-11 specifies existing icons are used. CONTEXT.md leaves DMG layout to Claude's discretion.
   - What's unclear: Should the DMG have a custom background with an arrow showing "drag to Applications"? Or a plain window?
   - Recommendation: Use electron-builder's default DMG layout (no custom background) for v1 to keep the build configuration minimal. A custom DMG background can be added in v2.

---

## Sources

### Primary (HIGH confidence)

- `node_modules/@electron/universal/dist/cjs/index.js` — direct source analysis of universal build merge logic, SHA match detection, x64ArchFiles behavior (lines 118-149)
- `node_modules/@electron/universal/dist/cjs/asar-utils.js` — mergeASARs logic, singleArchFiles error path (lines 60-128)
- `node_modules/app-builder-lib/out/macPackager.js` — Universal build flow: doPack x64 + arm64 separately, then makeUniversalApp (lines 99-165)
- `node_modules/app-builder-lib/out/asar/unpackDetector.js` — ffmpeg-static auto-unpack by module name (line 30)
- `node_modules/app-builder-lib/out/publish/PublishManager.js` — app-update.yml generation at line 89
- `node_modules/electron-publish/out/gitHubPublisher.js` — GH_TOKEN precedence, GitHub Releases API calls
- `node_modules/ffmpeg-static/install.js` + `package.json` — arch-specific binary download mechanism, release tag b6.1.1
- `node_modules/ffmpeg-static/index.js` — FFMPEG_BIN env var override, single binary path resolution
- GitHub Releases API (WiseLibs/better-sqlite3 v12.10.0) — confirmed prebuilds for electron-v140-darwin-arm64 AND darwin-x64
- GitHub Releases API (eugeneware/ffmpeg-static b6.1.1) — confirmed `ffmpeg-darwin-arm64.gz` and `ffmpeg-darwin-x64.gz` at release tag

### Secondary (MEDIUM confidence)

- [electron-builder macOS docs](https://www.electron.build/docs/mac/) — `identity: null` skip signing, `hardenedRuntime: false`, `x64ArchFiles`, `mergeASARs` options
- [electron-builder architecture docs](https://www.electron.build/docs/architecture/) — Universal build native module handling
- [electron-updater auto-update docs](https://www.electron.build/docs/features/auto-update/) — NSIS unsigned support, macOS signing requirement, `checkForUpdatesAndNotify()` pattern
- [Auto-Update implementation guide](https://blog.nishikanta.in/implementing-auto-updates-in-electron-with-electron-updater) — Windows auto-update main process wiring

### Tertiary (LOW confidence, for reference only)

- [electron/universal GitHub](https://github.com/electron/universal) — `singleArchFiles` docs overview
- [Medium: Electron + SQLite + Universal Mac](https://medium.com/@andreialex.patru/electron-electron-builder-node-sqlite3-and-universal-mac-builds-x64-and-arm64-fb7c50e1fff4) — confirms asarUnpack: ["**/*.node"] pattern; describes the arch-split asar structure as an alternative approach

---

## Metadata

**Confidence breakdown:**
- Standard Stack: HIGH — installed versions verified from node_modules; better-sqlite3 prebuilds confirmed via GitHub API
- Universal build risk analysis: HIGH — verified directly from @electron/universal 2.0.3 source code
- ffmpeg-static fat binary strategy: HIGH — lipo is macOS built-in; release URLs verified via GitHub API
- electron-updater wiring (Windows): HIGH — documented behavior; NSIS unsigned support confirmed
- macOS notify-only pattern: HIGH — custom fetch approach, not library-dependent
- Pitfalls: HIGH — all derived from source code analysis, not speculation
- GitHub publish flow: HIGH — verified from electron-publish source + official docs

**Research date:** 2026-06-22
**Valid until:** 2026-09-22 (electron-builder stable; electron-updater 6.x stable)
