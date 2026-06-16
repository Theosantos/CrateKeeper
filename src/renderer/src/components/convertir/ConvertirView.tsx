import { useEffect } from 'react'
import type { Preset } from '../../../../shared/ipc-types'
import { useAppStore } from '../../store/useAppStore'
import { useConversionStore } from '../../store/useConversionStore'
import { PresetSelector } from './PresetSelector'
import { CustomPresetForm, isCustomPresetValid } from './CustomPresetForm'
import { ConversionProgress } from './ConversionProgress'
import { ResumeBanner } from './ResumeBanner'

/**
 * Top-level Convertir view.
 *
 * Lifecycle:
 *  - on mount: subscribe to crateKeeper.conversion.onEvent and clean up on
 *    unmount (useEffect with returned closure)
 *  - on mount: one-shot load of conversion.lastPreset from settings;
 *    if present, apply via setPreset (LOCKED persistence)
 */

function parseSavedPreset(raw: string | null): Preset | null {
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw) as Preset
    if (typeof parsed.slug !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

export function ConvertirView(): React.JSX.Element {
  const pendingFilePaths = useConversionStore((s) => s.pendingFilePaths)
  const status = useConversionStore((s) => s.status)
  const selectedPreset = useConversionStore((s) => s.selectedPreset)
  const customPreset = useConversionStore((s) => s.customPreset)
  const error = useConversionStore((s) => s.error)
  const rootFolder = useAppStore((s) => s.rootFolder)
  const setActiveTool = useAppStore((s) => s.setActiveTool)

  useEffect(() => {
    const off = useConversionStore.getState().subscribeEvents()
    return off
  }, [])

  // Plan 03-03: one-shot crash-detection check on Convertir mount.
  // LOCKED Pitfall 9: NOT polling — the boot sweep already flipped crashed
  // rows BEFORE the window was created, so a single fetch is sufficient.
  useEffect(() => {
    void useConversionStore.getState().checkResumable()
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const raw = await window.crateKeeper.getSetting('conversion.lastPreset')
      if (cancelled) return
      const saved = parseSavedPreset(raw)
      if (saved !== null) {
        useConversionStore.getState().setPreset(saved)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const isRunning = status === 'running'
  const isCustom = selectedPreset.slug === 'custom'
  const customValid = !isCustom
    ? true
    : isCustomPresetValid(
        customPreset?.codec ?? 'libmp3lame',
        customPreset?.bitrateKbps ?? null
      )
  const canLaunch =
    !isRunning && pendingFilePaths.length > 0 && customValid && rootFolder !== null

  function handleLaunch(): void {
    if (rootFolder === null) return
    void useConversionStore.getState().startBatch(rootFolder)
  }

  function handleCancel(): void {
    void useConversionStore.getState().cancelBatch()
  }

  async function handlePickFiles(): Promise<void> {
    const picked = await window.crateKeeper.conversion.pickFiles()
    if (picked === null) return
    if (picked.length === 0) return
    useConversionStore.getState().seedFilePaths(picked)
  }

  const count = pendingFilePaths.length
  const showEmptyState = !isRunning && count === 0 && status !== 'done'

  return (
    <section className="view view--convertir" aria-labelledby="view-convertir-heading">
      <header className="view__header convertir__header">
        <div className="convertir__header-text">
          <h2 id="view-convertir-heading" className="view__title">
            {count === 0
              ? 'Convertir'
              : `Convertir ${count} fichier${count > 1 ? 's' : ''}`}
          </h2>
          <p className="view__lede">
            Choisis un format de sortie et convertis ta sélection en un lot.
          </p>
        </div>
        <button
          type="button"
          className="convertir__back"
          onClick={() => setActiveTool('analyser')}
        >
          ← Retour à l’Analyser
        </button>
      </header>

      <div className="convertir__body">
        <ResumeBanner />
        <div className="convertir__config">
          <PresetSelector />
          {isCustom ? <CustomPresetForm /> : null}
        </div>

        {showEmptyState ? (
          <div className="convertir__empty">
            <h3 className="convertir__empty-title">Aucun fichier sélectionné</h3>
            <p className="convertir__empty-hint">
              Choisis des fichiers audio à convertir directement, ou passe par
              l’Analyser pour sélectionner depuis un scan existant.
            </p>
            <div className="convertir__empty-actions">
              <button
                type="button"
                className="convertir__action convertir__action--launch"
                onClick={() => void handlePickFiles()}
                disabled={rootFolder === null}
              >
                Choisir des fichiers
              </button>
              <button
                type="button"
                className="convertir__back"
                onClick={() => setActiveTool('analyser')}
              >
                Ouvrir l’Analyser →
              </button>
            </div>
            {rootFolder === null ? (
              <p className="convertir__empty-warn" role="alert">
                Sélectionne d’abord un dossier racine depuis l’Analyser.
              </p>
            ) : null}
          </div>
        ) : (
          <ConversionProgress />
        )}

        <div className="convertir__actions">
          {error !== null ? (
            <p className="convertir__error" role="alert">
              {error}
            </p>
          ) : null}
          {isRunning ? (
            <button
              type="button"
              className="convertir__action convertir__action--cancel"
              onClick={handleCancel}
            >
              Annuler
            </button>
          ) : (
            <button
              type="button"
              className="convertir__action convertir__action--launch"
              onClick={handleLaunch}
              disabled={!canLaunch}
            >
              Lancer
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
