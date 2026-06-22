# Phase 6: Distribution — Discussion Log

**Date:** 2026-06-22
*Human-reference record of the discuss-phase session. Not consumed by downstream agents (see 06-CONTEXT.md for the canonical decisions).*

## Areas selected for discussion
All four presented gray areas: Signature & notarisation · Canal de distribution & MAJ · Identité & versioning · Architectures cibles.

## Questions & decisions

### 1. Signature & notarisation
- Options: unsigned v1 (rec.) / sign macOS only / sign both.
- **Chosen:** Unsigned for v1 — document Gatekeeper (right-click → Open) + SmartScreen (More info → Run anyway) workarounds. Signing deferred.

### 2. Canal de distribution + auto-update
- Options: GitHub Releases no-update (rec.) / GitHub Releases + auto-update / direct link.
- **Chosen:** GitHub Releases **+ auto-update**.

### 3. Identité & versioning
- Options: CrateKeeper · com.theosantos.cratekeeper · v1.0.0 (rec.) / keep v0.1.0.
- **Chosen:** CrateKeeper · com.theosantos.cratekeeper · **v1.0.0**.

### 4. Architectures cibles
- Options: macOS Universal + Win x64 (rec.) / macOS arm64 only + Win x64.
- **Chosen:** macOS **Universal** + Windows **x64**.

### 5. Follow-up — auto-update vs unsigned conflict (surfaced by Claude)
- Context: macOS auto-update (Squirrel.Mac) requires a code signature; unsigned + Windows NSIS auto-update is fine.
- Options: Windows-only auto-update + macOS notify/manual (rec.) / no auto-update at all v1 / sign macOS after all.
- **Chosen:** **Windows-only auto-update**; macOS = "new version available → open Releases" notification + manual re-download until signing lands.

## Deferred ideas
- Code signing + notarisation (macOS + Windows) — prerequisite for macOS auto-update.
- macOS auto-update — blocked on signing.
- Linux packaging — out of scope (PROJECT.md).
- In-app changelog/"what's new" screen.

## Claude's discretion
DMG layout, NSIS installer options, artifact naming, exact electron-updater integration shape.
