# Roadmap: DJ Utils

**Milestone:** v1
**Granularity:** standard
**Coverage:** 29/29 requirements mapped

## Phases

- [x] **Phase 1: Foundation** - App shell, IPC bridge, folder picker, SQLite persistence
- [ ] **Phase 2: File Scanning & Library View** - Chunked audio scan, metadata display, tag status indicators, CSV export
- [ ] **Phase 3: FFmpeg Conversion Pipeline** - Batch conversion, progress tracking, resume, tag preservation
- [ ] **Phase 4: Tagger Core** - Swipe-style tagging queue, audio previews, inline editing, session resume
- [ ] **Phase 5: Tag Writing & Rekordbox Compatibility** - Atomic ID3v2.3/MP4 writes, Rekordbox-compatible fields
- [ ] **Phase 6: Distribution** - Signed .dmg and .exe installers with bundled FFmpeg

## Phase Details

### Phase 1: Foundation
**Goal:** The app launches with a working three-tool navigation, users can pick a root folder, and that choice persists across sessions.
**Mode:** mvp
**Depends on:** Nothing
**Requirements:** FOUND-01, FOUND-02, FOUND-03
**Success Criteria**:
  1. User opens the app and sees a navigation interface with three distinct tool areas: Analyser, Convertir, Tagger
  2. User clicks a folder-picker control and selects a directory from their filesystem
  3. User quits and relaunches the app — the previously selected folder is still shown without re-selecting
**Plans**: 2 plans
- [x] 01-01-PLAN.md — Scaffold + secure window + better-sqlite3 settings store + folder-pick/settings IPC bridge + Vitest infra (FOUND-02, FOUND-03)
- [x] 01-02-PLAN.md — Renderer vertical slice: three-tool nav, Zustand store, folder picker, mount-time persistence (FOUND-01, FOUND-02, FOUND-03)

### Phase 2: File Scanning & Library View
**Goal:** Users can scan a folder and see every audio file with full technical metadata and tag completeness indicators, without the UI freezing.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** SCAN-01, SCAN-02, SCAN-03, SCAN-04, SCAN-05
**Success Criteria**:
  1. User triggers a scan and sees a live-updating list of audio files showing format, bitrate, file size, sample rate, and duration
  2. Each file row shows a visual indicator (e.g. colored badge) for whether Genre, BPM, and Key tags are already filled
  3. The UI remains scrollable and interactive while a scan of thousands of files is in progress
  4. User clicks "Export CSV" and receives a file containing all scanned metadata
**Plans**: 3 plans
- [x] 02-01-PLAN.md — Main backbone: scan IPC namespace, scanRepo + worker_threads + ScanController, electron.vite worker entry (SCAN-01/02/03/05)
- [ ] 02-02-PLAN.md — Renderer slice: useScanStore + ScanToolbar + VirtualizedFileTable + TagBadge (SCAN-01/02/03/05)
- [ ] 02-03-PLAN.md — CSV export: streamed csv-stringify via showSaveDialog + toolbar button (SCAN-04)
**UI hint**: yes

### Phase 3: FFmpeg Conversion Pipeline
**Goal:** Users can select files from the library and convert them in batch to a configurable format/bitrate, with per-file progress, error reporting, resume capability, and tag preservation.
**Mode:** mvp
**Depends on:** Phase 2
**Requirements:** CONV-01, CONV-02, CONV-03, CONV-04, CONV-05, CONV-06
**Success Criteria**:
  1. User selects files in the library view and starts a batch conversion to MP3 320kbps (or a custom format/bitrate they configured)
  2. User sees a per-file progress bar and an overall progress indicator updating in real time
  3. If one file fails to convert, an error is shown for that file and the rest of the batch continues
  4. User interrupts a conversion mid-batch, relaunches, and resumes from where it stopped without re-converting completed files
  5. Converted files retain their original ID3/MP4 tags
**Plans**: TBD

### Phase 4: Tagger Core
**Goal:** Users can work through a queue of untagged files one by one — hearing a preview, editing metadata inline, keeping or skipping — with session resume and undo.
**Mode:** mvp
**Depends on:** Phase 1
**Requirements:** TAGG-01, TAGG-02, TAGG-03, TAGG-04, TAGG-05, TAGG-06, TAGG-07, TAGG-08, TAGG-09, TAGG-10
**Success Criteria**:
  1. User opens the Tagger, loads a folder, and only sees files that are missing at least one of Genre, BPM, or Key
  2. Each card auto-plays a 30-second audio preview on load and displays file name plus any existing tags
  3. User presses → (or clicks Skip) to move to the next file, or ← (or clicks Keep) to save edits — both work via keyboard shortcuts
  4. User taps a genre quick-button (e.g. "House") or presses 1-9 to apply a preset genre in one action
  5. User edits BPM, Key, Genre, Artist, Title, Comment, and Energy/Rating directly on the card without opening any modal
  6. When Artist is empty and the Title contains " - ", the app offers a one-click Artiste/Titre split suggestion
  7. User presses Undo and the previous Keep/Skip action is reversed
  8. User closes the app mid-session, reopens it, and the tagger resumes at the same file in the queue
**Plans**: TBD
**UI hint**: yes

### Phase 5: Tag Writing & Rekordbox Compatibility
**Goal:** Tags edited in the Tagger are durably written to audio files in a format that Rekordbox reads correctly, with no risk of file corruption.
**Mode:** mvp
**Depends on:** Phase 4
**Requirements:** TAGS-01, TAGS-02, TAGS-03
**Success Criteria**:
  1. After a Keep action, the user can inspect the audio file with an external tool (e.g. Mp3tag) and see the updated tags written to the file
  2. If the app crashes or loses power during a write, the original audio file is intact and uncorrupted
  3. Tags written for MP3 files use ID3v2.3 with UTF-16 encoding, integer BPM, and Camelot-notation Key — importing into Rekordbox shows the values correctly
**Plans**: TBD

### Phase 6: Distribution
**Goal:** Non-developer DJs on macOS and Windows can install the app from a single installer file with no manual dependency setup.
**Mode:** mvp
**Depends on:** Phase 5
**Requirements:** DIST-01, DIST-02
**Success Criteria**:
  1. A macOS user downloads a .dmg, drags the app to Applications, and runs it — no Homebrew, no Node, no FFmpeg install required
  2. A Windows user runs a .exe installer and launches the app — conversion and scanning work out of the box
  3. FFmpeg is bundled inside the installer and resolves correctly at runtime on both platforms
**Plans**: TBD

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Foundation | 2/2 | Complete | 2026-05-29 |
| 2. File Scanning & Library View | 1/3 | In Progress|  |
| 3. FFmpeg Conversion Pipeline | 0/? | Not started | - |
| 4. Tagger Core | 0/? | Not started | - |
| 5. Tag Writing & Rekordbox Compatibility | 0/? | Not started | - |
| 6. Distribution | 0/? | Not started | - |
