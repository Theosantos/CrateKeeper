import { useAppStore } from '../../store/useAppStore'

function splitPath(path: string): { head: string; middle: string; tail: string } {
  const indices: number[] = []
  for (let i = 0; i < path.length; i++) {
    const ch = path[i]
    if (ch === '/' || ch === '\\') indices.push(i)
  }
  if (indices.length < 2) return { head: '', middle: '', tail: path }
  const second = indices[1]
  const last = indices[indices.length - 1]
  if (second >= last) return { head: '', middle: '', tail: path }
  return {
    head: path.slice(0, second),
    middle: path.slice(second, last),
    tail: path.slice(last)
  }
}

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
              {(() => {
                const { head, middle, tail } = splitPath(rootFolder)
                return (
                  <>
                    {head !== '' && (
                      <span className="folder-picker__path-head">{head}</span>
                    )}
                    {middle !== '' && (
                      <span className="folder-picker__path-middle">{middle}</span>
                    )}
                    <span className="folder-picker__path-tail">{tail}</span>
                  </>
                )
              })()}
            </code>
          </>
        ) : (
          <span className="folder-picker__empty">Aucun dossier sélectionné</span>
        )}
      </div>
    </div>
  )
}
