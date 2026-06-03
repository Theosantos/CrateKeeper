import { useEffect } from 'react'
import type { Preset } from '../../../../shared/ipc-types'
import { useAppStore } from '../../store/useAppStore'
import { useConversionStore } from '../../store/useConversionStore'
import { PresetSelector } from './PresetSelector'
import { CustomPresetForm, isCustomPresetValid } from './CustomPresetForm'
import { ConversionProgress } from './ConversionProgress'

/**
 * Top-level Convertir view.
 *
 * Lifecycle:
 *  - on mount: subscribe to djUtils.conversion.onEvent and clean up on
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

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const raw = await window.djUtils.getSetting('conversion.lastPreset')
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

  const count = pendingFilePaths.length

  return (
    <section className="view view--convertir" aria-labelledby="view-convertir-heading">
      <header className="view__header convertir__header">
        <p className="view__eyebrow">Phase 3</p>
        <h2 id="view-convertir-heading" className="view__title">
          Convertir {count} fichier{count > 1 ? 's' : ''}
        </h2>
        <button
          type="button"
          className="convertir__back"
          onClick={() => setActiveTool('analyser')}
        >
          ← Retour à l’Analyser
        </button>
      </header>

      <div className="convertir__body">
        <div className="convertir__config">
          <PresetSelector />
          {isCustom ? <CustomPresetForm /> : null}
        </div>

        <div className="convertir__actions">
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
          {error !== null ? (
            <p className="convertir__error" role="alert">
              {error}
            </p>
          ) : null}
        </div>

        <ConversionProgress />
      </div>
    </section>
  )
}
