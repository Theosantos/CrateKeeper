import { useCallback, useEffect, useRef, useState } from 'react'
import { ApplyBanner } from '../components/tagger/ApplyBanner'
import { TaggerCard } from '../components/tagger/TaggerCard'
import '../components/tagger/tagger.css'
import { useDebouncedCallback } from '../hooks/useDebouncedCallback'
import { useTaggerKeyboard } from '../hooks/useTaggerKeyboard'
import { selectCurrentFile, useTaggerStore } from '../store/useTaggerStore'

type ExitDirection = 'left' | 'right' | null

/**
 * Tagger view shell. Owns:
 *  - parallel mount lifecycle (queue + presets + mute setting) + session resume
 *  - empty/loading/end-of-queue states with French copy
 *  - document-level keyboard handler (useTaggerKeyboard)
 *  - slide-animation orchestration: add exit class → wait transitionend →
 *    dispatch store action → clear class. Keep slides left; Skip slides right;
 *    Undo-after-Keep slides right (reverse); Undo-after-Skip slides left.
 *  - debounced tagger:set-session at 500ms trailing + beforeunload flush
 *    (Pitfall 1) so closing the app never drops the last in-flight session
 *    pointer.
 *  - mount-time tagger:get-session AFTER loadQueue resolves; jumps the
 *    currentIndex to the matching file path or falls back to 0
 *    (library-change resilience).
 */
export function TaggerView(): React.JSX.Element {
  const status = useTaggerStore((s) => s.status)
  const currentFile = useTaggerStore(selectCurrentFile)
  const queueLength = useTaggerStore((s) => s.queue.length)
  const currentIndex = useTaggerStore((s) => s.currentIndex)
  const lastAction = useTaggerStore((s) => s.lastAction)
  const loadQueue = useTaggerStore((s) => s.loadQueue)
  const loadGenrePresets = useTaggerStore((s) => s.loadGenrePresets)
  const loadMuteSetting = useTaggerStore((s) => s.loadMuteSetting)
  const loadPendingWriteCount = useTaggerStore((s) => s.loadPendingWriteCount)
  const keep = useTaggerStore((s) => s.keep)
  const skip = useTaggerStore((s) => s.skip)
  const undo = useTaggerStore((s) => s.undo)
  const toggleMute = useTaggerStore((s) => s.toggleMute)
  const applyPreset = useTaggerStore((s) => s.applyPreset)

  const [exitDirection, setExitDirection] = useState<ExitDirection>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  // Debounced session writer. 500ms trailing — collapses rapid Keep/Skip into
  // one IPC. flush() is wired to beforeunload so quitting never drops a row.
  const sessionDebounced = useDebouncedCallback(
    (currentFilePath: string | null): void => {
      const scanId = useTaggerStore.getState().scanId
      void window.crateKeeper.tagger.setSession({ currentFilePath, scanId })
    },
    500
  )

  // Mount: parallel loads + post-loadQueue session restore.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      await Promise.all([
        loadQueue(),
        loadGenrePresets(),
        loadMuteSetting(),
        loadPendingWriteCount()
      ])
      if (cancelled) return
      const session = await window.crateKeeper.tagger.getSession()
      if (cancelled || session === null || session.currentFilePath === null) {
        return
      }
      const queue = useTaggerStore.getState().queue
      const idx = queue.findIndex((f) => f.path === session.currentFilePath)
      if (idx >= 0) {
        useTaggerStore.setState({ currentIndex: idx })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadQueue, loadGenrePresets, loadMuteSetting, loadPendingWriteCount])

  // beforeunload synchronous flush (Pitfall 1).
  useEffect(() => {
    const onBeforeUnload = (): void => {
      sessionDebounced.flush()
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [sessionDebounced])

  // After every advance/rewind, schedule a debounced session write with the
  // NEW current file path (or null if we've moved past the end of the queue).
  const scheduleSessionWrite = useCallback((): void => {
    const s = useTaggerStore.getState()
    const next = s.queue[s.currentIndex]?.path ?? null
    sessionDebounced.call(next)
  }, [sessionDebounced])

  const runWithSlide = useCallback(
    async (
      direction: 'left' | 'right',
      action: () => Promise<unknown> | unknown
    ): Promise<void> => {
      setExitDirection(direction)
      const el = wrapperRef.current
      await new Promise<void>((resolve) => {
        if (el === null) {
          resolve()
          return
        }
        const onEnd = (): void => {
          el.removeEventListener('transitionend', onEnd)
          resolve()
        }
        el.addEventListener('transitionend', onEnd)
      })
      await action()
      setExitDirection(null)
      scheduleSessionWrite()
    },
    [scheduleSessionWrite]
  )

  const handleKeep = useCallback((): void => {
    void runWithSlide('left', keep)
  }, [runWithSlide, keep])

  const handleSkip = useCallback((): void => {
    void runWithSlide('right', skip)
  }, [runWithSlide, skip])

  const handleUndo = useCallback((): void => {
    // Capture lastAction.type BEFORE consuming it so we can reverse the slide.
    const la = useTaggerStore.getState().lastAction
    if (la === null) return
    const dir: 'left' | 'right' = la.type === 'keep' ? 'right' : 'left'
    void runWithSlide(dir, undo)
  }, [runWithSlide, undo])

  useTaggerKeyboard({
    onKeep: handleKeep,
    onSkip: handleSkip,
    onUndo: handleUndo,
    onPlayPause: () => {
      /* deferred polish */
    },
    onMute: () => {
      void toggleMute()
    },
    onPreset: applyPreset
  })

  if (status === 'loading') {
    return (
      <section className="view" aria-labelledby="view-tagger-heading">
        <header className="view__header">
          <p className="view__eyebrow">03 · Catégorisation</p>
          <h2 id="view-tagger-heading" className="view__title">
            Tagger
          </h2>
        </header>
        <p className="view__placeholder">Chargement…</p>
      </section>
    )
  }

  if (status === 'empty') {
    return (
      <section className="view" aria-labelledby="view-tagger-heading">
        <header className="view__header">
          <p className="view__eyebrow">03 · Catégorisation</p>
          <h2 id="view-tagger-heading" className="view__title">
            Tagger
          </h2>
        </header>
        <p className="view__placeholder">
          Lance un scan dans l&apos;Analyser pour démarrer.
        </p>
      </section>
    )
  }

  if (currentIndex >= queueLength || currentFile === null) {
    return (
      <section className="view" aria-labelledby="view-tagger-heading">
        <header className="view__header">
          <p className="view__eyebrow">03 · Catégorisation</p>
          <h2 id="view-tagger-heading" className="view__title">
            Tagger
          </h2>
        </header>
        <p className="view__placeholder">
          Bibliothèque terminée pour ce scan.
        </p>
        <ApplyBanner />
      </section>
    )
  }

  const wrapperClass =
    'tagger-card-wrapper' +
    (exitDirection === 'left' ? ' tagger-card--exit-left' : '') +
    (exitDirection === 'right' ? ' tagger-card--exit-right' : '')

  return (
    <section className="view" aria-labelledby="view-tagger-heading">
      <header className="view__header">
        <p className="view__eyebrow">Phase 4</p>
        <h2 id="view-tagger-heading" className="view__title">
          Tagger
        </h2>
      </header>
      <ApplyBanner />
      <div
        ref={wrapperRef}
        className={wrapperClass}
        data-testid="tagger-card-wrapper"
      >
        <TaggerCard
          key={currentFile.path}
          file={currentFile}
          onKeep={handleKeep}
          onSkip={handleSkip}
          onUndo={handleUndo}
          canUndo={lastAction !== null}
        />
      </div>
    </section>
  )
}
