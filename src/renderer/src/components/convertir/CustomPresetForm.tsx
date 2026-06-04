import { useConversionStore } from '../../store/useConversionStore'
import { CUSTOM_CODECS, isLosslessCodec } from './presets'

/**
 * Inline form for the Custom preset escape hatch. Renders only when the
 * parent has set selectedPreset.slug === 'custom'.
 *
 * Local validation here is for UX, not security — the main process
 * re-validates every payload (T-3-10 defence in depth).
 *
 *  - bitrate: 32–1024 kbps step 8 (matches main allowlist); ignored for
 *    FLAC and WAV (lossless), where the input is greyed out / disabled
 *  - sample rate: optional; empty = preserve source; 8000–192000 Hz
 */

export function CustomPresetForm(): React.JSX.Element {
  const customPreset = useConversionStore((s) => s.customPreset)
  const updateCustom = useConversionStore((s) => s.updateCustom)
  const codec = customPreset?.codec ?? 'libmp3lame'
  const bitrate = customPreset?.bitrateKbps ?? 320
  const sampleRate = customPreset?.sampleRate ?? null
  const lossless = isLosslessCodec(codec)

  function handleCodecChange(nextCodec: string): void {
    const entry = CUSTOM_CODECS.find((c) => c.codec === nextCodec)
    if (entry === undefined) return
    updateCustom({
      codec: entry.codec,
      extension: entry.extension,
      // FLAC/WAV ignore bitrate — null it out for clarity.
      bitrateKbps: isLosslessCodec(entry.codec) ? null : bitrate
    })
  }

  function handleBitrateChange(raw: string): void {
    if (raw === '') {
      updateCustom({ bitrateKbps: null })
      return
    }
    const n = Number(raw)
    if (Number.isInteger(n) && n > 0 && n <= 1024) {
      updateCustom({ bitrateKbps: n })
    }
  }

  function handleSampleRateChange(raw: string): void {
    if (raw === '') {
      updateCustom({ sampleRate: null })
      return
    }
    const n = Number(raw)
    if (Number.isInteger(n) && n >= 8000 && n <= 192_000) {
      updateCustom({ sampleRate: n })
    }
  }

  const bitrateInvalid =
    !lossless && (bitrate === null || bitrate <= 0 || bitrate > 1024)

  return (
    <div className="custom-preset" aria-label="Préréglage personnalisé">
      <label className="custom-preset__field">
        <span className="custom-preset__field-label">Codec</span>
        <select
          className="custom-preset__select"
          value={codec}
          onChange={(e) => handleCodecChange(e.target.value)}
          aria-label="Codec"
        >
          {CUSTOM_CODECS.map((c) => (
            <option key={c.codec} value={c.codec}>
              {c.label}
            </option>
          ))}
        </select>
      </label>

      <label className="custom-preset__field">
        <span className="custom-preset__field-label">Bitrate (kbps)</span>
        <input
          type="number"
          className="custom-preset__input"
          min={32}
          max={1024}
          step={8}
          value={lossless ? '' : bitrate ?? ''}
          onChange={(e) => handleBitrateChange(e.target.value)}
          disabled={lossless}
          aria-label="Bitrate (kbps)"
          aria-invalid={bitrateInvalid}
        />
        {lossless ? (
          <span className="custom-preset__hint">Ignoré pour les formats sans perte.</span>
        ) : null}
        {bitrateInvalid ? (
          <span className="custom-preset__error">
            Entre une valeur entière entre 32 et 1024.
          </span>
        ) : null}
      </label>

      <label className="custom-preset__field">
        <span className="custom-preset__field-label">Fréquence d’échantillonnage (Hz)</span>
        <input
          type="number"
          className="custom-preset__input"
          min={8000}
          max={192_000}
          step={100}
          placeholder="Conserver la source"
          value={sampleRate ?? ''}
          onChange={(e) => handleSampleRateChange(e.target.value)}
          aria-label="Fréquence d’échantillonnage (Hz)"
        />
      </label>
    </div>
  )
}

/** Computed validity used by the parent to gate the Lancer button. */
export function isCustomPresetValid(codec: string, bitrateKbps: number | null): boolean {
  if (isLosslessCodec(codec)) return true
  if (bitrateKbps === null) return false
  return Number.isInteger(bitrateKbps) && bitrateKbps > 0 && bitrateKbps <= 1024
}
