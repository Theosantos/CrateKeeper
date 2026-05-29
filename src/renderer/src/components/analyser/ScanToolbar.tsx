import { useEffect, useState } from 'react'
import { useAppStore } from '../../store/useAppStore'
import { useScanStore } from '../../store/useScanStore'

/**
 * Scanner / Stop / Exporter CSV controls + live progress strip.
 *
 * Reads rootFolder from useAppStore (NOT directly from window.djUtils.getRootFolder
 * — Threat T-2-01 defence in depth: the store always passes the persisted
 * allowlisted folder, never a user-typed path).
 *
 * Exporter CSV is gated on status === 'done' AND !exporting; the store also
 * guards on the same conditions (defence in depth).
 */

const EXPORT_TOAST_MS = 4000

export function ScanToolbar(): React.JSX.Element {
  const rootFolder = useAppStore((s) => s.rootFolder)
  const status = useScanStore((s) => s.status)
  const rowsCount = useScanStore((s) => s.rows.length)
  const totalFiles = useScanStore((s) => s.totalFiles)
  const durationMs = useScanStore((s) => s.durationMs)
  const error = useScanStore((s) => s.error)
  const exporting = useScanStore((s) => s.exporting)
  const start = useScanStore((s) => s.start)
  const cancel = useScanStore((s) => s.cancel)
  const exportCsv = useScanStore((s) => s.exportCsv)

  const [recentExportPath, setRecentExportPath] = useState<string | null>(null)

  const isRunning = status === 'running'
  const canStart = rootFolder !== null && !isRunning
  const canExport = status === 'done' && !exporting

  function handleStart(): void {
    if (rootFolder === null) return
    void start(rootFolder)
  }

  function handleStop(): void {
    void cancel()
  }

  async function handleExport(): Promise<void> {
    const exportedPath = await exportCsv()
    if (exportedPath !== null) {
      setRecentExportPath(exportedPath)
    }
  }

  // Hide the toast after a short delay. Pure CSS opacity transitions handle
  // the visual fade (no layout-bound animation — web/performance.md).
  useEffect(() => {
    if (recentExportPath === null) return
    const id = window.setTimeout(() => setRecentExportPath(null), EXPORT_TOAST_MS)
    return () => window.clearTimeout(id)
  }, [recentExportPath])

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
        <button
          type="button"
          className="scan-toolbar__button scan-toolbar__button--export"
          onClick={() => {
            void handleExport()
          }}
          disabled={!canExport}
        >
          Exporter CSV
        </button>
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
      {recentExportPath !== null ? (
        <p
          className="scan-toolbar__export-notice"
          role="status"
          aria-live="polite"
        >
          Exporté : {recentExportPath}
        </p>
      ) : null}
    </div>
  )
}
