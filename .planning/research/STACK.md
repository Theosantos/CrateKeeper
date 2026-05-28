# Stack Research — DJ Utils

**Researched:** 2026-05-28
**Research method:** Training knowledge (cutoff August 2025). Bash and WebSearch tools unavailable in this environment — all findings are from training data. Confidence levels reflect this constraint.

---

## Recommended Stack

| Layer | Library | Version | Rationale |
|-------|---------|---------|-----------|
| **Electron scaffold** | electron-vite | ^3.x | Best-in-class DX for Electron in 2025. Vite-powered HMR, native Node module support, built-in IPC type safety helpers. Actively maintained, widely adopted over electron-forge for new projects. |
| **Electron** | electron | ^30–32 | Use whatever electron-vite pins; Electron 30+ ships Chromium 124+ and Node 20+, which gives stable Worker Threads and the Web Audio API. |
| **Frontend framework** | React + TypeScript | React 18, TS 5 | React has the widest component ecosystem for the kind of card/swipe UI needed (Framer Motion, dnd-kit). Svelte would be lighter but the ecosystem for gesture/animation is thinner. Vue is fine but React fits this better. |
| **Build / bundler** | Vite (via electron-vite) | ^5 | Fastest rebuild, good native module handling, first-class TypeScript. |
| **Audio metadata read/write** | music-metadata | ^10 | Best-in-class parser: supports ID3v1/v2/v2.4, MP4/iTunes, FLAC, OGG. Pure JavaScript, zero native deps, works in the Electron main process without rebuild issues. **For writing**, pair with node-taglib2 or node-id3. |
| **ID3 tag writing (MP3)** | node-id3 | ^0.2 | Pure JS ID3v2.3/v2.4 writer. No native bindings — no `electron-rebuild` headaches. Covers artist, title, genre, BPM, key (TKEY frame), comment. Rekordbox reads standard ID3v2 frames correctly. |
| **MP4 tag writing** | mp4tag.js or @ffmpeg-tools | via ffmpeg | For MP4/M4A files, writing tags with pure JS is fragile. Delegate MP4 tag writes to ffmpeg (`-metadata` flags during a remux pass) rather than a separate library. |
| **Audio conversion** | fluent-ffmpeg | ^2.1 | High-level Node.js wrapper around ffmpeg. Chain-able API, progress events, stderr parsing. Widely used, stable API. |
| **ffmpeg binary** | ffmpeg-static | ^5 | Bundles a static ffmpeg binary for Mac (arm64 + x64) and Windows x64. No system ffmpeg required — critical for non-dev users distributing via .dmg/.exe. Must be unpacked from asar (see PITFALLS). |
| **Background processing** | Node.js Worker Threads | built-in | Run batch analysis and conversion jobs in worker threads off the main process. Electron main process → spawn worker → postMessage progress/results → IPC to renderer. No additional library needed. |
| **Audio playback** | Web Audio API (native) | browser built-in | The Electron renderer has full Web Audio API. Use it directly for the Tinder-style preview (load a short decoded buffer, play on card flip). No library needed for simple playback. |
| **Playback helper (optional)** | Howler.js | ^2.2 | Only add if Web Audio API direct usage feels verbose. Howler wraps Web Audio cleanly, handles cross-format decode, provides seek/loop/fade. Low weight (~7kb). |
| **UI / animations** | Framer Motion | ^11 | Swipe gesture + card spring animation for the Tinder interface. Integrates naturally with React. |
| **State management** | Zustand | ^4 | Lightweight, no boilerplate. Sufficient for tool state (current file list, conversion queue, tagging progress). No Redux needed at this scale. |
| **Packaging / distribution** | electron-builder | ^24 | Produces .dmg (macOS, universal binary) and NSIS .exe (Windows). Handles code signing hooks. Works with electron-vite projects. |

---

## Key Findings

- **electron-vite is the right scaffold**, not electron-forge. electron-forge's Webpack plugin has worse DX for Vite-native React projects. electron-vite gives you the main/preload/renderer split with proper HMR and is the community default for new Electron apps as of 2024.

- **music-metadata is the clear winner for reading** — it's pure JS, handles every format DJs use (MP3, FLAC, AAC/M4A, AIFF, WAV), and returns a uniform parsed object. No native bindings means no `electron-rebuild` on every Electron version bump.

- **Tag writing has a split strategy**: node-id3 for MP3 (pure JS, covers all ID3v2 frames Rekordbox uses including TBPM and TKEY), and ffmpeg metadata flags for MP4/M4A (remux with `-c copy -metadata`). This avoids fragile pure-JS MP4 atom writing.

- **ffmpeg-static is non-negotiable** for user-friendly distribution. Users installing via .dmg/.exe cannot be expected to have system ffmpeg. The binary must be bundled and unpacked from the asar archive at runtime.

- **Worker Threads > child_process for batch jobs**. Both work, but Worker Threads share the Node process memory space (cheaper for thousands of file stat/metadata calls). For ffmpeg spawning (which is already a subprocess), fluent-ffmpeg handles it — wrap the queue management in a worker.

- **No BPM detection library needed** — PROJECT.md explicitly defers auto-BPM to out-of-scope. Manual entry via text input only.

- **Rekordbox compatibility**: Rekordbox reads ID3v2.3 and ID3v2.4 reliably. Key frames must use TKEY (not a comment). Genre uses TCON. BPM uses TBPM. node-id3 exposes all of these as named fields.

- **Web Audio API is sufficient for preview playback**. The Tinder interface needs a short clip (e.g., first 30s or a configurable cue point). Decoding a file into an AudioBuffer and playing it is 10 lines of code. Howler.js is only worth adding if you need cross-fade or complex transport controls later.

---

## What NOT to Use

| Rejected Option | Why Rejected |
|----------------|-------------|
| **electron-forge** | Webpack-based plugin has slower rebuilds and worse DX than Vite. electron-vite is preferred for React + TypeScript. |
| **node-taglib2 / taglib bindings** | Native bindings require `electron-rebuild` on every Electron version bump. Pure-JS alternatives (node-id3 for MP3) cover the needed formats without this maintenance burden. |
| **jsmediatags** | Older library, read-only, less actively maintained than music-metadata. No write support. |
| **ffprobe-static separate** | ffmpeg-static already includes ffprobe. No need for a separate package. |
| **React Query / TanStack Query** | Overkill for a local-file desktop app with no HTTP. Zustand + direct IPC calls is enough. |
| **Redux / Redux Toolkit** | Too much boilerplate for the scope. Zustand handles the state surface cleanly. |
| **Neutralino.js / Tauri** | Tauri (Rust) would be lighter, but the Rust ecosystem for audio metadata writing (especially ID3v2.4 + MP4) is less mature than Node.js for v1 velocity. Tauri also complicates ffmpeg bundling. Electron is the correct call given PROJECT.md constraints. |
| **react-spring instead of Framer Motion** | Both work for swipe gestures. Framer Motion has better gesture detection API (`drag`, `dragConstraints`) and is better documented for card-swipe patterns. |
| **Vue or Svelte** | Vue: fine but smaller ecosystem for the animation primitives needed. Svelte: minimal ecosystem for complex gesture + animation patterns (Framer Motion doesn't support it). React is the right choice for this UI. |

---

## Confidence Levels

| Area | Confidence | Notes |
|------|------------|-------|
| electron-vite as scaffold | HIGH | Dominant standard since 2023, widely adopted |
| music-metadata for reading | HIGH | De facto standard, no real competitor |
| node-id3 for MP3 write | HIGH | Well-established, pure JS, correct ID3v2.4 frames |
| ffmpeg-static + fluent-ffmpeg | HIGH | Industry standard combination for Node.js audio tools |
| Worker Threads for batch | HIGH | Node built-in, well understood pattern |
| Web Audio API for playback | HIGH | Native to Electron renderer, no risk |
| React + Framer Motion for Tinder UI | HIGH | Standard gesture-card pattern in React ecosystem |
| Zustand for state | HIGH | Lightweight, widely used in Electron apps |
| electron-builder for packaging | HIGH | Standard for .dmg + .exe distribution |
| MP4 tag write via ffmpeg | MEDIUM | Pure-JS MP4 atom writing is fragile; ffmpeg remux is reliable but adds a pass. Worth validating that `-c copy -metadata` round-trips cleanly for M4A files DJs use. |
| Howler.js (optional) | MEDIUM | May not be needed at all; flag for phase-level decision |

---

## Installation Sketch

```bash
# Scaffold
npm create @quick-start/electron dj-utils -- --template react-ts
cd dj-utils

# Audio
npm install music-metadata node-id3 fluent-ffmpeg ffmpeg-static

# UI
npm install framer-motion zustand

# Dev
npm install -D electron-builder
```

Note: ffmpeg-static must be configured as an `extraResource` in electron-builder config and the path resolved at runtime via `app.getPath` or `process.resourcesPath`, not from inside the asar archive.
