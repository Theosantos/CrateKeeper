import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { ScannedFile } from '../../../../shared/ipc-types'
import { TagBadge } from './TagBadge'
import { useScanStore } from '../../store/useScanStore'

/**
 * Fixed-height virtualized file table. Renders only the rows in view
 * (plus an overscan band) so a 5000-row scan does not blow up the DOM.
 *
 * Composition: the parent (AnalyserView) passes `rows` selected from
 * useScanStore — the table itself stays a pure presentational component.
 *
 * Plan 03-02 extension: a leftmost ~32px checkbox column wired to the
 * selection state owned by useScanStore. The header cell renders a
 * tri-state "select all" checkbox (none / mixed / all).
 */

type Props = {
  rows: ScannedFile[]
}

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

function formatBitrate(kbps: number | null): string {
  return kbps === null ? '—' : `${Math.round(kbps)} kbps`
}

function formatSizeMb(bytes: number): string {
  return `${(bytes / 1_000_000).toFixed(1)} MB`
}

function formatSampleRate(hz: number | null): string {
  if (hz === null) return '—'
  return `${(hz / 1000).toFixed(1)} kHz`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return '—'
  const total = Math.round(seconds)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

type HeaderCheckboxState = 'none' | 'all' | 'mixed'

function HeaderCheckbox({
  state,
  onToggle
}: {
  state: HeaderCheckboxState
  onToggle: () => void
}): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (ref.current !== null) {
      ref.current.indeterminate = state === 'mixed'
    }
  }, [state])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="file-table__checkbox"
      aria-label="Tout sélectionner"
      aria-checked={state === 'mixed' ? 'mixed' : state === 'all'}
      checked={state === 'all'}
      onChange={onToggle}
    />
  )
}

export function VirtualizedFileTable({ rows }: Props): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)
  const selectedFilePaths = useScanStore((s) => s.selectedFilePaths)
  const toggleFile = useScanStore((s) => s.toggleFile)
  const toggleAll = useScanStore((s) => s.toggleAll)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 36,
    overscan: 8
  })

  const items = virtualizer.getVirtualItems()
  const totalSize = virtualizer.getTotalSize()

  let headerState: HeaderCheckboxState = 'none'
  if (rows.length > 0) {
    const selectedHere = rows.filter((r) => selectedFilePaths.has(r.path)).length
    if (selectedHere === rows.length) headerState = 'all'
    else if (selectedHere > 0) headerState = 'mixed'
  }

  const visiblePaths = rows.map((r) => r.path)

  return (
    <div className="file-table" role="table" aria-label="Fichiers scannés">
      <div className="file-table__head" role="row">
        <div
          className="file-table__cell file-table__cell--select"
          role="columnheader"
        >
          <HeaderCheckbox state={headerState} onToggle={() => toggleAll(visiblePaths)} />
        </div>
        <div className="file-table__cell file-table__cell--name" role="columnheader">
          Fichier
        </div>
        <div className="file-table__cell file-table__cell--format" role="columnheader">
          Format
        </div>
        <div className="file-table__cell file-table__cell--bitrate" role="columnheader">
          Bitrate
        </div>
        <div className="file-table__cell file-table__cell--size" role="columnheader">
          Taille
        </div>
        <div className="file-table__cell file-table__cell--samplerate" role="columnheader">
          Sample rate
        </div>
        <div className="file-table__cell file-table__cell--duration" role="columnheader">
          Durée
        </div>
        <div className="file-table__cell file-table__cell--tags" role="columnheader">
          Tags
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="file-table__empty">
          Aucun fichier scanné pour le moment. Clique sur Scanner pour démarrer.
        </p>
      ) : (
        <div ref={scrollRef} className="file-table__scroll">
          <div
            className="file-table__virtual"
            style={{ height: `${totalSize}px`, position: 'relative' }}
          >
            {items.map((vi) => {
              const row = rows[vi.index]
              const isError = !row.parsedOk
              const isChecked = selectedFilePaths.has(row.path)
              const rowClass = `file-table__row${isError ? ' row--errored' : ''}`
              return (
                <div
                  key={vi.key}
                  data-row
                  role="row"
                  className={rowClass}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${vi.start}px)`,
                    height: `${vi.size}px`
                  }}
                >
                  <div
                    className="file-table__cell file-table__cell--select"
                    role="cell"
                  >
                    <input
                      type="checkbox"
                      className="file-table__checkbox"
                      aria-label={`Sélectionner ${basename(row.path)}`}
                      checked={isChecked}
                      onChange={() => toggleFile(row.path)}
                    />
                  </div>
                  <div
                    className="file-table__cell file-table__cell--name"
                    role="cell"
                    title={row.path}
                  >
                    {basename(row.path)}
                  </div>
                  <div className="file-table__cell file-table__cell--format" role="cell">
                    {row.format}
                  </div>
                  <div className="file-table__cell file-table__cell--bitrate" role="cell">
                    {formatBitrate(row.bitrate)}
                  </div>
                  <div className="file-table__cell file-table__cell--size" role="cell">
                    {formatSizeMb(row.sizeBytes)}
                  </div>
                  <div className="file-table__cell file-table__cell--samplerate" role="cell">
                    {formatSampleRate(row.sampleRate)}
                  </div>
                  <div className="file-table__cell file-table__cell--duration" role="cell">
                    {formatDuration(row.durationSeconds)}
                  </div>
                  <div className="file-table__cell file-table__cell--tags" role="cell">
                    <TagBadge kind="G" present={row.hasGenre} />
                    <TagBadge kind="B" present={row.hasBpm} />
                    <TagBadge kind="K" present={row.hasKey} />
                    {isError ? (
                      <TagBadge kind="Erreur" present title={row.errorMessage ?? 'Erreur'} />
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
