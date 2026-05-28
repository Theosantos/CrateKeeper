import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './useAppStore'

type MockedApi = {
  pickFolder: ReturnType<typeof vi.fn>
  getRootFolder: ReturnType<typeof vi.fn>
  setRootFolder: ReturnType<typeof vi.fn>
}

function installDjUtilsMock(overrides: Partial<MockedApi> = {}): MockedApi {
  const api: MockedApi = {
    pickFolder: vi.fn().mockResolvedValue(null),
    getRootFolder: vi.fn().mockResolvedValue(null),
    setRootFolder: vi.fn().mockResolvedValue(undefined),
    ...overrides
  }
  // The renderer only ever talks through window.djUtils — the preload exposes it.
  ;(globalThis as unknown as { window: Window & { djUtils: MockedApi } }).window.djUtils = api
  return api
}

describe('useAppStore', () => {
  beforeEach(() => {
    // Reset store between tests: clean slate for activeTool + rootFolder
    useAppStore.setState({ activeTool: 'analyser', rootFolder: null })
  })

  it('starts with activeTool = "analyser"', () => {
    expect(useAppStore.getState().activeTool).toBe('analyser')
  })

  it('setActiveTool("tagger") transitions activeTool to "tagger"', () => {
    useAppStore.getState().setActiveTool('tagger')
    expect(useAppStore.getState().activeTool).toBe('tagger')
  })

  it('loadRootFolder() pulls the persisted folder from window.djUtils.getRootFolder', async () => {
    const api = installDjUtilsMock({
      getRootFolder: vi.fn().mockResolvedValue('/Users/dj/music')
    })

    await useAppStore.getState().loadRootFolder()

    expect(api.getRootFolder).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/music')
  })

  it('pickRootFolder() persists + sets the chosen path; a cancelled dialog leaves state untouched', async () => {
    const chosenApi = installDjUtilsMock({
      pickFolder: vi.fn().mockResolvedValue('/Users/dj/library'),
      setRootFolder: vi.fn().mockResolvedValue(undefined)
    })

    await useAppStore.getState().pickRootFolder()

    expect(chosenApi.pickFolder).toHaveBeenCalledTimes(1)
    expect(chosenApi.setRootFolder).toHaveBeenCalledWith('/Users/dj/library')
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/library')

    // Now: user cancels the dialog → pickFolder returns null → rootFolder unchanged
    const cancelledApi = installDjUtilsMock({
      pickFolder: vi.fn().mockResolvedValue(null),
      setRootFolder: vi.fn().mockResolvedValue(undefined)
    })

    await useAppStore.getState().pickRootFolder()

    expect(cancelledApi.setRootFolder).not.toHaveBeenCalled()
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/library')
  })
})
