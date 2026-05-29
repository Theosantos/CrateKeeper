# Pitfalls Research — DJ Utils

**Domain:** Electron desktop app — audio analysis, batch conversion, ID3/MP4 tag writing
**Researched:** 2026-05-28
**Confidence:** HIGH on established Electron/audio patterns, MEDIUM on Rekordbox-specific compatibility details (needs validation against current Rekordbox version)

---

## Critical Pitfalls

### 1. FFmpeg Binary Path Breaks in Packaged App

**What goes wrong:** In development, `ffmpeg-static` resolves to a path inside `node_modules`. After `electron-builder` packages the app into an `.asar` archive, that path no longer exists on disk. FFmpeg is a native binary — it cannot live inside `.asar`. The app silently fails to spawn the process, or throws `ENOENT` with a deeply confusing path.

**Why it happens:** `app.asar` is a virtual filesystem. Native executables cannot be executed from inside it. `ffmpeg-static` returns a path that is valid in dev but points into the archive in production.

**Prevention:**
- Mark ffmpeg binaries as `asarUnpack` in `electron-builder` config:
  ```json
  "asarUnpack": ["**/node_modules/ffmpeg-static/**"]
  ```
- At runtime, detect the correct path using `app.isPackaged`:
  ```ts
  import ffmpegPath from 'ffmpeg-static'
  const resolvedPath = app.isPackaged
    ? ffmpegPath.replace('app.asar', 'app.asar.unpacked')
    : ffmpegPath
  ```
- Test the packaged binary explicitly before shipping — this never surfaces in `npm run dev`.

**Warning signs:** Works in dev, crashes immediately in packaged build with `spawn ENOENT`.

**Phase to address:** Phase 1 (conversion feature) — wire this correctly from day one, not as a fix later.

---

### 2. ID3v2.3 vs ID3v2.4 — Rekordbox Reads v2.3

**What goes wrong:** Most modern JS libraries (including `music-metadata`) default to ID3v2.4. Rekordbox (and many CDJ hardware players) reads ID3v2.3. Writing v2.4 tags results in missing or garbled fields on Rekordbox import, especially for `TBPM` (BPM), `TKEY` (musical key), and `COMM` (comments).

**Specific incompatibilities:**
- ID3v2.4 uses UTF-8 as default text encoding; v2.3 uses UTF-16 with BOM for non-ASCII. Writing raw UTF-8 bytes into a v2.3 frame causes mojibake in Rekordbox.
- The `TDRC` frame (recording date, v2.4) does not exist in v2.3; Rekordbox expects `TYER`.
- BPM should go in `TBPM` — some libraries write it as a float string ("128.0"); Rekordbox expects integer string ("128").
- Key field: Rekordbox expects `TKEY` with a specific format ("1A", "2B" Camelot notation or standard notation). Non-standard strings are ignored silently.

**Prevention:**
- Force ID3v2.3 when writing to MP3 files. With `node-id3`: set `{ version: 3 }`.
- Use UTF-16 with BOM for text encoding in all string frames.
- Write BPM as integer string, not float.
- Validate tag round-trip through `music-metadata` read after write in tests.
- Flag as requiring verification against current Rekordbox version (Pioneer updates Rekordbox frequently).

**Warning signs:** Tags visible in macOS Finder/VLC but not in Rekordbox, or shown with wrong encoding (question marks, boxes).

**Phase to address:** Tag writing phase — encode this knowledge as constants/config from the start, not after user reports.

---

### 3. Audio File Corruption on Tag Write

**What goes wrong:** Writing ID3 tags directly modifies binary files. A crash, power loss, or disk error mid-write leaves a partially written file. The original audio data may be intact but the file header is corrupt — unplayable.

**Prevention — always use write-to-temp-then-rename pattern:**
```
1. Read original file → parse tags
2. Write modified file to tempfile (same filesystem, e.g. file.tmp next to original)
3. fsync tempfile
4. Rename tempfile → original (atomic on same filesystem)
5. Only delete original path after successful rename
```
- Never write directly to the original path.
- `fs.rename()` is atomic on POSIX (Mac/Linux) and effectively atomic on Windows on the same drive. Cross-drive renames are not atomic — always write temp to same directory as target.
- Libraries like `node-id3` offer a `update` API that handles this, but verify they use atomic rename, not read-modify-write in place.

**Warning signs:** User reports files becoming unplayable after a tagging session, especially if they interrupted the operation.

**Phase to address:** Tag writing phase — not an optimization, a safety requirement.

---

### 4. Memory Explosion When Scanning Thousands of Files

**What goes wrong:** Scanning 5000 audio files with `music-metadata` in a `Promise.all()` opens all files simultaneously, reads audio frames, allocates metadata objects, and holds them all in memory. Node.js heap balloons to several GB. The app becomes unresponsive or crashes with an out-of-memory error.

**Prevention:**
- Use a concurrency-limited queue (e.g., `p-limit` with limit of 10-20 concurrent reads).
- Stream results to the renderer incrementally instead of collecting all results first.
- Use `music-metadata`'s `parseFile` with `{ skipCovers: true }` to skip loading embedded album art into memory during scan.
- Do not store raw `IAudioMetadata` objects for thousands of files — extract only the fields the UI needs (path, format, bitrate, duration, tags) into plain objects.
- Release file handles explicitly; do not rely on GC.

**Warning signs:** Scan of 1000+ files hangs, Activity Monitor shows Node process consuming 4GB+.

**Phase to address:** Analysis phase — design the queue pattern from the start.

---

### 5. Electron nodeIntegration / contextIsolation Misconfiguration

**What goes wrong:** Enabling `nodeIntegration: true` in a renderer window exposes the full Node.js API to any web content rendered. If the app ever loads external URLs (even for error pages), this becomes a remote code execution vulnerability. It also makes the app fail macOS notarization review.

**Prevention:**
- Always set `nodeIntegration: false` and `contextIsolation: true` (the Electron defaults since v12).
- All Node.js/IPC access goes through a preload script using `contextBridge.exposeInMainWorld`.
- Never use `enableRemoteModule: true`.
- Never load external URLs in the main BrowserWindow. Use `shell.openExternal()` for links.
- IPC handlers in main process must validate all arguments — the renderer is untrusted.

**Warning signs:** App passes Apple notarization but shows security warnings, or notarization is rejected outright.

**Phase to address:** Project setup (phase 1) — retrofitting contextIsolation after the fact requires rewriting all IPC.

---

## Cross-Platform Gotchas

### Windows Path Backslashes

**What goes wrong:** Path operations that work on Mac fail silently or throw on Windows because backslash vs forward slash handling differs. Constructing paths with string concatenation (`dir + '/' + file`) breaks. Regular expressions like `/\//` miss Windows separators.

**Prevention:**
- Always use `path.join()`, `path.resolve()`, `path.dirname()`, `path.basename()` — never string concatenation for paths.
- Normalize to forward slashes only when passing paths to FFmpeg (FFmpeg on Windows accepts both but some shell quoting issues arise).
- When displaying paths in UI, use `path.normalize()` so the OS-native separator is shown.

### Special Characters in Filenames

**What goes wrong:** DJ libraries frequently contain files with accented characters (é, ü, ñ), apostrophes, brackets, and parentheses. When these paths are passed to `child_process.spawn` as shell arguments, unescaped characters break the command. Node's `spawn` (not `exec`) avoids shell interpretation — always prefer it.

**Prevention:**
- Use `spawn` with an array of arguments, never `exec` with a shell-interpolated string:
  ```ts
  // WRONG - shell injection risk
  exec(`ffmpeg -i "${filePath}" output.mp3`)
  
  // CORRECT - no shell, args are verbatim
  spawn('ffmpeg', ['-i', filePath, 'output.mp3'])
  ```
- Test specifically with filenames containing: spaces, apostrophes, parentheses, accented characters, CJK characters.

### Windows Long Path Limit

**What goes wrong:** Windows has a 260-character path limit by default. DJ library folders nested several levels deep with long filenames hit this. Node.js file operations throw `ENAMETOOLONG` or silently skip files.

**Prevention:**
- Enable long paths in the Windows manifest or via `\\?\` UNC prefix for file operations.
- Warn the user if a detected path is close to the limit (>200 chars).

### Case Sensitivity

**What goes wrong:** macOS filesystem is case-insensitive by default; Windows NTFS is also case-insensitive. Code that does case-sensitive path comparisons (e.g., deduplication logic) incorrectly treats `Track.mp3` and `track.mp3` as different files.

**Prevention:**
- Normalize paths to lowercase when comparing, not when storing or displaying.

---

## Audio Tag Writing Safety

### MP4/AAC Tag Pitfalls

**What goes wrong:** MP4 tag writing is more complex than ID3 — the `moov` atom must be rewritten, and its position matters for streaming. Libraries that prepend `moov` (vs append) can change file playback behavior in some players.

**Prevention:**
- Use a battle-tested library for MP4 tags (`mp4tag.js` or `ffmpeg -metadata` for write-back).
- Test MP4 output files in Rekordbox and on a CDJ before considering the feature stable.
- Apply the same write-to-temp-then-rename pattern as for MP3.

### Embedded Album Art Corruption

**What goes wrong:** When reading then rewriting tags, some libraries strip or re-encode embedded album art at a different compression level, degrading image quality over multiple write cycles.

**Prevention:**
- If album art is not being explicitly changed, preserve the raw bytes as-is — do not decode-then-re-encode.
- In the v1 scope, if not editing album art, skip reading/writing it entirely (`{ skipCovers: true }`).

### BOM in UTF-16 Strings

**What goes wrong:** ID3v2.3 requires UTF-16 with BOM for text encoding (encoding byte `0x01`). Some libraries write UTF-16 without the BOM, causing Rekordbox to misparse multi-byte characters.

**Prevention:**
- Verify with `node-id3` that string frames are written as `UTF16` not `UTF16BE`.
- Read back written tags with `music-metadata` and compare byte-for-byte against a Rekordbox-written file.

---

## Electron Packaging Traps

### Native Modules Must Be Rebuilt for Electron's Node Version

**What goes wrong:** Any npm package with native `.node` add-ons (C++ bindings) is compiled for the system Node.js version. Electron bundles its own Node.js, which is usually a different version and ABI. Loading a natively compiled module built for system Node into Electron throws `MODULE_NOT_FOUND` or an ABI mismatch error at runtime.

**Prevention:**
- Use `electron-rebuild` (or the equivalent in electron-builder) to recompile native modules against Electron's bundled Node version.
- Add to package.json scripts: `"postinstall": "electron-rebuild"`.
- For CI: include electron-rebuild in the build pipeline.
- Prefer pure-JS libraries over native modules where performance allows. For audio metadata: `music-metadata` is pure JS. For FFmpeg: spawn as subprocess (no native module needed).

### node_modules Bundle Size

**What goes wrong:** The default `electron-builder` configuration packages all of `node_modules` into the installer. FFmpeg static binaries alone are 80-120MB. Including dev dependencies, test files, and unused platform binaries bloats the installer to 300MB+.

**Prevention:**
- Use `ffmpeg-static` which ships platform-specific binaries; configure `electron-builder` to only include the current platform's binary.
- Mark `devDependencies` correctly — they are excluded by default, but verify.
- Use `electron-builder`'s `files` array to exclude test fixtures, docs, and large assets not needed at runtime.
- Target < 150MB installer for reasonable download experience.

### macOS Code Signing and Notarization

**What goes wrong:**
1. Unsigned apps on macOS Catalina+ show a "cannot be opened because the developer cannot be verified" error. Users cannot bypass this via right-click on Apple Silicon (ARM) Macs with some security policies.
2. Notarization requires: hardened runtime enabled, no deprecated entitlements, all binaries (including FFmpeg) signed with your Developer ID.
3. Bundled FFmpeg binary must be signed. If using `ffmpeg-static`, the unsigned prebuilt binary will be rejected by notarization.

**Prevention:**
- Obtain an Apple Developer account ($99/year) and a Developer ID certificate.
- In `electron-builder` config: set `mac.hardenedRuntime: true`, `mac.gatekeeperAssess: false`, configure `mac.entitlements`.
- Sign the FFmpeg binary as part of the packaging step — this requires extracting it from the npm package and re-signing.
- Run `xcrun notarytool` (or let electron-builder handle it) as part of the release pipeline, not as an afterthought.
- Test the signed, notarized `.dmg` on a clean Mac before shipping. Signing issues only appear on a machine that didn't build the app.

**Warning signs:** App works on developer's own Mac but shows security errors on any other Mac.

**Phase to address:** Distribution phase — but set up the signing infrastructure before first real user test.

### Windows Code Signing

**What goes wrong:** Unsigned Windows executables trigger SmartScreen warnings ("Windows protected your PC"). Users must click "More info" → "Run anyway". Non-technical DJ friends will likely stop here and report the app as broken.

**Prevention:**
- Obtain a code signing certificate from a trusted CA (Sectigo, DigiCert). EV certificates ($300-500/year) suppress SmartScreen entirely; OV certificates reduce warnings over time as reputation builds.
- Configure `electron-builder` to sign the installer and the app binary.
- Without a certificate, at minimum instruct users how to bypass the warning — document this prominently.

### NSIS vs Squirrel on Windows

**What goes wrong:** Squirrel (used by older Electron apps) creates an install structure where the executable lives in a version-numbered subdirectory, breaking hardcoded relative paths. NSIS creates a simpler layout but requires the user to run the installer manually (no auto-update by default).

**Recommendation:** Use NSIS (`target: "nsis"` in electron-builder) for the first version — simpler, predictable file layout, easier to debug. Add auto-update (via `electron-updater`) after the initial release is stable.

**Warning signs:** App installs but fails to launch, or paths to user data directory are wrong after update.

---

## Key Findings

**The single highest-risk pitfall** is the FFmpeg binary path in packaged builds. It is invisible during development, guaranteed to fail in production if not addressed, and has burned nearly every Electron developer who ships FFmpeg. Address this in the first conversion spike, not at packaging time.

**The second highest-risk pitfall** for this specific project is ID3v2.3 vs v2.4 + encoding for Rekordbox compatibility. The entire value proposition depends on tags working correctly in Rekordbox. Write a validation test that writes tags and reads them back through `music-metadata`, and manually verify in Rekordbox before calling the tag writing feature "done."

**Atomicity on tag writes** is non-negotiable for a production tool handling someone's entire music library. One corrupted file erases trust permanently.

**Code signing** should be set up before giving the app to non-developer friends. An "app is damaged" dialog on first launch is a very bad first impression.

| Pitfall | Severity | When to Tackle |
|---------|----------|---------------|
| FFmpeg path in packaged app | Critical | Phase 1 — conversion spike |
| ID3v2.3 encoding for Rekordbox | Critical | Phase — tag writing |
| Atomic file write pattern | Critical | Phase — tag writing |
| contextIsolation / nodeIntegration | Critical | Project setup |
| Memory limits on bulk scan | High | Phase — analysis |
| Native module rebuild | High | Project setup / packaging |
| macOS notarization | High | Pre-distribution |
| Windows SmartScreen / signing | High | Pre-distribution |
| Windows path / backslash handling | Medium | Throughout |
| Special chars in filenames | Medium | Phase — conversion |
| Bundle size | Medium | Packaging phase |
| NSIS vs Squirrel | Low | Packaging phase |
