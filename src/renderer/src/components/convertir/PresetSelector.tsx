import type { Preset } from '../../../../shared/ipc-types'
import { useConversionStore } from '../../store/useConversionStore'
import { PRESETS } from './presets'

/**
 * Six radio buttons: 5 locked presets (D-CONV-FORMAT) + a Custom escape hatch.
 * Selection is owned by useConversionStore.selectedPreset; switching to
 * `custom` also initialises customPreset with a sensible seed via setPreset.
 *
 * All labels are French. Tokens reused from main.css :root — no new
 * --color-* declared (LOCKED Editorial dark-studio rule).
 */

const CUSTOM_SEED: Preset = {
  slug: 'custom',
  label: 'Personnalisé',
  codec: 'libmp3lame',
  bitrateKbps: 320,
  vbrQuality: null,
  sampleRate: null,
  extension: '.mp3'
}

export function PresetSelector(): React.JSX.Element {
  const selectedPreset = useConversionStore((s) => s.selectedPreset)
  const setPreset = useConversionStore((s) => s.setPreset)

  return (
    <fieldset className="preset-selector">
      <legend className="preset-selector__legend">Format de sortie</legend>
      <div className="preset-selector__options">
        {PRESETS.map((p) => {
          const isActive = selectedPreset.slug === p.slug
          return (
            <label
              key={p.slug}
              className={`preset-option${isActive ? ' preset-option--active' : ''}`}
            >
              <input
                type="radio"
                name="preset"
                value={p.slug}
                checked={isActive}
                onChange={() => setPreset(p)}
              />
              <span className="preset-option__label">{p.label}</span>
            </label>
          )
        })}
        <label
          className={`preset-option preset-option--custom${
            selectedPreset.slug === 'custom' ? ' preset-option--active' : ''
          }`}
        >
          <input
            type="radio"
            name="preset"
            value="custom"
            checked={selectedPreset.slug === 'custom'}
            onChange={() => setPreset(CUSTOM_SEED)}
          />
          <span className="preset-option__label">Personnalisé…</span>
        </label>
      </div>
    </fieldset>
  )
}
