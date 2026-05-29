import { ipcMain, dialog as electronDialog } from 'electron'
import { IpcChannels } from '../../shared/ipc-types'

/** Minimal subset of electron.dialog used by pickFolderHandler — keeps the handler testable. */
export interface DialogApi {
  showOpenDialog(options: {
    properties: Array<'openDirectory' | 'openFile' | 'multiSelections'>
  }): Promise<{ canceled: boolean; filePaths: string[] }>
}

/**
 * Pure handler: opens the OS folder picker and returns the first selected path,
 * or null if the user cancelled or returned no paths.
 *
 * Exported as a standalone function (independent of ipcMain) so unit tests can
 * inject a mocked DialogApi without spinning up Electron.
 */
export async function pickFolderHandler(dialog: DialogApi): Promise<string | null> {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
  if (result.canceled || result.filePaths.length === 0) {
    return null
  }
  return result.filePaths[0]
}

/** Register the dialog:pick-folder ipcMain handler using the real electron dialog. */
export function registerDialogHandlers(): void {
  ipcMain.handle(IpcChannels.PickFolder, () => pickFolderHandler(electronDialog))
}
