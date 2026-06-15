import { useEffect } from 'react'
import { NavBar } from './components/nav/NavBar'
import { RootFolderPicker } from './components/folder/RootFolderPicker'
import { ErrorBoundary } from './components/ErrorBoundary'
import { AnalyserView } from './views/AnalyserView'
import { ConvertirView } from './views/ConvertirView'
import { TaggerView } from './views/TaggerView'
import { useAppStore, type Tool } from './store/useAppStore'

const VIEWS: Record<Tool, () => React.JSX.Element> = {
  analyser: AnalyserView,
  convertir: ConvertirView,
  tagger: TaggerView
}

function App(): React.JSX.Element {
  const activeTool = useAppStore((s) => s.activeTool)
  const loadRootFolder = useAppStore((s) => s.loadRootFolder)

  useEffect(() => {
    // FOUND-03: hydrate the previously chosen folder on mount.
    void loadRootFolder()
  }, [loadRootFolder])

  const ActiveView = VIEWS[activeTool]

  return (
    <div className="app-shell">
      <header className="app-shell__header">
        <div className="app-shell__brand">
          <span className="app-shell__brand-mark" aria-hidden="true">
            ◆
          </span>
          <span className="app-shell__brand-name">CrateKeeper</span>
        </div>
        <NavBar />
        <RootFolderPicker />
      </header>
      <main className="app-shell__main">
        {/* key by tool so switching views clears a prior view's error */}
        <ErrorBoundary key={activeTool}>
          <ActiveView />
        </ErrorBoundary>
      </main>
    </div>
  )
}

export default App
