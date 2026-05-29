export function TaggerView(): React.JSX.Element {
  return (
    <section className="view" aria-labelledby="view-tagger-heading">
      <header className="view__header">
        <p className="view__eyebrow">Phase 4</p>
        <h2 id="view-tagger-heading" className="view__title">
          Tagger
        </h2>
        <p className="view__lede">
          Catégorise les sons non-classifiés à la Tinder — genre, BPM, key, écrits en ID3v2
          compatible Rekordbox.
        </p>
      </header>
      <p className="view__placeholder">L'interface gamifiée arrivera en Phase 4.</p>
    </section>
  )
}
