---
phase: 04-tagger-core
plan: 02
subsystem: tagger
tags: [tagger, renderer, ui, zustand, react, keyboard, animation]
requires:
  - 04-01 (taggerRepo + tagger:* IPC + cratekeeper:// protocol)
  - 02-01 (ScannedFile shape)
  - 03-02 (useConversionStore immutability pattern)
provides:
  - useTaggerStore (queue + dirty edits + presets + mute + Keep/Skip)
  - useTaggerKeyboard (document keydown w/ input-focus gate)
  - useDebouncedCallback (substrate for Plan 04-03 session debounce)
  - TaggerCard composite + tagger.css (transform/opacity-only slide anim)
  - AudioPreview (cratekeeper:// + 30s loop + AIFF fallback)
  - GenrePresetBar / RatingStars / ArtistTitleSplit
  - splitDetection.suggestSplits pure helper
  - TaggerView shell (empty/loading/active/end + slide orchestration)
affects:
  - src/renderer/index.html (CSP media-src extension)
tech_stack:
  added: []
  patterns:
    - Zustand immutable Map mutation (mirrors useConversionStore discipline)
    - transform/opacity-only CSS animation (web/performance.md)
    - document.activeElement input-focus gate for global hotkeys
    - cratekeeper:// audio URL = 'cratekeeper://audio/' + encodeURIComponent(path)
key_files:
  created:
    - src/renderer/src/store/useTaggerStore.ts
    - src/renderer/src/store/useTaggerStore.test.ts
    - src/renderer/src/components/tagger/splitDetection.ts
    - src/renderer/src/components/tagger/splitDetection.test.ts
    - src/renderer/src/hooks/useDebouncedCallback.ts
    - src/renderer/src/hooks/useTaggerKeyboard.ts
    - src/renderer/src/hooks/useTaggerKeyboard.test.ts
    - src/renderer/src/components/tagger/AudioPreview.tsx
    - src/renderer/src/components/tagger/AudioPreview.test.tsx
    - src/renderer/src/components/tagger/GenrePresetBar.tsx
    - src/renderer/src/components/tagger/GenrePresetBar.test.tsx
    - src/renderer/src/components/tagger/RatingStars.tsx
    - src/renderer/src/components/tagger/RatingStars.test.tsx
    - src/renderer/src/components/tagger/ArtistTitleSplit.tsx
    - src/renderer/src/components/tagger/ArtistTitleSplit.test.tsx
    - src/renderer/src/components/tagger/TaggerCard.tsx
    - src/renderer/src/components/tagger/TaggerCard.test.tsx
    - src/renderer/src/components/tagger/tagger.css
    - src/renderer/src/views/TaggerView.test.tsx
  modified:
    - src/renderer/src/views/TaggerView.tsx (full rewrite from placeholder)
    - src/renderer/index.html (CSP +media-src)
decisions:
  - TaggerCard receives onKeep/onSkip props so slide orchestration lives in TaggerView (single source of truth for the animation lifecycle; card stays pure)
  - useTaggerStore.setRating implements toggle behaviour (click N when current===N clears to null); component just emits the requested rating
  - tagger.muteEnabled setting persisted as string 'true'/'false' (settings:get returns string|null in the bridge contract; bool coercion lives in loadMuteSetting)
  - Slide animation wrapper is OUTSIDE the card so re-mount-on-advance (key={path}) works cleanly; animation hooks live on .tagger-card-wrapper not .tagger-card
  - mp3-style audio path in AudioPreview: cratekeeper://audio/ + encodeURIComponent(filePath) (Plan 04-01 protocol contract)
metrics:
  duration_minutes: ~12
  tasks_completed: 5
  tests_added: 75
  tests_total: 426
  completed_date: 2026-06-05
---

# Phase 4 Plan 02: Tagger Renderer Card UX Summary

One-liner: Renderer card UX vertical slice — useTaggerStore (queue + dirty edits + presets + mute + Keep/Skip), TaggerCard composite with all Rekordbox-relevant editable fields, AudioPreview via cratekeeper:// with 30s loop + AIFF fallback, document-level ←/→/1-9/M keyboard handler with input-focus gate, transform-only slide animation orchestrated by TaggerView, CSP unlocked for the custom protocol.

## What Shipped

### Pure helpers (substrate)
- `splitDetection.suggestSplits(title)` — detects LOCKED separators (' - ', ' -- ', ' – ') and returns two complementary {artist,title} options or null. Powers TAGG-08.
- `useDebouncedCallback(fn, ms)` — returns stable `{call, flush, cancel}` handle; collapses rapid calls to last args. Plan 04-03 will use it for `tagger:set-session` debouncing.

### Zustand store (TAGG-01 / TAGG-03..07 substrate)
- `useTaggerStore`: queue / currentIndex / dirtyEdits / pendingEdits / genrePresets / muteEnabled / status.
- `loadQueue` / `loadGenrePresets` / `loadMuteSetting` — Promise-all friendly mount lifecycle.
- `setDirtyEdit<K>(field, value)` — every call produces a new Map instance (immutability invariant verified by 3+ reference-inequality tests). Empty string → null normalisation.
- `applyPreset(slot)` — guards slot ∈ [1,9]; writes `genrePresets[slot-1]` into dirtyEdits.genre.
- `applySplit({artist, title})` — single-Map-instance two-field write for TAGG-08.
- `setRating(N)` — implements toggle (clicking the current rating clears to null).
- `setMute(bool)` + `toggleMute()` — persist via `settings:set('tagger.muteEnabled', ...)`.
- `keep()` — merges dirtyEdits over pendingEdits, calls `tagger:save-edit`, mirrors result into local `pendingEdits`, advances `currentIndex`, returns `{filePath, edit, prior}` snapshot (Plan 04-03 will use `prior` for undo).
- `skip()` — clears dirty edits for current file, advances index, no save call.

### useTaggerKeyboard hook (TAGG-03 / TAGG-04)
- Document-level keydown listener: ←=Keep, →=Skip, 1-9=Preset, Cmd/Ctrl-Z=Undo, Space=PlayPause, M/m=Mute.
- **Input-focus gate** (LOCKED): ignores ALL shortcuts when `document.activeElement` is `<input>`, `<textarea>`, or contentEditable — typing "1" in the BPM field does NOT trigger preset 1.
- Cleanup on unmount removes the document listener.

### AudioPreview (TAGG-02 + Pitfalls 3 & 6)
- `<audio src='cratekeeper://audio/<encoded>' loop preload='auto' muted={...} />`.
- 30s timeupdate-loop: `el.currentTime = 0` when `currentTime >= 30` (Pitfall 3 — HTML audio can't natively loop a sub-segment).
- AIFF fallback: detects `.aiff` / `.aif` (case-insensitive) and renders "Aperçu indisponible pour ce format" instead of `<audio>` (Pitfall 6 — Chromium AIFF support is unreliable cross-platform).
- jsdom safety: `el.play()` is guarded since jsdom's HTMLMediaElement.play returns undefined rather than a Promise.

### GenrePresetBar / RatingStars / ArtistTitleSplit
- `GenrePresetBar`: 9 buttons with slot-number hint + label; defensive against `presets.length < 9` mid-load.
- `RatingStars`: 5 buttons with French aria-labels ("1 étoile", "2 étoiles", …); component emits requested rating, store handles toggle.
- `ArtistTitleSplit`: renders nothing when artist non-empty OR no separator. Otherwise 2 clickable suggestions ("Artiste: X · Titre: Y").

### TaggerCard composite
- Layout: filename heading → parent path → AudioPreview → read-only chips → ArtistTitleSplit → 6 editable fields → RatingStars → GenrePresetBar → action row.
- BPM input: `type='number' min=1 max=399 step=1` + onChange clears to null on non-integer / out-of-range (defence-in-depth on top of Plan 04-01's main-side V5).
- Text fields capped at maxLength=500; Key field maxLength=16 (T-4-03 / T-4-05 UX defence).
- Action row in French: "Passer (→)" / "Annuler (⌘Z)" (disabled — Plan 04-03 owns undo) / "Sauver (←)" (primary).
- Card reads dirty + pending edits in cascade (`dirty wins over pending`) so the UI shows in-flight edits while still displaying saved values when no dirty override exists.
- Receives `onKeep` / `onSkip` props from TaggerView so the slide animation lives in the view layer (single orchestrator).

### tagger.css (design-quality + performance compliance)
- Uses ONLY existing `:root` tokens from `main.css` — verified by grep test (no new `--color-*` declarations).
- Transitions reference only `transform` and `opacity` — no width/height/margin/padding animation properties.
- `.tagger-card-wrapper` owns the slide hook (so `<TaggerCard key={path}>` can re-mount cleanly on advance); `.tagger-card--exit-left` → `translateX(-100vw)+opacity 0`, `--exit-right` → `translateX(100vw)+opacity 0`, 250ms `cubic-bezier(0.16,1,0.3,1)`.
- Editorial composition: title heavy scale, monospace path subtitle, chip row with horizontal flex, broken-grid spacing (space-md/lg/sm/xs, never uniform padding everywhere), accent ring on focus-visible.

### TaggerView shell
- Replaces the Phase 4 placeholder with the real view.
- Parallel mount: `Promise.all([loadQueue(), loadGenrePresets(), loadMuteSetting()])`.
- 4 render states: `loading` ("Chargement…"), `empty` ("Lance un scan dans l'Analyser pour démarrer."), `ready` (TaggerCard), end-of-queue ("Bibliothèque terminée pour ce scan.") — all French.
- Slide orchestration: clicking Keep/Skip (or pressing ←/→) sets `exitDirection`, the wrapper picks up `tagger-card--exit-left|right`, the view waits for `transitionend`, then dispatches the store action and clears the class. Both button and keyboard paths share the same orchestrator.

### CSP extension (T-4-01 / T-4-02 carry)
- `src/renderer/index.html` CSP extended: `... img-src 'self' data:; media-src 'self' cratekeeper:;` — required for `<audio src='cratekeeper://...'>` to load.

## Per-task Commits

| Task | Commit | Description |
| --- | --- | --- |
| 1 | ffaa2e1 | feat(04-02): splitDetection + useDebouncedCallback |
| 2 | 5af8aa5 | feat(04-02): useTaggerStore (queue + dirty edits + presets + mute) |
| 3 | eb809dc | feat(04-02): card-internal blocks + keyboard hook |
| 4 | 7bc71d6 | feat(04-02): TaggerCard composite + tagger.css + CSP media-src |
| 5 | 1a316b6 | feat(04-02): TaggerView shell with empty/loading/active/end |

## Verification

- `npm run build` exits 0 — typechecks (node + web tsconfigs) + electron-vite bundle.
- `npx vitest --run` — 426/426 tests green (75 new across splitDetection, useTaggerStore, useTaggerKeyboard, AudioPreview, GenrePresetBar, RatingStars, ArtistTitleSplit, TaggerCard, TaggerView; existing 351 untouched).
- `grep -E "^\s*--color-" src/renderer/src/components/tagger/tagger.css` — 0 matches (no new color tokens).
- `grep "media-src 'self' cratekeeper:" src/renderer/index.html` — match present.
- `grep -E "Keep|Skip|Save|Cancel" src/renderer/src/components/tagger/TaggerCard.tsx src/renderer/src/views/TaggerView.tsx` — 0 user-visible-string matches (only "key" identifiers / "scanId" / comments).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Blocking issue] jsdom `HTMLMediaElement.play()` returns undefined, not a Promise**
- **Found during:** Task 3 (AudioPreview tests).
- **Issue:** The planned `el.play().catch(...)` blew up in jsdom because `play()` is not implemented and `el.play()` evaluates to `undefined` — calling `.catch()` on undefined throws synchronously, killing the effect and (downstream) failing 4 tests including timeupdate-loop.
- **Fix:** Wrapped `el.play()` in try/catch and guarded the return value (`if p && typeof p.catch === 'function'`). Behaviour in real Electron is identical (autoplay-policy is unlocked at the main bootstrap from Plan 04-01).
- **Files modified:** `src/renderer/src/components/tagger/AudioPreview.tsx`.
- **Commit:** eb809dc.

**2. [Rule 3 — Test environment quirk] jsdom contentEditable focus**
- **Found during:** Task 3 (useTaggerKeyboard tests).
- **Issue:** Setting `div.setAttribute('contenteditable', 'true')` does not flip `isContentEditable` to true in jsdom, AND a div without `tabIndex` cannot receive focus. The input-focus-gate test could not exercise the contentEditable branch.
- **Fix:** Test sets `tabIndex=0` AND defines `isContentEditable` as a getter returning true (the production hook reads `el.isContentEditable`, not the attribute, so this exercises the exact code path). Production code unchanged.
- **Files modified:** `src/renderer/src/hooks/useTaggerKeyboard.test.ts`.
- **Commit:** eb809dc.

**3. [Rule 3 — Plan refinement] TaggerCard receives onKeep/onSkip from parent**
- **Found during:** Task 4 planning vs Task 5 slide orchestration.
- **Issue:** Plan Task 4 had TaggerCard's Keep/Skip buttons call `store.keep()`/`store.skip()` directly. Plan Task 5 noted "lift the orchestration" so the slide animation runs first — without that, clicking Keep would advance the card BEFORE the slide animation runs.
- **Fix:** TaggerCard now takes `onKeep` / `onSkip` props; TaggerView passes the slide-wrapped handlers. Keyboard ←/→ and on-screen buttons share the same `runWithSlide(direction, action)` orchestrator. This was the planner-discretion path called out in the plan.
- **Files modified:** `src/renderer/src/components/tagger/TaggerCard.tsx` (props shape), `src/renderer/src/views/TaggerView.tsx` (handler creation).
- **Commit:** 7bc71d6 + 1a316b6.

No security / architecture deviations.

## Checkpoint Handling

The plan's final `checkpoint:human-verify` task is explicitly deferred to end-of-phase per its own `how-to-verify` spec ("Automated coverage proves the surface; visual + auditory verification rolls into the Plan 04-03 final checkpoint."). Auto-mode auto-approval applies — the checkpoint is `gate="blocking"` but not a `blocking-human` / package-legitimacy gate. Automated gates cleared:

1. `npm run build` → exit 0 ✓
2. `npx vitest --run` → 426/426 green ✓ (no regressions in Plan 04-01's 351)
3. CSP grep ✓
4. No new color tokens / no layout-bound animation properties ✓

## Known Stubs

- The **Annuler (⌘Z)** action button in TaggerCard is rendered `disabled`. This is **intentional** — the undo state machine + redo are owned by Plan 04-03 (TAGG-09). The button is in place so the visual layout matches the final UX; flipping the disabled flag in Plan 04-03 will activate it without re-shipping the chrome.
- `useTaggerKeyboard.onUndo` and `onPlayPause` are wired as no-ops at the view level for the same reason (Plan 04-03 owns undo, Space-play-pause is deferred polish per CONTEXT).

These are documented stubs, not silent gaps — the plan explicitly defers TAGG-09 + TAGG-10 (session resume + undo) to 04-03.

## Threat Flags

None new. T-4-01 / T-4-02 / T-4-03 / T-4-05 / T-4-07 mitigations from Plan 04-01's threat register remain in place, with UX-layer defence-in-depth added at input boundaries (BPM range clamp, text maxLength=500, key maxLength=16, AIFF short-circuit before `<audio>` mount).

## Self-Check: PASSED

Files exist: useTaggerStore.ts, splitDetection.ts, useDebouncedCallback.ts, useTaggerKeyboard.ts, AudioPreview.tsx, GenrePresetBar.tsx, RatingStars.tsx, ArtistTitleSplit.tsx, TaggerCard.tsx, tagger.css, TaggerView.tsx (rewrite) + every paired *.test.* file. All 5 task commits present in `git log` (ffaa2e1 / 5af8aa5 / eb809dc / 7bc71d6 / 1a316b6). `media-src 'self' cratekeeper:` present in `src/renderer/index.html`.
