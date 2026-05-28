import { useAppStore } from '../../store/useAppStore'

export function RootFolderPicker(): React.JSX.Element {
  const rootFolder = useAppStore((s) => s.rootFolder)
  const pickRootFolder = useAppStore((s) => s.pickRootFolder)

  return (
    <div className="folder-picker">
      <button
        type="button"
        className="folder-picker__button"
        onClick={() => {
          // Fire-and-forget — store updates state on resolve.
          void pickRootFolder()
        }}
      >
        Choisir un dossier
      </button>
      <div className="folder-picker__path" aria-live="polite">
        {rootFolder !== null ? (
          <>
            <span className="folder-picker__path-label">Bibliothèque</span>
            <code className="folder-picker__path-value" title={rootFolder}>
              {rootFolder}
            </code>
          </>
        ) : (
          <span className="folder-picker__empty">Aucun dossier sélectionné</span>
        )}
      </div>
    </div>
  )
}
