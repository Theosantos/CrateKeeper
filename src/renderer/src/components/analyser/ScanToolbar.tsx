import { useAppStore } from '../../store/useAppStore'
import { useScanStore } from '../../store/useScanStore'

/**
 * Scanner / Stop controls + live progress strip.
 *
 * Reads rootFolder from useAppStore (NOT directly from window.djUtils.getRootFolder
 * — Threat T-2-01 defence in depth: the store always passes the persisted
 * allowlisted folder, never a user-typed path).
 */

export function ScanToolbar(): React.JSX.Element {
  const rootFolder = useAppStore((s) => s.rootFolder)
  const status = useScanStore((s) => s.status)
  const rowsCount = useScanStore((s) => s.rows.length)
  const totalFiles = useScanStore((s) => s.totalFiles)
  const durationMs = useScanStore((s) => s.durationMs)
  const error = useScanStore((s) => s.error)
  const start = useScanStore((s) => s.start)
  const cancel = useScanStore((s) => s.cancel)

  const isRunning = status === 'running'
  const canStart = rootFolder !== null && !isRunning

  function handleStart(): void {
    if (rootFolder === null) return
    void start(rootFolder)
  }

  function handleStop(): void {
    void cancel()
  }

  const progressText = (() => {
    if (status === 'error') return error ?? 'Erreur inconnue'
    if (status === 'running') return `${rowsCount} fichiers scannés…`
    if (status === 'done' && totalFiles !== null && durationMs !== null) {
      return `${totalFiles} fichiers · ${(durationMs / 1000).toFixed(1)} s`
    }
    if (status === 'cancelled') return `Annulé — ${rowsCount} fichiers reçus`
    return 'En attente.'
  })()

  return (
    <div className="scan-toolbar">
      <div className="scan-toolbar__controls">
        <button
          type="button"
          className="scan-toolbar__button scan-toolbar__button--start"
          onClick={handleStart}
          disabled={!canStart}
        >
          Scanner
        </button>
        {isRunning ? (
          <button
            type="button"
            className="scan-toolbar__button scan-toolbar__button--stop"
            onClick={handleStop}
          >
            Stop
          </button>
        ) : null}
        {rootFolder === null ? (
          <p className="scan-toolbar__hint">
            Choisis un dossier racine pour lancer un scan.
          </p>
        ) : null}
      </div>
      <output
        className={`scan-toolbar__progress scan-toolbar__progress--${status}`}
        aria-live="polite"
      >
        {progressText}
      </output>
    </div>
  )
}
