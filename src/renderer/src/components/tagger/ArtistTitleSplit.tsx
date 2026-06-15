import { suggestSplits, type SplitOption } from './splitDetection'

interface ArtistTitleSplitProps {
  title: string
  artistEmpty: boolean
  onApply: (option: SplitOption) => void
}

/**
 * 2-suggestion banner shown ONLY when the artist field is empty AND the title
 * contains one of the LOCKED separators (' - ', ' -- ', ' – ').
 *
 * Either suggestion fills BOTH artist and title with one click.
 */
export function ArtistTitleSplit({
  title,
  artistEmpty,
  onApply
}: ArtistTitleSplitProps): React.JSX.Element | null {
  if (!artistEmpty) return null
  const r = suggestSplits(title)
  if (r === null) return null

  return (
    <div
      className="tagger-split-banner"
      role="region"
      aria-label="Suggestion Artiste / Titre"
    >
      <p className="tagger-split-banner__hint">
        Le titre semble contenir un séparateur. Choisis le bon découpage :
      </p>
      <div className="tagger-split-banner__options">
        <button
          type="button"
          className="tagger-split-option"
          onClick={() => onApply(r.a)}
        >
          Artiste : {r.a.artist} · Titre : {r.a.title}
        </button>
        <button
          type="button"
          className="tagger-split-option"
          onClick={() => onApply(r.b)}
        >
          Artiste : {r.b.artist} · Titre : {r.b.title}
        </button>
      </div>
    </div>
  )
}
