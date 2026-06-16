import { useTaggerStore } from '../../store/useTaggerStore'

/**
 * ApplyBanner — Plan 05-03.
 *
 * Shows the "Appliquer (N)" CTA when there are pending tag edits to flush
 * to disk. While applying, the button is disabled and shows "Écriture…".
 * After the batch finishes, per-file Écrit/Erreur badges and a summary line
 * are displayed.
 *
 * Renders null when pendingWriteCount === 0 AND no result AND not applying
 * so there is no DOM noise on the common happy path (mirrors ResumeBanner).
 *
 * Security: file paths and error text are rendered as React text children —
 * no dangerouslySetInnerHTML (T-05-UI-XSS mitigation).
 */

function basename(path: string): string {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return i >= 0 ? path.slice(i + 1) : path
}

export function ApplyBanner(): React.JSX.Element | null {
  const pendingWriteCount = useTaggerStore((s) => s.pendingWriteCount)
  const isApplying = useTaggerStore((s) => s.isApplying)
  const applyResult = useTaggerStore((s) => s.applyResult)
  const applyError = useTaggerStore((s) => s.applyError)
  const writeResults = useTaggerStore((s) => s.writeResults)

  if (pendingWriteCount === 0 && applyResult === null && !isApplying) {
    return null
  }

  function handleApply(): void {
    void useTaggerStore.getState().applyWrites()
  }

  const tagLabel = `tag${pendingWriteCount > 1 ? 's' : ''}`

  return (
    <section
      className="apply-banner"
      role="region"
      aria-label="Tags en attente d'écriture"
    >
      <div className="apply-banner__header">
        {pendingWriteCount > 0 && (
          <p className="apply-banner__count">
            {pendingWriteCount} {tagLabel} en attente
          </p>
        )}
        <button
          type="button"
          className="apply-banner__cta"
          onClick={handleApply}
          disabled={isApplying || pendingWriteCount === 0}
          aria-busy={isApplying}
        >
          {isApplying ? 'Écriture…' : `Appliquer (${pendingWriteCount})`}
        </button>
      </div>

      {applyError !== null && (
        <p className="apply-banner__error" role="alert">
          {applyError}
        </p>
      )}

      {applyResult !== null && (
        <p className="apply-banner__summary" role="status">
          {applyResult.totalWritten} écrits, {applyResult.totalFailed} erreurs
        </p>
      )}

      {writeResults.size > 0 && (
        <ul className="apply-banner__results">
          {Array.from(writeResults.entries()).map(([filePath, result]) => (
            <li key={filePath} className="apply-banner__result-row">
              <span
                className={`apply-banner__badge ${
                  result.ok
                    ? 'apply-banner__badge--done'
                    : 'apply-banner__badge--error'
                }`}
              >
                {result.ok ? 'Écrit' : 'Erreur'}
              </span>
              <span className="apply-banner__result-name" title={filePath}>
                {basename(filePath)}
              </span>
              {!result.ok && result.error !== undefined && (
                <span className="apply-banner__result-error">{result.error}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
