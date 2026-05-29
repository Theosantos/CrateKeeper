import { create } from 'zustand'

export type Tool = 'analyser' | 'convertir' | 'tagger'

type AppState = {
  activeTool: Tool
  rootFolder: string | null
  setActiveTool: (tool: Tool) => void
  loadRootFolder: () => Promise<void>
  pickRootFolder: () => Promise<void>
}

// The renderer holds no Node/electron access (RESEARCH anti-pattern).
// Every privileged call routes through the typed contextBridge bridge: window.djUtils.
export const useAppStore = create<AppState>((set) => ({
  activeTool: 'analyser',
  rootFolder: null,

  setActiveTool: (tool) => set({ activeTool: tool }),

  loadRootFolder: async () => {
    const folder = await window.djUtils.getRootFolder()
    set({ rootFolder: folder })
  },

  pickRootFolder: async () => {
    const chosen = await window.djUtils.pickFolder()
    if (chosen === null) return
    await window.djUtils.setRootFolder(chosen)
    set({ rootFolder: chosen })
  }
}))
