export function ConvertirView(): React.JSX.Element {
  return (
    <section className="view" aria-labelledby="view-convertir-heading">
      <header className="view__header">
        <p className="view__eyebrow">Phase 3</p>
        <h2 id="view-convertir-heading" className="view__title">
          Convertir
        </h2>
        <p className="view__lede">
          Convertis vers le format et le bitrate cible. Pipeline non-bloquant via worker threads.
        </p>
      </header>
      <p className="view__placeholder">Le moteur de conversion arrivera en Phase 3.</p>
    </section>
  )
}
