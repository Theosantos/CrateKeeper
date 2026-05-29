import { ScanToolbar } from '../components/analyser/ScanToolbar'
import { VirtualizedFileTable } from '../components/analyser/VirtualizedFileTable'
import { useScanStore } from '../store/useScanStore'

export function AnalyserView(): React.JSX.Element {
  const rows = useScanStore((s) => s.rows)

  return (
    <section className="view view--analyser" aria-labelledby="view-analyser-heading">
      <header className="view__header">
        <p className="view__eyebrow">Phase 2</p>
        <h2 id="view-analyser-heading" className="view__title">
          Analyser
        </h2>
        <p className="view__lede">
          Scan ta bibliothèque, repère les fichiers sans métadonnées et exporte la liste.
        </p>
      </header>
      <ScanToolbar />
      <VirtualizedFileTable rows={rows} />
    </section>
  )
}
