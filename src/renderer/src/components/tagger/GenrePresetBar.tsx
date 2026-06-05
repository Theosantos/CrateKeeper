interface GenrePresetBarProps {
  presets: string[]
  onApply: (slot: number) => void
}

/**
 * 9-button genre quick-bar. Each button shows the slot number (1-9) hint and
 * the preset label. Clicking emits onApply(slot) which the store maps to
 * dirtyEdits.genre = genrePresets[slot-1].
 *
 * Defensive: if presets.length < 9 (mid-load), renders only what is available
 * rather than crashing on undefined slots.
 */
export function GenrePresetBar({
  presets,
  onApply
}: GenrePresetBarProps): React.JSX.Element {
  return (
    <div className="tagger-preset-bar" role="toolbar" aria-label="Genres rapides">
      {presets.slice(0, 9).map((label, i) => {
        const slot = i + 1
        return (
          <button
            key={slot}
            type="button"
            className="tagger-preset"
            onClick={() => onApply(slot)}
          >
            <span className="tagger-preset__hint" aria-hidden="true">
              {slot}
            </span>
            <span className="tagger-preset__label">{label}</span>
          </button>
        )
      })}
    </div>
  )
}
