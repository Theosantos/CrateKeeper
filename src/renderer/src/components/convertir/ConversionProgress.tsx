import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ConversionFileStatus } from '../../../../shared/ipc-types'
import {
  selectGlobalProgress,
  selectSummaryCounts,
  useConversionStore
} from '../../store/useConversionStore'

/**
 * Live per-file + global conversion progress.
 *
 * Per-file list is virtualized via @tanstack/react-virtual (T-3-11 mitigation:
 * thousands of selected files must not blow up the DOM).
 *
 * Status labels are French (LOCKED) and read from the store, never from a
 * stale local copy. The global bar reads selectGlobalProgress directly.
 */

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

function statusLabel(status: ConversionFileStatus | undefined): string {
  switch (status) {
    case 'running':
      return 'En cours'
    case 'done':
      return 'Converti'
    case 'error':
      return 'Erreur'
    case 'skipped':
      return 'Ignoré'
    case 'cancelled':
      return 'Annulé'
    case 'pending':
    case undefined:
    default:
      return 'En attente'
  }
}

function statusClass(status: ConversionFileStatus | undefined): string {
  switch (status) {
    case 'done':
      return 'conversion-progress__badge--done'
    case 'error':
      return 'conversion-progress__badge--error'
    case 'skipped':
      return 'conversion-progress__badge--skipped'
    case 'cancelled':
      return 'conversion-progress__badge--cancelled'
    case 'running':
      return 'conversion-progress__badge--running'
    default:
      return 'conversion-progress__badge--pending'
  }
}

export function ConversionProgress(): React.JSX.Element {
  const pendingFilePaths = useConversionStore((s) => s.pendingFilePaths)
  const perFileProgress = useConversionStore((s) => s.perFileProgress)
  const fileStatuses = useConversionStore((s) => s.fileStatuses)
  const errors = useConversionStore((s) => s.errors)
  const status = useConversionStore((s) => s.status)
  // Derive these locally instead of via store selectors: selectSummaryCounts
  // returns a fresh object on every call which would loop useSyncExternalStore.
  const globalPercent = selectGlobalProgress({
    pendingFilePaths,
    fileStatuses
  } as Parameters<typeof selectGlobalProgress>[0])
  const counts = selectSummaryCounts({
    fileStatuses
  } as Parameters<typeof selectSummaryCounts>[0])
  const total = pendingFilePaths.length

  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: pendingFilePaths.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 8
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  // Build a quick errorMessage lookup so each row's badge tooltip can show
  // the specific error (T-3-11 echo). The inline error column was removed —
  // hover the badge to see the message, or read the summary line below.
  const errorByPath = new Map<string, string>()
  for (const e of errors) errorByPath.set(e.filePath, e.errorMessage)

  const done = counts.done + counts.skipped
  const showSummary = status === 'done' || status === 'cancelled'

  return (
    <div className="conversion-progress">
      <div className="conversion-progress__global">
        <div className="conversion-progress__bar-wrap">
          <progress
            className="conversion-progress__bar"
            max={100}
            value={globalPercent}
            aria-label="Progression globale"
          />
        </div>
        <p className="conversion-progress__counter">
          {done}/{total} fichiers convertis
        </p>
      </div>

      <div className="conversion-progress__list" ref={scrollRef}>
        <div
          className="conversion-progress__virtual"
          style={{ height: `${totalSize}px`, position: 'relative' }}
        >
          {items.map((vi) => {
            const filePath = pendingFilePaths[vi.index]
            const progress = perFileProgress.get(filePath)
            const fileStatus = fileStatuses.get(filePath)
            const percent = progress?.percent ?? 0
            const errMsg = errorByPath.get(filePath)
            // Badge tooltip: file path on success, error message on failure.
            const badgeTitle = errMsg ?? filePath
            return (
              <div
                key={vi.key}
                data-row
                className="conversion-progress__row"
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                  height: `${vi.size}px`
                }}
              >
                <span className="conversion-progress__name" title={filePath}>
                  {basename(filePath)}
                </span>
                <progress
                  className="conversion-progress__row-bar"
                  max={100}
                  value={percent}
                  aria-label={`Progression de ${basename(filePath)}`}
                />
                <span
                  className={`conversion-progress__badge ${statusClass(fileStatus)}`}
                  title={badgeTitle}
                >
                  {statusLabel(fileStatus)}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      {showSummary ? (
        <p className="conversion-progress__summary" role="status">
          {counts.done} converti, {counts.error} en erreur, {counts.skipped} ignorés
          {counts.cancelled > 0 ? `, ${counts.cancelled} annulés` : ''}
        </p>
      ) : null}
    </div>
  )
}
