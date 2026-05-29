---
phase: 2
slug: scanning
status: draft
nyquist_compliant: true
wave_0_complete: true
created: 2026-05-29
---

# Phase 2 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | vitest (installed in Phase 1, Wave 0) |
| **Config file** | `vitest.config.ts` (node + jsdom projects) |
| **Quick run command** | `npm run test -- --run` |
| **Full suite command** | `npm run test -- --run` |
| **Estimated runtime** | ~15 seconds projected (Phase 1 baseline: ~5s for 14 tests) |
| **ABI rule** | Running `npm test` rebuilds better-sqlite3 for Node ABI (137). `predev` triggers `electron-rebuild -f -w better-sqlite3` to swap back to Electron ABI (140). If a dev launch hits NODE_MODULE_VERSION mismatch, run `npx electron-rebuild -f -w better-sqlite3`. |

---

## Sampling Rate

- **After every task commit:** Run `npm run test -- --run` (full suite — fast enough that scoping is not worth the bookkeeping cost)
- **After every plan wave:** Run full suite + `npm run build` (verify electron-vite main+preload+renderer + worker entry are green)
- **Before `/gsd-verify-work`:** Full suite green + manual launch checkpoint completed
- **Max feedback latency:** 30 seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 2-01-01 | 01 | 0 | — | — | Worker entry pinned in electron.vite.config.ts; new deps in `dependencies` for externalize | infra | `npm run build && test -f out/main/workers/scanWorker.js` | ❌ W0 | ⬜ pending |
| 2-01-02 | 01 | 0 | — | — | IpcChannels + DjUtilsApi extended (types only) | typecheck | `npm run build` | ❌ W0 | ⬜ pending |
| 2-01-03 | 01 | 0 | SCAN-01, SCAN-02, SCAN-03 | T-2-02 | Pure metadata extraction; failed parse → parsedOk:false row, never crashes | unit | `npm run test -- --run src/main/scan` | ❌ W0 | ⬜ pending |
| 2-01-04 | 01 | 0 | SCAN-03, SCAN-05 | T-1-03 | scanRepo prepared statements only; replaceScanForFolder is one tx | unit | `npm run test -- --run src/main/db` | ❌ W0 | ⬜ pending |
| 2-01-05 | 01 | 0 | SCAN-05 | T-2-01, T-2-05 | Worker walks readdirp + symlink loop guard; single-active controller cancels prior; batched emit (50 files / 200ms) | unit | `npm run test -- --run src/main/scan` | ❌ W0 | ⬜ pending |
| 2-01-06 | 01 | 0 | SCAN-01..03, SCAN-05 | T-2-01, T-2-06 | scan:start asserts requested path === settings.rootFolder before spawning worker; scan:cancel idempotent | unit | `npm run test -- --run src/main/ipc` | ❌ W0 | ⬜ pending |
| 2-02-01 | 02 | 1 | SCAN-01..03, SCAN-05 | T-1-04 | useScanStore subscribes to scan:event; no Node imports in renderer | unit | `npm run test -- --run src/renderer/src/store` | ❌ W0 | ⬜ pending |
| 2-02-02 | 02 | 1 | SCAN-01..03 | T-2-07, T-2-08 | TagBadge + VirtualizedFileTable + ScanToolbar present, no window.djUtils in components (store-mediated) | grep | `grep -rn "window.djUtils" src/renderer/src/components` returns zero | ❌ W0 | ⬜ pending |
| 2-02-03 | 02 | 1 | SCAN-01..03 | — | AnalyserView renders table + scan toolbar | unit | `npm run test -- --run src/renderer/src/views` | ❌ W0 | ⬜ pending |
| 2-03-01 | 03 | 2 | SCAN-04 | T-2-12 | streamCsv writes via createWriteStream; no `stringify.sync` in source | unit | `npm run test -- --run src/main/scan/csvExport` | ❌ W0 | ⬜ pending |
| 2-03-02 | 03 | 2 | SCAN-04 | T-2-09, T-2-10, T-2-11 | scan:export-csv calls dialog.showSaveDialog (main-owned path); RFC-4180 escaping verified | unit | `npm run test -- --run src/main/ipc` | ❌ W0 | ⬜ pending |
| 2-03-03 | 03 | 2 | SCAN-04 | — | ScanToolbar Export CSV button disabled while scanning / empty | unit | `npm run test -- --run src/renderer/src/components/analyser` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

All Wave 0 infra was set up in Phase 1. Phase 2 inherits it:
- [x] vitest (node + jsdom projects)
- [x] `@testing-library/react` + jsdom + `@testing-library/jest-dom`
- [x] dual-ABI rebuild scripts (`rebuild:node` / `rebuild:electron` via `electron-rebuild -f`)
- [x] electron-builder asarUnpack for `ffmpeg-static` and `better-sqlite3`

Phase 2 adds (Plan 02-01 Task 1):
- [ ] `music-metadata`, `readdirp`, `csv-stringify` in `dependencies`
- [ ] `@tanstack/react-virtual` in `dependencies`
- [ ] electron.vite.config.ts: `main.build.rollupOptions.input.scanWorker` entry so the worker bundles under `out/main/workers/scanWorker.js`

---

## Test Type Coverage

| Type | Where | Count target | Phase 2 plans |
|------|-------|--------------|---------------|
| Pure-function unit (node) | `src/main/scan/scanCore.test.ts`, `src/main/db/scanRepo.test.ts`, `src/main/scan/csvExport.test.ts` | ≥ 12 cases combined | 02-01, 02-03 |
| IPC handler unit (node, injected deps) | `src/main/ipc/scan.test.ts` | ≥ 6 cases (start path guard, cancel idempotency, export, error paths) | 02-01, 02-03 |
| Store unit (jsdom, mocked window.djUtils) | `src/renderer/src/store/useScanStore.test.ts` | ≥ 9 behaviors | 02-02 |
| Component / view unit (jsdom, RTL) | `src/renderer/src/views/AnalyserView.test.tsx`, plus optional ScanToolbar smoke | ≥ 5 behaviors | 02-02 |
| Manual launch (checkpoint:human-verify) | Each plan ends with a blocking checkpoint | 3 checkpoints | 02-01, 02-02, 02-03 |

---

## Requirement → Test Trace

| Req | Description | Plan | Primary Test | Manual Gate |
|-----|-------------|------|--------------|-------------|
| SCAN-01 | List audio files with format, bitrate, size | 02-01 Task 3 + 02-02 Task 2 | `scanCore.test.ts` parses format/bitrate/size + table renders these columns | Checkpoint 02-02: pick a real folder, see rows populate live |
| SCAN-02 | + sample rate + duration | 02-01 Task 3 + 02-02 Task 2 | `scanCore.test.ts` reads sampleRate/duration from music-metadata; table shows columns | Checkpoint 02-02: rows show sample rate + mm:ss duration |
| SCAN-03 | Tag completeness badges (Genre / BPM / Key) | 02-01 Task 3 + 02-02 Task 2 | `scanCore.test.ts` returns hasGenre/hasBpm/hasKey booleans; TagBadge renders per state | Checkpoint 02-02: badge colours match known-tagged vs untagged files |
| SCAN-04 | CSV export | 02-03 (all tasks) | `csvExport.test.ts` streaming write; IPC handler test asserts showSaveDialog use | Checkpoint 02-03: export 1000+ files to .csv, open in spreadsheet, verify columns |
| SCAN-05 | Non-blocking — worker + streaming | 02-01 Tasks 5/6 + 02-02 Task 1 | Controller test asserts single-active cancel; store test asserts batched append (no per-event re-render) | Checkpoint 02-02: 1000+ file scan stays scrollable; nav switching still instant |

---

## Threat Model Coverage

T-1-01..T-1-04 carried forward from Phase 1 (sandbox, set-folder type-check, parameterised SQL, renderer-no-direct-bridge). Phase 2 adds:

| ID | STRIDE | Component | Test/Gate |
|----|--------|-----------|-----------|
| T-2-01 | Tampering | scan:start handler | Asserts requested path === settings.rootFolder (handler unit test) |
| T-2-02 | DoS | scanWorker per-file parse | parsedOk:false row on throw; never crashes worker (scanCore unit test) |
| T-2-05 | Tampering | worker spawn path | Worker entry path is bundler-resolved constant, not renderer-supplied |
| T-2-06 | Surface | new IPC channels | All in IpcChannels const; renderer cannot enumerate beyond the typed bridge |
| T-2-07 | Perf-DoS | renderer render storm | Store batches events; component test asserts no full-list re-render on each event |
| T-2-08 | Perf-DoS | DOM blow-up on 50k rows | VirtualizedFileTable uses @tanstack/react-virtual; visual checkpoint verifies smooth scroll |
| T-2-09 | Tampering | CSV save path | Path comes from dialog.showSaveDialog only (handler unit test) |
| T-2-10 | Injection | CSV cell content | RFC-4180 escape rules verified in csvExport unit test |
| T-2-11 | DoS | CSV memory | Streamed via createWriteStream; grep guard: no `stringify.sync` |
| T-2-12 | Integrity | scan persistence | replaceScanForFolder is one transaction; partial-write impossible |

---

## Exit Criteria (Phase Complete)

All of:
1. Every task in the per-task map shows ✅ green
2. Every Wave ends green on both `npm run test -- --run` and `npm run build`
3. All three human-verify checkpoints approved by user
4. Phase 1 ABI rule still holds — `npm run dev` works after a `npm run test` run (predev rebuilds reliably)
5. STATE.md updated with Phase 2 outcome + any new key decisions / known risks
6. ROADMAP.md marks Phase 2 complete + SCAN-01..05 ticked in REQUIREMENTS.md
