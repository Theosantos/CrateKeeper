# Milestones

## v1.0 MVP (Shipped: 2026-06-24)

**Phases completed:** 6 phases, 17 plans, 35 tasks
**Timeline:** 2026-05-29 → 2026-06-24 (~26 days) · 30 commits · ~17.4k LOC TypeScript
**Released:** v1.0.0 then v1.0.1 (new icon + code-review fixes) on `Theosantos/CrateKeeper`
**Known deferred items at close:** 5 (see STATE.md → Deferred Items — all human-only verification)

**Key accomplishments:**

- electron-vite/React 19/TS scaffold with a secure BrowserWindow, typed window.djUtils contextBridge, better-sqlite3 settings store at userData, native folder-pick IPC, ffmpeg path helper, and Vitest infra — every later phase reuses this backbone.
- Three-tool Electron renderer (Analyser/Convertir/Tagger) wired to a Zustand store that drives the native folder picker and mount-time hydration through the typed window.djUtils bridge.
- Unsigned macOS Universal `CrateKeeper-1.0.0-universal.dmg` with a fat (x86_64+arm64) bundled FFmpeg and fat better-sqlite3, both asar-unpacked and resolving at runtime — installs, launches, converts, and renders a waveform on macOS with zero system dependencies.
- electron-updater wired for Windows NSIS auto-update + macOS notify-only GitHub-API check (both graceful-degrade), plus a GitHub Actions release pipeline that built the Windows `CrateKeeper-Setup-1.0.0.exe` green on windows-latest.
- Published a non-draft v1.0.0 GitHub Release carrying the macOS `.dmg`, Windows `.exe`, and both updater-feed YAMLs — downloadable and installable by a non-developer via the documented unsigned first-launch steps — and turned the scaffold README into a public-ready project front page.

---
