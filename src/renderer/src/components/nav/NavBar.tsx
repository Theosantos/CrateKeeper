import { useAppStore, type Tool } from '../../store/useAppStore'

type ToolEntry = {
  id: Tool
  label: string
  hint: string
}

const TOOLS: readonly ToolEntry[] = [
  { id: 'analyser', label: 'Analyser', hint: 'Scan & inspect' },
  { id: 'convertir', label: 'Convertir', hint: 'Format & bitrate' },
  { id: 'tagger', label: 'Tagger', hint: 'Categorise unsorted' }
] as const

export function NavBar(): React.JSX.Element {
  const activeTool = useAppStore((s) => s.activeTool)
  const setActiveTool = useAppStore((s) => s.setActiveTool)

  return (
    <nav className="tool-nav" aria-label="Outils principaux">
      <ul className="tool-nav__list">
        {TOOLS.map((tool) => {
          const isActive = tool.id === activeTool
          return (
            <li key={tool.id} className="tool-nav__item">
              <button
                type="button"
                className={`tool-nav__button${isActive ? ' is-active' : ''}`}
                aria-current={isActive ? 'page' : undefined}
                onClick={() => setActiveTool(tool.id)}
              >
                <span className="tool-nav__label">{tool.label}</span>
                <span className="tool-nav__hint">{tool.hint}</span>
              </button>
            </li>
          )
        })}
      </ul>
    </nav>
  )
}
