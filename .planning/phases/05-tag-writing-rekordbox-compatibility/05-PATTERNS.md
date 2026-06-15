# Phase 5: Tag Writing & Rekordbox Compatibility — Pattern Map

**Mapped:** 2026-06-15
**Files analyzed:** 8 new/modified files
**Analogs found:** 8 / 8

---

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `src/main/tagger/tagWriter.ts` | service | file-I/O + transform | `src/main/conversion/presets.ts` + `src/main/workers/conversionCore.ts` | role-match (file-write is new, ffmpeg invocation and arg-building are exact) |
| `src/main/tagger/applyController.ts` | controller | batch + event-driven | `src/main/scan/controller.ts` (simpler) / `src/main/conversion/controller.ts` (full) | role-match (simpler synchronous loop; no worker thread) |
| `src/main/tagger/taggerRepo.ts` (extend) | model | CRUD | itself — `createTaggerRepo` patterns for prepared stmt + row mapper | exact |
| `src/main/ipc/tagger.ts` (extend) | middleware / route | request-response | itself — `registerTaggerHandlers` handler shape | exact |
| `src/shared/ipc-types.ts` (extend) | config | — | itself — `IpcChannels` const block + `CrateKeeperTaggerApi` interface | exact |
| `src/preload/index.ts` (extend) | config | — | itself — `tagger.*` bridge block | exact |
| `src/renderer/src/store/useTaggerStore.ts` (extend) | store | event-driven | `src/renderer/src/store/useConversionStore.ts` | exact |
| `src/renderer/src/components/tagger/ApplyBanner.tsx` (NEW) | component | request-response | `src/renderer/src/components/convertir/ResumeBanner.tsx` | exact |
| `src/main/tagger/tagWriter.test.ts` (NEW) | test | file-I/O | `src/main/conversion/tagRoundtrip.test.ts` | exact |

---

## Pattern Assignments

### `src/main/tagger/tagWriter.ts` (service, file-I/O)

**Analogs:**
- `src/main/conversion/presets.ts` — `buildFfmpegArgs` pattern (arg array construction with `-map_metadata 0`)
- `src/main/conversion/ffmpegPath.ts` — asar-aware binary resolution, reuse directly

**Imports pattern** (`src/main/conversion/presets.ts` lines 1-2; `ffmpegPath.ts` lines 1-2):
```typescript
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs/promises'
// node-id3 must be installed first: npm install node-id3@^0.2.9
import NodeID3 from 'node-id3'
```

**ffmpeg arg construction pattern** (`src/main/conversion/presets.ts` lines 81-103):
```typescript
// Existing pattern: args array built incrementally, output path LAST.
// -map_metadata 0 BEFORE any -metadata overrides (same filesystem passthrough).
// presets.ts line 96: args.push('-map_metadata', '0')
// Phase 5 variant for tag-only remux:
const args = [
  '-y', '-i', filePath,
  '-c', 'copy',
  '-map_metadata', '0',   // preserve all existing atoms first
  ...metaFlags,           // then override only non-null fields
  tmp
]
// spawnSync used here (not fluent-ffmpeg) — simple enough for a 1-command pass
const result = spawnSync(ffmpegBinaryPath, args, { encoding: 'utf8' })
if (result.status !== 0) {
  throw new Error(`ffmpeg exited ${result.status}: ${result.stderr?.slice(-500) ?? ''}`)
}
```

**Atomic write pattern** (new for Phase 5 — no exact analog exists yet):
```typescript
// Temp file MUST be same-dir as target for atomic fs.rename (same filesystem).
// Path: path.join(path.dirname(filePath), path.basename(filePath) + '.ck-tmp')
const dir = path.dirname(filePath)
const tmp = path.join(dir, path.basename(filePath) + '.ck-tmp')
try {
  await fs.copyFile(filePath, tmp)
  // For MP3: NodeID3.update(tags, tmp) — merges into the copy, not original
  // For MP4: spawnSync(ffmpegBin, [..., tmp]) — ffmpeg writes to tmp
  await fs.rename(tmp, filePath) // atomic overwrite
} catch (err) {
  await fs.rm(tmp, { force: true }) // clean up on any failure
  throw err
}
```

**Non-destructive tags object pattern** (from RESEARCH.md Pattern 1 — guards against D-04 violation):
```typescript
// Build tags ONLY from non-null fields — never pass null values to NodeID3.update().
// Passing { artist: null } would silently delete the TPE1 frame.
const tags: NodeID3.Tags = {}
if (input.artist != null)  tags.artist = input.artist
if (input.title != null)   tags.title = input.title
if (input.genre != null)   tags.genre = input.genre
if (input.bpm != null)     tags.bpm = String(input.bpm)   // TBPM is a text frame
if (input.key != null)     tags.initialKey = input.key     // → TKEY frame
if (input.comment != null) tags.comment = { language: 'eng', text: input.comment }
if (input.rating != null && input.rating >= 1) {
  tags.popularimeter = { email: 'rating@cratekeeper', rating: starToPopmByte(input.rating), counter: 0 }
}
// starToPopmByte: { 1:51, 2:102, 3:153, 4:204, 5:255 } — LOCKED in 04-CONTEXT.md
```

**ffmpeg binary resolution reuse** (`src/main/conversion/ffmpegPath.ts` — use as-is):
```typescript
// From src/main/conversion/ffmpegPath.ts — already imported in main/index.ts
import { resolveFfmpegPath } from '../conversion/ffmpegPath'
// Call site: resolveFfmpegPath({ rawPath: ffmpegStatic, isPackaged: app.isPackaged })
// tagWriter.ts receives the resolved string via a `ffmpegBinaryPath` parameter
// (same injection style as waveform.ts which receives resolveFfmpegPath as a dep).
```

---

### `src/main/tagger/applyController.ts` (controller, batch)

**Primary analog:** `src/main/scan/controller.ts` — simpler single-active loop without worker threads.
**Secondary analog:** `src/main/conversion/controller.ts` — for the heartbeat/settled Promise shape if needed.

**Deps injection pattern** (`src/main/scan/controller.ts` lines 17-26; `src/main/conversion/controller.ts` lines 44-59):
```typescript
// All external deps injected at construction — never imported directly.
// Enables full unit-test control (see controller.test.ts pattern).
export interface ApplyControllerDeps {
  taggerRepo: TaggerRepo
  writeMp3Tags: (filePath: string, input: TagInput) => Promise<void>
  writeMp4Tags: (filePath: string, input: TagInput, ffmpegPath: string) => Promise<void>
  ffmpegBinaryPath: string
  send: (channel: string, payload: TagWriteEvent) => void
  now?: () => number
}
```

**Single-active + sequential batch pattern** (`src/main/scan/controller.ts` lines 45-54):
```typescript
// ScanController uses a single `activeScan` guard — same principle here,
// but Phase 5 uses a simpler isRunning boolean (no worker, no heartbeat).
// The write loop is sequential (one file at a time, not parallel) — this is
// lighter than conversion which uses parallelism=cpuCount-1.
let isRunning = false

export function createApplyController(deps: ApplyControllerDeps): ApplyController {
  const now = deps.now ?? (() => Date.now())

  return {
    async applyPendingWrites(): Promise<ApplyResult> {
      if (isRunning) throw new Error('Un lot est déjà en cours')
      isRunning = true
      try {
        const pending = deps.taggerRepo.listPendingWrites()
        let totalWritten = 0
        let totalFailed = 0
        for (const edit of pending) {
          try {
            await writeOne(edit, deps)
            deps.taggerRepo.markApplied(edit.filePath, now())
            totalWritten++
            deps.send(IpcChannels.TaggerWriteEvent, { type: 'fileDone', filePath: edit.filePath, ok: true })
          } catch (err) {
            totalFailed++
            const error = err instanceof Error ? err.message : String(err)
            deps.send(IpcChannels.TaggerWriteEvent, { type: 'fileDone', filePath: edit.filePath, ok: false, error })
            // Per-file failure: applied_at stays NULL — file stays retryable (D-05)
          }
        }
        deps.send(IpcChannels.TaggerWriteEvent, { type: 'done', totalWritten, totalFailed })
        return { totalWritten, totalFailed }
      } finally {
        isRunning = false
      }
    }
  }
}
```

**Push event sender pattern** (`src/main/ipc/conversion.ts` lines 345-354):
```typescript
// Conversion's makeConversionSender — copy for tagger write events.
// wc.send() is the main→renderer push direction (not ipcMain.handle).
export function makeTaggerWriteSender(
  getSender: () => WebContents | null
): (channel: string, payload: TagWriteEvent) => void {
  return (channel, payload): void => {
    const wc = getSender()
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  }
}
```

---

### `src/main/tagger/taggerRepo.ts` (EXTEND — model, CRUD)

**Analog:** itself — extend using the exact prepared-statement pattern already established.

**Prepared statement pattern** (`src/main/tagger/taggerRepo.ts` lines 126-169):
```typescript
// New statements follow the SAME pattern: db.prepare(...) at construction time,
// never inside the method body. Named bindings with @param for objects,
// positional ? for simple scalars. No template-literal SQL with embedded values.

// listPendingWrites — use Option B predicate (RESEARCH recommendation):
const listPendingWritesStmt = db.prepare(
  'SELECT * FROM pending_tag_edits ' +
  'WHERE applied_at IS NULL OR updated_at > applied_at'
)

// markApplied — set applied_at only AFTER fs.rename succeeds:
const markAppliedStmt = db.prepare(
  'UPDATE pending_tag_edits SET applied_at = ? WHERE file_path = ?'
)

// Methods added to the returned TaggerRepo object:
listPendingWrites(): PendingTagEdit[] {
  const rows = listPendingWritesStmt.all() as PendingTagEditDb[]
  return rows.map(toPendingTagEdit)
},
markApplied(filePath: string, now: number): void {
  markAppliedStmt.run(now, filePath)
}
```

**Interface extension** (add to `TaggerRepo` interface, lines 9-28):
```typescript
// Add to the TaggerRepo interface alongside existing methods:
listPendingWrites(): PendingTagEdit[]
markApplied(filePath: string, now: number): void
```

**Row mapper reuse** (`src/main/tagger/taggerRepo.ts` lines 91-104):
```typescript
// toPendingTagEdit is already defined — listPendingWrites reuses it directly.
// No new mapper needed.
function toPendingTagEdit(r: PendingTagEditDb): PendingTagEdit {
  return {
    filePath: r.file_path,
    genre: r.genre,
    bpm: r.bpm,
    key: r.key,
    artist: r.artist,
    title: r.title,
    comment: r.comment,
    rating: r.rating,
    updatedAt: r.updated_at,
    appliedAt: r.applied_at
  }
}
```

---

### `src/main/ipc/tagger.ts` (EXTEND — middleware, request-response)

**Analog:** itself — the existing `registerTaggerHandlers` function (lines 180-340).

**New handler registration shape** (copy from existing handlers, e.g. `TaggerSaveEdit` lines 205-228):
```typescript
// Add inside registerTaggerHandlers, after existing handlers.
// tagger:apply-writes — invoke → starts the batch, streams events via push.
ipcMain.handle(
  IpcChannels.TaggerApplyWrites,
  async (_e: IpcMainInvokeEvent): Promise<ApplyResult> => {
    const root = settingsRepo.get(ROOT_FOLDER_KEY)
    if (root === null) {
      throw new Error(IpcChannels.TaggerApplyWrites + ': rootFolder not set')
    }
    // Delegate to applyController — it reads the queue, iterates, pushes events.
    return applyController.applyPendingWrites()
  }
)

// tagger:pending-count — invoke → number (drives the Appliquer badge).
ipcMain.handle(
  IpcChannels.TaggerPendingCount,
  async (): Promise<number> => {
    return taggerRepo.listPendingWrites().length
  }
)
```

**Security gate reuse** (`src/main/ipc/tagger.ts` lines 43-57):
```typescript
// resolvesUnderRoot and assertAudioExt are already defined in this file.
// The apply-writes handler reads file paths from the DB (trusted source),
// but should still apply resolvesUnderRoot per-file before writing as
// defence-in-depth (V4 access control — T-4-01 carry-forward).
// The validators assertOptionalText / assertOptionalBpm / assertOptionalRating
// are already imported via assertSaveEditInput — reuse them if re-validating
// DB values (belt-and-suspenders, low overhead).
```

**RegisterTaggerHandlersOpts extension** (lines 163-172):
```typescript
// Add applyController to the opts interface:
export interface RegisterTaggerHandlersOpts {
  ipcMain: IpcMain
  taggerRepo: TaggerRepo
  scanRepo: ScanRepo
  settingsRepo: SettingsRepo
  resolveFfmpegPath: () => string
  applyController: ApplyController    // NEW — injected from main/index.ts
  getSender: () => WebContents | null // NEW — needed for the push channel sender
  now?: () => number
}
```

---

### `src/shared/ipc-types.ts` (EXTEND — channel registry + types)

**Analog:** itself — the `IpcChannels` const block (lines 8-49) and the `CrateKeeperTaggerApi` interface (lines 250-262).

**Channel addition pattern** (`src/shared/ipc-types.ts` lines 42-48):
```typescript
// Add to the IpcChannels const after the Phase 4 tagger entries:
// Phase 5 — tag writer namespace.
TaggerApplyWrites: 'tagger:apply-writes',   // invoke → ApplyResult
TaggerPendingCount: 'tagger:pending-count', // invoke → number
TaggerWriteEvent: 'tagger:write-event'      // main→renderer push (on())
```

**TagWriteEvent discriminated union** (follow `ConversionEvent` shape, lines 119-138):
```typescript
export type TagWriteEvent =
  | { type: 'fileDone'; filePath: string; ok: true }
  | { type: 'fileDone'; filePath: string; ok: false; error: string }
  | { type: 'done'; totalWritten: number; totalFailed: number }

export interface ApplyResult {
  totalWritten: number
  totalFailed: number
}
```

**CrateKeeperTaggerApi extension** (lines 250-262):
```typescript
// Add two methods to the existing interface:
export interface CrateKeeperTaggerApi {
  // ... existing methods ...
  applyWrites(): Promise<ApplyResult>                      // NEW
  getPendingCount(): Promise<number>                       // NEW
  onWriteEvent(cb: (e: TagWriteEvent) => void): () => void // NEW push
}
```

---

### `src/preload/index.ts` (EXTEND — bridge)

**Analog:** itself — the `tagger` object literal (lines 55-72).

**New bridge entries** (copy shape of `conversion.onEvent`, lines 47-53):
```typescript
// Add to the tagger: { ... } object literal:
applyWrites: (): Promise<ApplyResult> =>
  ipcRenderer.invoke(IpcChannels.TaggerApplyWrites),
getPendingCount: (): Promise<number> =>
  ipcRenderer.invoke(IpcChannels.TaggerPendingCount),
onWriteEvent: (cb: (e: TagWriteEvent) => void) => {
  const handler = (_: unknown, e: TagWriteEvent): void => cb(e)
  ipcRenderer.on(IpcChannels.TaggerWriteEvent, handler)
  return () => {
    ipcRenderer.off(IpcChannels.TaggerWriteEvent, handler)
  }
}
```

---

### `src/renderer/src/store/useTaggerStore.ts` (EXTEND — store, event-driven)

**Analog:** `src/renderer/src/store/useConversionStore.ts` — the `startBatch` action + `subscribeEvents` lifecycle (lines 186-244).

**New state fields** (follow `useConversionStore` INITIAL pattern, lines 104-115):
```typescript
// Add to the TaggerState interface and INITIAL object:
isApplying: boolean           // guards the button, shows spinner
applyResult: ApplyResult | null
applyError: string | null
writeResults: Map<string, { ok: boolean; error?: string }>  // per-file feedback
```

**applyWrites action** (mirrors `startBatch`, lines 186-221):
```typescript
async applyWrites(): Promise<void> {
  if (get().isApplying) return
  // Subscribe to per-file events BEFORE invoking (same order as resumeBatch).
  const unsub = window.crateKeeper.tagger.onWriteEvent((e) => {
    if (e.type === 'fileDone') {
      set((s) => {
        const next = new Map(s.writeResults)
        next.set(e.filePath, e.ok ? { ok: true } : { ok: false, error: e.error })
        return { writeResults: next }
      })
    }
    if (e.type === 'done') {
      set({ isApplying: false, applyResult: { totalWritten: e.totalWritten, totalFailed: e.totalFailed } })
      unsub()
    }
  })
  set({ isApplying: true, applyError: null, applyResult: null, writeResults: new Map() })
  try {
    await window.crateKeeper.tagger.applyWrites()
  } catch (err) {
    unsub()
    const message = err instanceof Error ? err.message : 'Erreur inconnue'
    set({ isApplying: false, applyError: message })
  }
}
```

**Immutability discipline** (`src/renderer/src/store/useConversionStore.ts` lines 128-157):
```typescript
// EVERY Map update creates a new Map — never mutate in-place.
// Follows the existing set((s) => { const next = new Map(s.x); ... return { x: next } }) pattern.
// Boolean/scalar fields can be set directly: set({ isApplying: false })
```

---

### `src/renderer/src/components/tagger/ApplyBanner.tsx` (NEW — component, request-response)

**Analog:** `src/renderer/src/components/convertir/ResumeBanner.tsx` (entire file, 67 lines).

**Component shape** (lines 15-67 of `ResumeBanner.tsx`):
```tsx
// ResumeBanner renders null when nothing to show — same pattern for ApplyBanner.
export function ApplyBanner(): React.JSX.Element | null {
  const pendingCount = /* derived from useTaggerStore pendingEdits filtered by appliedAt */
  const isApplying = useTaggerStore((s) => s.isApplying)
  const applyResult = useTaggerStore((s) => s.applyResult)
  const applyError = useTaggerStore((s) => s.applyError)

  if (pendingCount === 0 && applyResult === null && !isApplying) return null

  function handleApply(): void {
    void useTaggerStore.getState().applyWrites()
  }

  return (
    <section
      className="apply-banner"
      role="region"
      aria-label="Tags en attente d'écriture"
    >
      {/* French copy: "N tags en attente", "Appliquer", "En cours…", result summary */}
      {/* Per-file error feedback from writeResults map (badge pattern from ConversionProgress) */}
    </section>
  )
}
```

**Status label pattern** (`src/renderer/src/components/convertir/ConversionProgress.tsx` lines 24-58):
```tsx
// Borrow the badge + statusLabel approach — adapt for ok/error binary state:
// ok: true  → class "apply-banner__badge--done"   → "Écrit"
// ok: false → class "apply-banner__badge--error"  → "Erreur"
// French copy for summary: "N écrits, N erreurs"
```

**Button disabled/loading pattern** (`src/renderer/src/components/convertir/ConvertirView.tsx` — check for isRunning analog):
```tsx
<button
  type="button"
  className="apply-banner__cta"
  onClick={handleApply}
  disabled={isApplying || pendingCount === 0}
  aria-busy={isApplying}
>
  {isApplying ? 'Écriture…' : `Appliquer (${pendingCount})`}
</button>
```

---

### `src/main/tagger/tagWriter.test.ts` (NEW — test, file-I/O)

**Analog:** `src/main/conversion/tagRoundtrip.test.ts` (entire file, 157 lines) — exact structural match.

**Test file structure** (lines 1-47 of `tagRoundtrip.test.ts`):
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { parseFile } from 'music-metadata'

// Fixture directory (already populated — untagged.mp3, tagged-rekordbox.mp3, tagged.m4a)
const FIXTURES = path.join(__dirname, '..', 'workers', '__fixtures__')
const ffmpegPath = ffmpegStatic as unknown as string | null
const suite = ffmpegPath ? describe : describe.skip  // skip if no binary

suite('tagWriter round-trip', () => {
  let tmpdir: string
  beforeEach(() => { tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), 'ck-tagwrite-')) })
  afterEach(() => { fs.rmSync(tmpdir, { recursive: true, force: true }) })

  it('MP3: writes ID3v2.3 (not v2.4) — Rekordbox compat', async () => {
    // ... copy fixture to tmpdir, call writeMp3Tags, parseFile, assert
    const meta = await parseFile(outputPath)
    expect(meta.format.tagTypes).toContain('ID3v2.3')  // NOT 'ID3v2.4'
  }, 30_000)
})
```

**Round-trip assertion pattern** (`src/main/conversion/tagRoundtrip.test.ts` lines 49-70):
```typescript
// After writing, read back with parseFile and assert common fields.
const meta = await parseFile(out)
expect(meta.common.genre ?? []).toContain('House')
expect(meta.common.bpm).toBe(128)          // number, not string
expect(meta.common.key).toBe('8A')         // Camelot
expect(meta.common.title).toBe('Test Title')
expect(meta.common.artist).toBe('Test Artist')

// POPM assertion (ID3v2.3 native frames — not available in common.*):
const id3Native = meta.native['ID3v2.3'] ?? []
const popm = id3Native.find(f => f.id === 'POPM')
expect(popm?.value?.rating).toBe(204)  // 4 stars → 204 (LOCKED mapping)
```

**Non-destructive test** (new — no analog exists yet):
```typescript
it('MP3: does NOT overwrite existing frames for null fields (D-04)', async () => {
  // Arrange: copy a pre-tagged fixture with known album + track-number
  // Act: writeMp3Tags with only { genre: 'House' } — other fields null
  // Assert: parseFile shows genre='House' AND original album is still present
  const meta = await parseFile(out)
  expect(meta.common.genre ?? []).toContain('House')
  expect(meta.common.album).toBe('Original Album')  // must survive
})

it('MP3: original file untouched if write fails (TAGS-02)', async () => {
  // Arrange: create an unwritable temp path scenario or mock node-id3 to throw
  // Act: call writeMp3Tags expecting it to throw
  // Assert: original file bytes unchanged (compare checksums or stat)
})
```

---

## Shared Patterns

### Security: resolvesUnderRoot + AUDIO_EXTS gate
**Source:** `src/main/ipc/tagger.ts` lines 43-57
**Apply to:** `src/main/ipc/tagger.ts` new `TaggerApplyWrites` handler; `applyController.ts` per-file path check
```typescript
// Already defined in tagger.ts — reuse without copy.
function resolvesUnderRoot(filePath: string, rootFolder: string): boolean {
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(rootFolder)
  return (
    resolvedFile === resolvedRoot ||
    resolvedFile.startsWith(resolvedRoot + path.sep)
  )
}
// Gate: if (!resolvesUnderRoot(edit.filePath, root)) skip/error — never write
```

### ffmpeg Binary Resolution
**Source:** `src/main/conversion/ffmpegPath.ts` (entire file, 28 lines)
**Apply to:** `src/main/tagger/tagWriter.ts` (MP4 write path), `src/main/index.ts` (controller wiring)
```typescript
// Import and call exactly as done for waveform in Phase 4:
// resolveFfmpegPath({ rawPath: ffmpegStatic, isPackaged: app.isPackaged })
// Pass the resolved string as a parameter — never resolve inside tagWriter itself.
```

### Prepared Statement SQL (no template literals)
**Source:** `src/main/tagger/taggerRepo.ts` lines 122-169
**Apply to:** `src/main/tagger/taggerRepo.ts` new `listPendingWritesStmt` and `markAppliedStmt`
```typescript
// LOCKED project rule: all SQLite access via db.prepare() + .run()/.get()/.all().
// No string interpolation with user values (V5 defence, T-4-06).
// Named params use @field; positional use ?.
```

### Zustand Immutability
**Source:** `src/renderer/src/store/useConversionStore.ts` lines 128-145 (handleEvent)
**Apply to:** `src/renderer/src/store/useTaggerStore.ts` new `applyWrites` action + `writeResults` Map updates
```typescript
// Every Map update creates a new Map instance:
set((s) => {
  const next = new Map(s.writeResults)
  next.set(filePath, { ok })
  return { writeResults: next }
})
// Never: s.writeResults.set(...) — mutates in place.
```

### IPC Handler Registration Shape
**Source:** `src/main/ipc/tagger.ts` lines 184-229 (ipcMain.handle blocks)
**Apply to:** new `TaggerApplyWrites` and `TaggerPendingCount` handlers in same file
```typescript
ipcMain.handle(
  IpcChannels.TaggerApplyWrites,
  async (_e: IpcMainInvokeEvent): Promise<ApplyResult> => {
    // rootFolder null-check first (same guard as all existing handlers)
    const root = settingsRepo.get(ROOT_FOLDER_KEY)
    if (root === null) throw new Error(IpcChannels.TaggerApplyWrites + ': rootFolder not set')
    return applyController.applyPendingWrites()
  }
)
```

### Push Channel Sender (main → renderer)
**Source:** `src/main/ipc/conversion.ts` lines 345-354 (`makeConversionSender`)
**Apply to:** `src/main/tagger/applyController.ts` injected `send` dep; new `makeTaggerWriteSender` in `src/main/ipc/tagger.ts`
```typescript
// Pattern: getSender returns WebContents | null; guard against destroyed.
export function makeTaggerWriteSender(getSender: () => WebContents | null) {
  return (channel: string, payload: TagWriteEvent): void => {
    const wc = getSender()
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  }
}
```

### French Copy
**Source:** `src/main/ipc/conversion.ts` line 149; `src/renderer/src/store/useConversionStore.ts` lines 215, 219
**Apply to:** all user-facing error messages and UI labels
```typescript
// Error messages: 'Un lot est déjà en cours', 'rootFolder non configuré'
// UI labels: 'Appliquer (N)', 'Écriture…', 'N tags en attente', 'Écrit', 'Erreur'
// Counts: `${n} écrits, ${m} erreurs`
```

### Main Index Wiring Pattern
**Source:** `src/main/index.ts` lines 177-188 (Phase 4 tagger wiring block)
**Apply to:** Phase 5 block to be added after the existing Phase 4 block
```typescript
// Phase 5: Tag Writer backbone.
const taggerWriteSend = makeTaggerWriteSender(() => mainWindow?.webContents ?? null)
const applyController = createApplyController({
  taggerRepo: getTaggerRepo(),
  writeMp3Tags,
  writeMp4Tags,
  ffmpegBinaryPath: resolveFfmpegPath({ rawPath: ffmpegStatic, isPackaged: app.isPackaged }),
  send: taggerWriteSend
})
// (registerTaggerHandlers call already exists — add applyController + getSender to opts)
```

---

## No Analog Found

All files in Phase 5 have a close match. The only genuinely new pattern is the atomic temp+rename write for MP3 (no existing in-place file write exists in the codebase; all current file writes go through ffmpeg which writes a new output file). The pattern is fully specified in RESEARCH.md and can be implemented without a codebase analog.

| File segment | Role | Reason no direct analog |
|---|---|---|
| `writeMp3Tags` body in `tagWriter.ts` | file-I/O | node-id3 is new to the project; atomic temp+rename around NodeID3.update() is a new pattern |
| Non-destructive / crash-safety tests in `tagWriter.test.ts` | test | No existing test covers in-place file write atomicity |

---

## Metadata

**Analog search scope:** `src/main/`, `src/renderer/src/`, `src/shared/`, `src/preload/`
**Files scanned:** 52 source files
**Pattern extraction date:** 2026-06-15
