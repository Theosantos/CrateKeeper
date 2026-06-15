interface RatingStarsProps {
  rating: number | null
  onChange: (rating: number | null) => void
}

/**
 * 1-5 clickable stars. Component emits the requested rating; toggle logic
 * (re-clicking the active star clears) lives in the store so dirtyEdits stay
 * the single source of truth.
 */
export function RatingStars({
  rating,
  onChange
}: RatingStarsProps): React.JSX.Element {
  return (
    <div
      className="tagger-stars"
      role="radiogroup"
      aria-label="Note 1 à 5 étoiles"
    >
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = rating !== null && rating >= n
        const label = n === 1 ? '1 étoile' : `${n} étoiles`
        return (
          <button
            key={n}
            type="button"
            className={
              'tagger-star' + (filled ? ' tagger-star--filled' : '')
            }
            aria-label={label}
            aria-pressed={filled}
            onClick={() => onChange(n)}
          >
            <span aria-hidden="true">★</span>
          </button>
        )
      })}
    </div>
  )
}
