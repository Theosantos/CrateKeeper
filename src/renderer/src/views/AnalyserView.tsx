export function AnalyserView(): React.JSX.Element {
  return (
    <section className="view" aria-labelledby="view-analyser-heading">
      <header className="view__header">
        <p className="view__eyebrow">Phase 2</p>
        <h2 id="view-analyser-heading" className="view__title">
          Analyser
        </h2>
        <p className="view__lede">
          Scan ta bibliothèque, repère les doublons, isole les fichiers sans métadonnées.
        </p>
      </header>
      <p className="view__placeholder">L'analyseur batch arrivera en Phase 2.</p>
    </section>
  )
}
