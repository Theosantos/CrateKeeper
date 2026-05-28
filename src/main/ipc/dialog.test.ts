import { describe, it, expect, vi } from 'vitest'

// Electron is not available in the Node test runner — mock the module so that
// importing ./dialog (which imports from 'electron' at top level) does not fail.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  dialog: { showOpenDialog: vi.fn() }
}))

import { pickFolderHandler, type DialogApi } from './dialog'

function mockDialog(result: { canceled: boolean; filePaths: string[] }): DialogApi {
  return {
    showOpenDialog: vi.fn().mockResolvedValue(result)
  }
}

describe('pickFolderHandler', () => {
  it('returns the first selected path when the user picks a directory', async () => {
    const dialog = mockDialog({ canceled: false, filePaths: ['/Music'] })
    await expect(pickFolderHandler(dialog)).resolves.toBe('/Music')
    expect(dialog.showOpenDialog).toHaveBeenCalledWith({ properties: ['openDirectory'] })
  })

  it('returns null when the user cancels the dialog', async () => {
    const dialog = mockDialog({ canceled: true, filePaths: [] })
    await expect(pickFolderHandler(dialog)).resolves.toBeNull()
  })

  it('returns null when the dialog resolves with no paths', async () => {
    const dialog = mockDialog({ canceled: false, filePaths: [] })
    await expect(pickFolderHandler(dialog)).resolves.toBeNull()
  })
})
