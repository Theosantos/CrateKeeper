---
status: partial
phase: 06-distribution
source: [06-VERIFICATION.md]
started: 2026-06-24T15:00:33Z
updated: 2026-06-24T15:00:33Z
---

## Current Test

[awaiting human testing on Windows hardware]

## Tests

### 1. Windows install smoke-test on real Windows x64 hardware
expected: Run `CrateKeeper-Setup-1.0.0.exe` from the published Releases page → SmartScreen → More info → Run anyway → per-user install (no admin) → app launches with the three-tool nav → convert one file to MP3 320 produces output with no system FFmpeg → app does not crash/block on the update check when offline or at version parity (D-08).
result: [pending]
why_human: The .exe built green on GitHub Actions windows-latest and is published + downloadable, but the SmartScreen-bypass + first-launch + bundled-ffmpeg conversion path on actual Windows hardware is the one DIST-01/DIST-02 behavior not directly exercised by the Mac-only maintainer. CI proves the artifact builds and packages; it does not exercise the end-user install gesture. Naturally covered when the first Windows user downloads the published installer.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
