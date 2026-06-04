import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAppStore } from './useAppStore'

import type { CrateKeeperApi } from '../../../shared/ipc-types'

type MockedApi = {
  pickFolder: ReturnType<typeof vi.fn<CrateKeeperApi['pickFolder']>>
  getRootFolder: ReturnType<typeof vi.fn<CrateKeeperApi['getRootFolder']>>
  setRootFolder: ReturnType<typeof vi.fn<CrateKeeperApi['setRootFolder']>>
}

function installCrateKeeperMock(overrides: Partial<MockedApi> = {}): MockedApi {
  const api: MockedApi = {
    pickFolder: vi.fn<CrateKeeperApi['pickFolder']>().mockResolvedValue(null),
    getRootFolder: vi.fn<CrateKeeperApi['getRootFolder']>().mockResolvedValue(null),
    setRootFolder: vi.fn<CrateKeeperApi['setRootFolder']>().mockResolvedValue(undefined),
    ...overrides
  }
  // The renderer only ever talks through window.crateKeeper — the preload exposes it.
  globalThis.window.crateKeeper = api as unknown as CrateKeeperApi
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

  it('loadRootFolder() pulls the persisted folder from window.crateKeeper.getRootFolder', async () => {
    const api = installCrateKeeperMock({
      getRootFolder: vi.fn().mockResolvedValue('/Users/dj/music')
    })

    await useAppStore.getState().loadRootFolder()

    expect(api.getRootFolder).toHaveBeenCalledTimes(1)
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/music')
  })

  it('pickRootFolder() persists + sets the chosen path; a cancelled dialog leaves state untouched', async () => {
    const chosenApi = installCrateKeeperMock({
      pickFolder: vi.fn().mockResolvedValue('/Users/dj/library'),
      setRootFolder: vi.fn().mockResolvedValue(undefined)
    })

    await useAppStore.getState().pickRootFolder()

    expect(chosenApi.pickFolder).toHaveBeenCalledTimes(1)
    expect(chosenApi.setRootFolder).toHaveBeenCalledWith('/Users/dj/library')
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/library')

    // Now: user cancels the dialog → pickFolder returns null → rootFolder unchanged
    const cancelledApi = installCrateKeeperMock({
      pickFolder: vi.fn().mockResolvedValue(null),
      setRootFolder: vi.fn().mockResolvedValue(undefined)
    })

    await useAppStore.getState().pickRootFolder()

    expect(cancelledApi.setRootFolder).not.toHaveBeenCalled()
    expect(useAppStore.getState().rootFolder).toBe('/Users/dj/library')
  })
})
