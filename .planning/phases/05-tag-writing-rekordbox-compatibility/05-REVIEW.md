---
phase: 05-tag-writing-rekordbox-compatibility
reviewed: 2026-06-16T00:00:00Z
depth: standard
files_reviewed: 21
files_reviewed_list:
  - src/main/index.ts
  - src/main/ipc/tagger.ts
  - src/main/ipc/tagger.test.ts
  - src/main/tagger/applyController.ts
  - src/main/tagger/applyController.test.ts
  - src/main/tagger/tagWriter.ts
  - src/main/tagger/tagWriter.test.ts
  - src/main/tagger/taggerRepo.ts
  - src/main/tagger/taggerRepo.test.ts
  - src/preload/index.ts
  - src/shared/ipc-types.ts
  - src/renderer/src/store/useTaggerStore.ts
  - src/renderer/src/store/useTaggerStore.test.ts
  - src/renderer/src/components/tagger/ApplyBanner.tsx
  - src/renderer/src/components/tagger/ApplyBanner.test.tsx
  - src/renderer/src/components/tagger/tagger.css
  - src/renderer/src/views/TaggerView.tsx
  - src/renderer/src/views/TaggerView.test.tsx
  - src/renderer/src/views/__tests__/TaggerEndToEnd.test.tsx
  - package.json
findings:
  critical: 3
  warning: 7
  info: 5
  total: 15
status: blockers_resolved
blockers_resolved_in: 58e6ea5
resolution_note: "All 3 BLOCKERs (CR-01, CR-02, CR-03) fixed with regression tests in 58e6ea5. WR-* warnings and IN-* info remain open (deferred by user — blockers-only scope)."
---

# Phase 5: Code Review Report

**Reviewed:** 2026-06-16
**Depth:** standard
**Files Reviewed:** 21
**Status:** blockers_resolved (3 BLOCKERs fixed in `58e6ea5`; warnings/info deferred)

> **Resolution (2026-06-16, commit `58e6ea5`):**
> - **CR-01** — fixed: the apply-writes IPC handler now passes only
>   `filterWritableEdits`-approved rows to the controller, which takes a
>   pre-validated edit list instead of re-reading the DB raw. Regression test
>   added (load-bearing filter, T-05-PT / T-05-IV).
> - **CR-02** — fixed: control characters rejected at the IPC boundary
>   (`assertOptionalText`) and stripped from ffmpeg `-metadata` values
>   (`ffmpegMetaValue`). Regression test added.
> - **CR-03** — fixed: single-active guard is now instance-scoped and released
>   via `finally`. Regression test added (cross-instance isolation).
>
> Warnings (WR-01..07) and Info (IN-01..05) were intentionally deferred to a
> follow-up (blockers-only scope). WR-03 (main-thread blocking) and WR-02/WR-04
> (count/UI reconciliation) are the highest-value remaining items.

## Summary

This phase implements the tag-writing backbone: an atomic temp+rename write
strategy (`tagWriter.ts`), a per-file-isolated batch controller
(`applyController.ts`), a secured IPC surface (`ipc/tagger.ts`), and the
"Appliquer" React UI. The temp+rename atomicity and the per-file retry isolation
are correctly designed and well tested. The MP3 / MP4 round-trip integration
tests are genuinely valuable.

However, adversarial review surfaces **three BLOCKER-class defects** in exactly
the areas the phase brief flagged as high-risk:

1. **The IPC path-traversal / extension security gate is decorative** — the
   computed `filterWritableEdits` result is thrown away, and the write controller
   reads paths straight from the DB with no path or extension validation. A DB
   row pointing outside `rootFolder` (or at a non-audio file) is written to disk.
2. **ffmpeg `-metadata` arguments are built by string interpolation of
   user-controlled tag values**, enabling ffmpeg-option/metadata injection.
3. **The single-active guard is a module-level singleton shared across every
   controller instance**, and it is never released if `listPendingWrites()`
   throws before the try block — a thrown read permanently wedges the apply
   surface for the process lifetime.

Plus a `.mp4` extension-allowlist mismatch that makes `.mp4` files unwritable
through the gated path while remaining reachable as dead/inconsistent logic, and
several robustness and quality issues below.

## Critical Issues

### CR-01: IPC apply-writes security gate is a no-op — out-of-root / non-audio DB paths reach the write layer

**File:** `src/main/ipc/tagger.ts:373-398`, `src/main/tagger/applyController.ts:62-72`
**Issue:**
The `tagger:apply-writes` handler computes the security filter but discards it:

```ts
const pending = taggerRepo.listPendingWrites()
const safe = filterWritableEdits(pending, root)
if (safe.length !== pending.length) {
  // ...comment only — no action...
}
return applyController.applyPendingWrites()   // controller re-reads the DB raw
```

`applyController.applyPendingWrites()` then calls `deps.taggerRepo.listPendingWrites()`
itself (`applyController.ts:63`) and writes every returned row with **no**
`resolvesUnderRoot` check and **no** extension allowlist check. The `safe` list is
never passed anywhere. The inline comment even admits "The controller still reads
from the DB directly, so no further action is needed here" — which is precisely the
bug: the gate guards nothing.

Threat: a `pending_tag_edits` row whose `file_path` resolves outside `rootFolder`
(e.g. a stale row from a previous root, or a row written before a root change) is
handed to `writeMp3Tags` / `writeMp4Tags`, which copy/rename/remux over that
absolute path. This defeats T-05-PT (path traversal) and T-05-IV (input
validation) entirely. The `filterWritableEdits` unit tests pass, but the function
is dead in the actual call path.

**Fix:** Push the filter into the write path so it is load-bearing. Either pass the
filtered list to the controller, or (cleaner) make the controller validate each row
before writing. Minimal main-side fix:

```ts
// applyController deps: add rootFolder + a path/ext guard
for (const edit of pending) {
  if (!isWritableUnderRoot(edit.filePath, deps.rootFolder)) {
    totalFailed++
    deps.send(IpcChannels.TaggerWriteEvent, {
      type: 'fileDone', filePath: edit.filePath, ok: false,
      error: 'rejeté: hors du dossier racine ou extension non autorisée'
    })
    continue
  }
  // ...existing write...
}
```

and have the controller receive `rootFolder` from `registerTaggerHandlers`
(it already reads `settingsRepo.get(ROOT_FOLDER_KEY)`). Do not rely on a gate whose
result is discarded.

### CR-02: ffmpeg `-metadata` values built via string interpolation — metadata/option injection

**File:** `src/main/tagger/tagWriter.ts:155-177`
**Issue:**
MP4 tag values are concatenated directly into ffmpeg arguments:

```ts
if (input.artist != null) metaFlags.push('-metadata', `artist=${input.artist}`)
if (input.title  != null) metaFlags.push('-metadata', `title=${input.title}`)
if (input.genre  != null) metaFlags.push('-metadata', `genre=${input.genre}`)
if (input.comment!= null) metaFlags.push('-metadata', `comment=${input.comment}`)
```

`spawnSync(binary, args)` (no shell) means classic shell injection is not the
vector — but the `key=value` string itself is attacker-influenced. A value
beginning with `=` or containing `=` lets the user redefine which metadata key is
written, and a value that ffmpeg parses as a directive can corrupt the metadata
map. More importantly, the IPC validator (`assertOptionalText`, `ipc/tagger.ts:82-98`)
caps length at 500 chars but performs **no character validation** — newlines,
`=`, and ffmpeg metadata escape sequences (`\`, `;`, `#`) all pass through into the
`key=value` token. ffmpeg's metadata parser treats `\` and `;` specially, so a
crafted `artist` value can inject or terminate adjacent metadata entries and write
arbitrary atoms. This is the "ffmpeg argument construction" risk called out in the
brief, and it is unmitigated.

**Fix:** Do not interpolate untrusted values into `key=value`. Sanitize/escape per
ffmpeg metadata rules, or avoid the value-in-arg form. Safest: escape the ffmpeg
metadata special characters before building the token, and reject control
characters at the IPC boundary:

```ts
function ffmpegMetaValue(v: string): string {
  // ffmpeg metadata: escape \ ; # = and strip CR/LF
  return v.replace(/[\\;#=\n\r]/g, (c) => (c === '\n' || c === '\r' ? ' ' : '\\' + c))
}
metaFlags.push('-metadata', `artist=${ffmpegMetaValue(input.artist)}`)
```

and add a control-character / newline rejection to `assertOptionalText`. The same
applies to MP3: while `node-id3` does not shell out, the IPC layer should still
reject control characters in tag text.

### CR-03: Single-active guard is a cross-instance module singleton and leaks on a pre-loop throw

**File:** `src/main/tagger/applyController.ts:43, 55-108`
**Issue:**
`isRunning` is a module-level `let` (`applyController.ts:43`), not per-instance
state. Every `ApplyController` created by `createApplyController` shares it. That is
incidental here (one instance in `index.ts`) but is a latent correctness trap: any
second controller, and every test file that constructs a controller, mutates the
same global — the existing test suite only passes because it runs sequentially.

The harder bug: the guard is set inside `applyPendingWrites` but the `try/finally`
that clears it begins **after** `listPendingWrites()`:

```ts
if (isRunning) throw new Error('Un lot est déjà en cours')
isRunning = true
let totalWritten = 0
let totalFailed = 0
try {
  const pending = deps.taggerRepo.listPendingWrites()  // if THIS throws...
  ...
} finally {
  isRunning = false
}
```

`listPendingWrites()` is the first statement *inside* the try, so a throw there is
caught by `finally` — that part is fine. But `isRunning = true` is set *before* the
try; if any synchronous work between `isRunning = true` and `try` ever throws
(today none does, but the ordering is fragile), the flag is never reset and the
apply surface is permanently wedged for the process lifetime — the only recovery is
an app restart. There is no test covering "the read throws". Combined with the
module-level scope, a single failed batch can dead-lock all future applies.

**Fix:** Make the guard instance-scoped and move `isRunning = true` inside the try
(or wrap the whole body):

```ts
export function createApplyController(deps: ApplyControllerDeps): ApplyController {
  let isRunning = false   // per-instance
  return {
    async applyPendingWrites() {
      if (isRunning) throw new Error('Un lot est déjà en cours')
      isRunning = true
      try {
        // all work, including listPendingWrites()
      } finally {
        isRunning = false
      }
    }
  }
}
```

## Warnings

### WR-01: `.mp4` extension mismatch — gated path can never write `.mp4`, controller path can

**File:** `src/main/workers/scanCore.ts:13-23`, `src/main/tagger/tagWriter.ts:43`, `src/main/ipc/tagger.ts:54-59`
**Issue:** `AUDIO_EXTS` does **not** include `.mp4`, but `getWriteStrategy`
(`tagWriter.ts:72-77`) treats `.mp4` as a writable MP4 target via
`MP4_EXTS = new Set(['.m4a', '.aac', '.mp4'])`. Consequences:
- A `.mp4` file can never be saved through `tagger:save-edit` (the `assertAudioExt`
  gate rejects it) — so it never becomes a pending edit normally.
- But `getWriteStrategy('/x.mp4')` returns `'mp4'`, so if a `.mp4` row ever exists
  in the DB, the controller (which does not gate extensions — see CR-01) will remux
  it. The two notions of "supported audio extension" disagree.
This is both a latent correctness inconsistency and an amplifier for CR-01.
**Fix:** Make the two sets agree. Either add `.mp4` to `AUDIO_EXTS` (if MP4 video
containers should be taggable) or remove `.mp4` from `MP4_EXTS` (if not). Whichever
is chosen, the write strategy and the IPC allowlist must reference the same source
of truth.

### WR-02: `getPendingCount` / `listPendingWrites` have no path or extension gate — badge count diverges from writable count

**File:** `src/main/ipc/tagger.ts:403-408`, `src/main/tagger/taggerRepo.ts:190-193`
**Issue:** `tagger:pending-count` returns `taggerRepo.listPendingWrites().length`
with no `filterWritableEdits`. The UI badge ("Appliquer (N)") therefore counts rows
that, once CR-01 is fixed, will be rejected at write time — the count will never
reach zero for poisoned/out-of-root rows, and the "N écrits, N erreurs" summary
will not reconcile with the badge. Even today the count includes `unsupported`
extensions (e.g. `.flac`) that always fail, so the badge over-reports.
**Fix:** Apply the same writable filter to the count source so the badge reflects
what `applyPendingWrites` will actually attempt, and surface unsupported/rejected
rows distinctly rather than as a perpetually non-decrementing pending count.

### WR-03: `spawnSync` + synchronous `NodeID3.update` block the Electron main process during the whole batch

**File:** `src/main/tagger/tagWriter.ts:120, 180`, `src/main/tagger/applyController.ts:55-109`
**Issue:** Both writers are fully synchronous on the main thread:
`NodeID3.update()` (`tagWriter.ts:120`) and `spawnSync(ffmpegBinaryPath, ...)`
(`tagWriter.ts:180`). The controller awaits them sequentially. For a batch of
"quelques milliers de fichiers" (per CLAUDE.md), each `spawnSync` ffmpeg remux can
take hundreds of ms to seconds, fully blocking the main process event loop — IPC,
window paints, and the `makeTaggerWriteSender` pushes themselves are stalled until
each file completes. The project constraints explicitly require batch work to be
"non-bloquantes (worker threads)"; scan and conversion already use worker threads,
but tag writing runs inline on main. The per-file `fileDone` events cannot actually
stream to the renderer in real time because the loop never yields between blocking
calls.
**Fix:** Move the write loop into a worker thread (mirroring scan/conversion
controllers, which the file headers claim to mirror), or at minimum use the async
`spawn`/`execFile` + `NodeID3.update` async callback so the event loop yields
between files and progress events flush.

### WR-04: `writeResults` accumulates across batches and never decrements — stale per-file rows persist in the banner

**File:** `src/renderer/src/store/useTaggerStore.ts:158-196`, `src/renderer/src/components/tagger/ApplyBanner.tsx:75-97`
**Issue:** `writeResults` is reset to a new Map only at the *start* of `applyWrites`
(`useTaggerStore.ts:187`). After a batch finishes, the map persists and the banner
renders one `<li>` per entry indefinitely (`ApplyBanner.tsx:77`). The banner's
render guard (`pendingWriteCount === 0 && applyResult === null && !isApplying`,
`ApplyBanner.tsx:30`) keeps the banner mounted whenever `applyResult` is non-null,
so after a large batch the user sees an unbounded list of every file written, with
no clear/dismiss affordance. There is also no reset on view navigation. This is a
UX/maintainability defect, and for a few-thousand-file batch it is a large
ever-growing DOM list.
**Fix:** Clear `writeResults`/`applyResult` when the banner is dismissed or when the
queue/view changes, cap the rendered list length, and provide a "Fermer" control.

### WR-05: `runWithSlide` waits on `transitionend` with no timeout — a missed event hangs the card permanently

**File:** `src/renderer/src/views/TaggerView.tsx:98-121`
**Issue:** `runWithSlide` adds the exit class and then `await`s a Promise that only
resolves on a `transitionend` event:

```ts
await new Promise<void>((resolve) => {
  if (el === null) { resolve(); return }
  const onEnd = () => { el.removeEventListener('transitionend', onEnd); resolve() }
  el.addEventListener('transitionend', onEnd)
})
await action()
```

If the CSS transition is interrupted, the element is removed, `prefers-reduced-motion`
disables the transition, or the property does not actually change, `transitionend`
never fires — the `await` never resolves, `action()` (keep/skip/undo) is never
called, and the card is stuck mid-slide with no recovery. Tests dispatch
`transitionend` manually so they never exercise the missing-event path.
**Fix:** Race the listener against a timeout fallback (e.g. transition duration +
buffer, ~300ms) so the action always runs:

```ts
await Promise.race([
  new Promise<void>((res) => el?.addEventListener('transitionend', () => res(), { once: true })),
  new Promise<void>((res) => setTimeout(res, 300))
])
```

### WR-06: ffmpeg failure leaves stderr unbounded into the error string; non-zero `status` may be `null` on signal kill

**File:** `src/main/tagger/tagWriter.ts:180-191`
**Issue:** `if (result.status !== 0)` treats a signal-killed process specially:
when ffmpeg is killed by a signal, `spawnSync` returns `status === null` and
populates `result.signal`/`result.error`. `null !== 0` is true so it enters the
branch, but the thrown message is `ffmpeg exited null: ...` with no signal context,
and `result.error` (e.g. ENOENT when the binary path is wrong) is never surfaced —
a missing ffmpeg binary yields a confusing "exited null" rather than "binary not
found". The original file is correctly left intact (good), but the diagnostics are
poor and an `result.error` (spawn failure) is silently swallowed into the generic
branch only if `status` happens to be non-zero/null.
**Fix:** Check `result.error` first and include `result.signal`:

```ts
if (result.error) throw result.error
if (result.status !== 0) {
  throw new Error(
    `ffmpeg failed (status=${result.status}, signal=${result.signal}): ` +
    (result.stderr?.slice(-500) ?? '(no stderr)')
  )
}
```

### WR-07: `markApplied` reuses one `now()` for the whole batch — re-edits during a long batch are silently marked applied

**File:** `src/main/tagger/applyController.ts:79`, `src/main/tagger/taggerRepo.ts:190-198`
**Issue:** The re-edit predicate is `applied_at IS NULL OR updated_at > applied_at`
(`taggerRepo.ts:192`). The controller marks each file with `now()`
(`applyController.ts:79`). Because WR-03 makes the batch fully synchronous on main,
no concurrent edit can land mid-batch *today*, so this is latent — but if the write
loop is moved off-thread (WR-03 fix) or made async, a user re-edit that lands after
`updated_at` was read but before `markApplied(now)` runs will get `applied_at >=
updated_at` and be incorrectly considered "written", dropping the re-edit. The
controller reads the row once (`listPendingWrites` snapshot) and marks applied with
a later timestamp, with no re-check of `updated_at` at mark time.
**Fix:** When async/threaded, re-read `updated_at` at mark time and only set
`applied_at` if the row was not re-edited since the write started, or capture the
per-row `updatedAt` from the snapshot and pass it to a conditional
`markAppliedIfUnchanged(filePath, snapshotUpdatedAt, now)`.

## Info

### IN-01: `console.error` used as the preload error channel

**File:** `src/preload/index.ts:94`
**Issue:** `console.error(error)` in the contextBridge failure path. Project rules
discourage bare `console.*` in production code. Minor — this is a genuine
last-resort bootstrap error path with no logger available in preload.
**Fix:** Acceptable as-is, or route through a minimal preload-safe logger. Document
the exception.

### IN-02: Dead/decorative code block left in the IPC handler

**File:** `src/main/ipc/tagger.ts:390-395`
**Issue:** The `if (safe.length !== pending.length) { ...comments only... }` block
contains no executable statements — it is a no-op `if` wrapping three comment lines.
Beyond the CR-01 security impact, an empty conditional is dead code that misleads
readers into thinking a gate runs.
**Fix:** Remove once CR-01 is fixed by making the filter load-bearing.

### IN-03: `basename` reimplemented in the renderer instead of reusing a shared helper

**File:** `src/renderer/src/components/tagger/ApplyBanner.tsx:18-21`
**Issue:** A hand-rolled `basename` (handles `/` and `\`) is defined inline. The
codebase parses paths in several places; a shared util would avoid drift (e.g. it
does not handle a trailing slash). Low priority for a display-only function.
**Fix:** Extract to a shared `pathUtils` helper if basename logic appears elsewhere.

### IN-04: POPM `counter: 0` and fixed email are reasonable but undocumented as a Rekordbox assumption

**File:** `src/main/tagger/tagWriter.ts:103-109`
**Issue:** `popularimeter.counter: 0` and a synthetic `POPM_EMAIL =
'rating@cratekeeper'` are written. Rekordbox's POPM rating read can be
email-identifier sensitive; the round-trip test only re-reads via music-metadata,
not Rekordbox. The phase brief itself flags POPM→Rekordbox as a manual-verification
item (E2E test comment SC #3), so this is acknowledged, not missed.
**Fix:** None needed in code; ensure the manual Rekordbox POPM check is gated before
shipping (it currently lives only as a comment in the E2E test).

### IN-05: `assertOptionalRating` accepts `number` but the IPC contract allows float ratings to slip if `ALLOWED_RATINGS` membership is the only check

**File:** `src/main/ipc/tagger.ts:115-121`
**Issue:** `assertOptionalRating` checks `ALLOWED_RATINGS.has(v)` where the set is
`{1,2,3,4,5}`. `Set.has` uses SameValueZero, so `4.0` passes (fine) but the function
does not assert `Number.isInteger`, relying entirely on set membership. This is
currently safe because only exact integers are in the set, but it is less defensive
than `assertOptionalBpm` (which does check `Number.isInteger`). Minor consistency
gap.
**Fix:** Add `Number.isInteger(v)` for symmetry with the BPM validator, or document
that set-membership is the intended sole check.

---

_Reviewed: 2026-06-16_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
