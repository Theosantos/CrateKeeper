---
phase: 1
slug: foundation
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-05-28
---

# Phase 1 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (Wave 0 installs) |
| **Config file** | none — Wave 0 installs |
| **Quick run command** | `npm run test` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~10 seconds |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run`
- **After every plan wave:** Run full suite + `npm run build` (verify electron-vite build green)
- **Before `/gsd-verify-work`:** Full suite must be green + manual launch check
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 1-01-01 | 01 | 0 | — | — | N/A | infra | `npm run build` | ❌ W0 | ⬜ pending |
| 1-01-02 | 01 | 1 | — | T-1-01 | contextIsolation:true, nodeIntegration:false in BrowserWindow | unit | `npm run test -- --run` | ❌ W0 | ⬜ pending |
| 1-01-03 | 01 | 1 | FOUND-02 | T-1-02 | folder path validated before persistence | unit | `npm run test -- --run` | ❌ W0 | ⬜ pending |
| 1-01-04 | 01 | 1 | FOUND-03 | — | DB round-trip read/write of settings key | unit | `npm run test -- --run` | ❌ W0 | ⬜ pending |
| 1-01-05 | 01 | 2 | FOUND-01 | — | navigation renders 3 tool areas | unit | `npm run test -- --run` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `vitest` + `@testing-library/react` install — no framework detected (new project)
- [ ] `vitest.config.ts` — test config with jsdom environment for renderer tests
- [ ] Test setup file for React Testing Library

*Note: better-sqlite3 main-process logic tested in Node environment; renderer/React tested in jsdom.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Folder persists across real app relaunch | FOUND-03 | Requires quitting/relaunching packaged Electron process — not reproducible in jsdom | Launch `npm run dev`, pick a folder, quit fully, relaunch — folder still shown |
| Native dialog opens on folder-pick click | FOUND-02 | OS-level dialog cannot be driven in headless test | Launch app, click folder picker, confirm OS dialog appears |
| better-sqlite3 loads under Electron 42 runtime | FOUND-03 | Native module ABI only verifiable in real Electron, not Node test runner | Run `npm run dev`, confirm no native module load error in console |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
