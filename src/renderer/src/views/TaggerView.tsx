import { useCallback, useEffect, useRef, useState } from 'react'
import { TaggerCard } from '../components/tagger/TaggerCard'
import '../components/tagger/tagger.css'
import { useTaggerKeyboard } from '../hooks/useTaggerKeyboard'
import { selectCurrentFile, useTaggerStore } from '../store/useTaggerStore'

type ExitDirection = 'left' | 'right' | null

/**
 * Tagger view shell. Owns:
 *  - parallel mount lifecycle (queue + presets + mute setting)
 *  - empty/loading/end-of-queue states with French copy
 *  - document-level keyboard handler (useTaggerKeyboard)
 *  - slide-animation orchestration: add exit class → wait transitionend →
 *    dispatch store action → clear class. Keep slides left; Skip slides right.
 */
export function TaggerView(): React.JSX.Element {
  const status = useTaggerStore((s) => s.status)
  const currentFile = useTaggerStore(selectCurrentFile)
  const queueLength = useTaggerStore((s) => s.queue.length)
  const currentIndex = useTaggerStore((s) => s.currentIndex)
  const loadQueue = useTaggerStore((s) => s.loadQueue)
  const loadGenrePresets = useTaggerStore((s) => s.loadGenrePresets)
  const loadMuteSetting = useTaggerStore((s) => s.loadMuteSetting)
  const keep = useTaggerStore((s) => s.keep)
  const skip = useTaggerStore((s) => s.skip)
  const toggleMute = useTaggerStore((s) => s.toggleMute)
  const applyPreset = useTaggerStore((s) => s.applyPreset)

  const [exitDirection, setExitDirection] = useState<ExitDirection>(null)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void Promise.all([loadQueue(), loadGenrePresets(), loadMuteSetting()])
  }, [loadQueue, loadGenrePresets, loadMuteSetting])

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
    },
    []
  )

  const handleKeep = useCallback((): void => {
    void runWithSlide('left', keep)
  }, [runWithSlide, keep])

  const handleSkip = useCallback((): void => {
    void runWithSlide('right', skip)
  }, [runWithSlide, skip])

  useTaggerKeyboard({
    onKeep: handleKeep,
    onSkip: handleSkip,
    onUndo: () => {
      /* Plan 04-03 */
    },
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
          <p className="view__eyebrow">Phase 4</p>
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
          <p className="view__eyebrow">Phase 4</p>
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
          <p className="view__eyebrow">Phase 4</p>
          <h2 id="view-tagger-heading" className="view__title">
            Tagger
          </h2>
        </header>
        <p className="view__placeholder">
          Bibliothèque terminée pour ce scan.
        </p>
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
        />
      </div>
    </section>
  )
}
