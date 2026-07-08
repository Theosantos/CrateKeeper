# Phase 6: Distribution - Context

**Gathered:** 2026-06-22
**Status:** Ready for planning

<domain>
## Phase Boundary

Package CrateKeeper into installable artifacts a **non-developer DJ** can run on
macOS and Windows with **zero manual dependency setup** — `.dmg` (macOS) and
`.exe` (Windows), with FFmpeg and the native SQLite module bundled inside and
resolving correctly at runtime.

Delivers **DIST-01** (single-file installers, no prior install) and **DIST-02**
(FFmpeg bundled — no system dependency). This is electron-builder configuration
+ packaging + a first GitHub release. The runtime plumbing (asar-aware ffmpeg
path, native-dep rebuild) already exists from earlier phases.

**In scope:** electron-builder `build` config, app identity/icons, asar-unpack of
ffmpeg-static, dmg + NSIS targets, Windows auto-update wiring, GitHub Releases
publish, install instructions for unsigned builds, v1.0.0 release.

**Out of scope:** code signing / notarisation (deferred), macOS auto-update
(requires signing — deferred), Linux packaging, an in-app "what's new" changelog.
</domain>

<decisions>
## Implementation Decisions

### Code signing & notarisation
- **D-01:** Ship **UNSIGNED** for v1 — no Apple Developer cert, no Windows cert. Free, ships now.
- **D-02:** Document the first-launch workaround for end users in the release notes / README: macOS → right-click the app → **Open** (bypasses Gatekeeper); Windows → SmartScreen → **More info → Run anyway**.
- **D-03:** Signing is additive later — adding it must not require rearchitecting the build. `build/entitlements.mac.plist` already exists for when notarisation is enabled.

### Distribution channel
- **D-04:** Distribute via **GitHub Releases** on the public repo `Theosantos/CrateKeeper`. Friends download the `.dmg` / `.exe` from the Releases page.
- **D-05:** electron-builder `publish` target = GitHub Releases (so `--publish` can attach artifacts and feed the updater).

### Auto-update
- **D-06:** **Windows-only auto-update** via electron-updater for v1 (NSIS auto-update works on unsigned builds). Update feed = the GitHub Releases above.
- **D-07:** **No macOS auto-update** in v1 — Squirrel.Mac requires a valid code signature, which we don't have. Instead, on macOS the app **checks for a newer release and notifies** the user ("nouvelle version disponible → ouvrir la page Releases"); the user re-downloads the `.dmg` manually. macOS auto-install is enabled later, once signing lands (see Deferred).
- **D-08:** The updater must **degrade gracefully**: no crash/blocking if the update check fails (offline, rate-limited, etc.).

### App identity & versioning
- **D-09:** `productName` = **CrateKeeper** (display name), `appId` = **com.theosantos.cratekeeper**.
- **D-10:** Bump version **0.1.0 → 1.0.0** for the first real release.
- **D-11:** Use the existing icons in `build/` (`icon.icns`, `icon.ico`, `icon.png`).

### Target platforms & architectures
- **D-12:** **macOS Universal** (arm64 + Intel x64) — covers Apple Silicon AND Intel Macs (we don't know friends' hardware). Larger installer accepted.
- **D-13:** **Windows x64** NSIS installer (ffmpeg-static ships x64). No 32-bit, no ARM Windows.
- **D-14:** No Linux target in this phase (PROJECT.md scopes Linux out), even though a `build:linux` script exists.

### Claude's Discretion
- DMG layout/background, NSIS installer options (per-user vs per-machine, install dir prompt), artifact file-naming, and the exact electron-updater integration shape are left to research/planning to choose sensibly within the decisions above.
</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & project constraints
- `.planning/REQUIREMENTS.md` §Distribution — DIST-01 (.dmg + .exe, no prior install) and DIST-02 (FFmpeg bundled, no system dependency).
- `.planning/PROJECT.md` §Constraints — Electron Mac+Win, ffmpeg-static bundled, "binary must be unpacked from the asar archive at runtime".
- `.planning/ROADMAP.md` §"Phase 6: Distribution" — goal + 3 success criteria.

### Stack / packaging guidance
- `CLAUDE.md` §"Recommended Stack" (electron-builder ^24 → .dmg universal + NSIS .exe; ffmpeg-static "must be unpacked from asar — see PITFALLS") and §"Key Findings" (ffmpeg-static non-negotiable for non-dev distribution).

### Existing runtime integration (do not rebuild)
- `src/main/conversion/ffmpegPath.ts` — `resolveFfmpegPath({ rawPath, isPackaged })` already rewrites `app.asar` → `app.asar.unpacked` for packaged builds. The electron-builder `asarUnpack` glob must match what this resolver expects.
- `src/main/index.ts:144-197` — where `resolveFfmpegPath` + `ffmpeg-static` are wired into the conversion/tagger controllers.

No external ADRs — decisions are fully captured above.
</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `build/icon.icns`, `build/icon.ico`, `build/icon.png` — app icons already prepared (all three formats).
- `build/entitlements.mac.plist` — macOS entitlements already present (for hardened-runtime/notarisation when signing is added later).
- `package.json` scripts: `build:mac`, `build:win`, `build:linux`, `build:unpack` already invoke electron-builder; `postinstall: electron-builder install-app-deps` already rebuilds native deps (better-sqlite3) for Electron.
- `resolveFfmpegPath` (asar-aware) — runtime ffmpeg resolution is done; only the packaging-side `asarUnpack` config is missing.

### Established Patterns
- App is electron-vite (main/preload/renderer split); production build = `npm run build` (typecheck + electron-vite build) → `out/`. electron-builder packages `out/`.
- Native module: better-sqlite3 (must be unpacked + ABI-correct for Electron — `install-app-deps` handles it).

### Integration Points
- electron-builder `build` config to ADD to package.json (or a separate `electron-builder.yml`): `appId`, `productName`, `directories.buildResources=build`, `asarUnpack` for ffmpeg-static, `mac` (dmg, universal, icon, entitlements), `win` (nsis, x64, icon), `publish` (github).
- electron-updater wiring in `src/main` (Windows: autoUpdater feed; macOS: version-check + notify only).

### Open technical risk for research
- **Universal macOS build + native deps**: better-sqlite3 and ffmpeg-static are per-arch binaries. A universal build must include arm64 AND x64 variants of each native binary (electron-builder `mergeASARs`/universal handling). Research must confirm ffmpeg-static + better-sqlite3 package correctly into a universal `.app`.
</code_context>

<specifics>
## Specific Ideas

- Target audience is explicitly **DJ friends who are non-developers** — install friction must be minimal, and the unsigned-build first-launch steps must be clearly documented (with screenshots ideally) in the release notes.
- Windows auto-update should be silent-ish/standard NSIS behaviour; macOS users just get a gentle "new version" nudge to the Releases page.
</specifics>

<deferred>
## Deferred Ideas

- **Code signing + notarisation** (macOS Apple Developer cert + Windows OV/EV cert) — removes Gatekeeper/SmartScreen warnings and is the prerequisite for macOS auto-update. Revisit when there's budget/justification (`build/entitlements.mac.plist` already in place to make this a config-level change).
- **macOS auto-update** — blocked on signing; enable once signed (electron-updater + Squirrel.Mac).
- **Linux packaging** (AppImage/deb) — out of scope per PROJECT.md, though `build:linux` exists.
- **In-app changelog / "what's new" screen** — nice-to-have, not needed for v1 distribution.

### Reviewed Todos (not folded)
None — no pending todos matched this phase.
</deferred>

---

*Phase: 6-Distribution*
*Context gathered: 2026-06-22*
