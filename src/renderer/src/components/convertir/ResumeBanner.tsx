import type { ResumableBatch } from '../../../../shared/ipc-types'
import { useConversionStore } from '../../store/useConversionStore'

/**
 * ResumeBanner — Plan 03-03 (CONV-05).
 *
 * Shown above the PresetSelector in ConvertirView when crashed batches
 * exist on disk (boot sweep flipped their status to 'crashed' before the
 * window opened — Pitfall 9). One row per batch with the original preset
 * label + `Reprendre` / `Ignorer (supprimer)` actions.
 *
 * Renders null when resumableBatches is empty — no DOM noise on the
 * common happy path.
 */
export function ResumeBanner(): React.JSX.Element | null {
  const resumableBatches = useConversionStore((s) => s.resumableBatches)

  if (resumableBatches.length === 0) {
    return null
  }

  function handleResume(id: string): void {
    void useConversionStore.getState().resumeBatch(id)
  }

  function handleDiscard(id: string): void {
    void useConversionStore.getState().discardBatch(id)
  }

  return (
    <section
      className="resume-banner"
      role="region"
      aria-label="Conversion à reprendre"
    >
      {resumableBatches.map((batch: ResumableBatch) => {
        const filesLabel = `${batch.pendingCount} fichier${batch.pendingCount > 1 ? 's' : ''}`
        return (
          <div key={batch.conversionId} className="resume-banner__row">
            <div className="resume-banner__copy">
              <p className="resume-banner__question">
                Reprendre la conversion de {filesLabel} ?
              </p>
              <p className="resume-banner__preset">Format : {batch.preset.label}</p>
            </div>
            <div className="resume-banner__actions">
              <button
                type="button"
                className="resume-banner__action resume-banner__action--resume"
                onClick={() => handleResume(batch.conversionId)}
              >
                Reprendre
              </button>
              <button
                type="button"
                className="resume-banner__action resume-banner__action--discard"
                onClick={() => handleDiscard(batch.conversionId)}
              >
                Ignorer (supprimer)
              </button>
            </div>
          </div>
        )
      })}
    </section>
  )
}
