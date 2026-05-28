import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels } from '../../shared/ipc-types'
import { getSettingsRepo } from '../db/connection'

const ROOT_FOLDER_KEY = 'rootFolder'

/**
 * Register settings:get-folder and settings:set-folder ipcMain handlers.
 * set-folder type-checks the renderer-supplied path before persisting
 * (threat T-1-02: untrusted IPC argument from the renderer process).
 */
export function registerSettingsHandlers(): void {
  ipcMain.handle(IpcChannels.GetRootFolder, () => {
    return getSettingsRepo().get(ROOT_FOLDER_KEY)
  })

  ipcMain.handle(IpcChannels.SetRootFolder, (_event: IpcMainInvokeEvent, payload: unknown) => {
    if (typeof payload !== 'string') {
      throw new TypeError(`${IpcChannels.SetRootFolder}: path must be a string`)
    }
    getSettingsRepo().set(ROOT_FOLDER_KEY, payload)
  })
}
