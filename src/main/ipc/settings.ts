import { ipcMain, type IpcMainInvokeEvent } from 'electron'
import { IpcChannels, SETTINGS_KEY_ALLOWLIST } from '../../shared/ipc-types'
import { getSettingsRepo } from '../db/connection'

const ROOT_FOLDER_KEY = 'rootFolder'

/** Bound on the renderer-supplied value to limit storage abuse (T-3-10 echo). */
const MAX_SETTING_VALUE_BYTES = 8 * 1024

function isAllowedKey(key: unknown): key is (typeof SETTINGS_KEY_ALLOWLIST)[number] {
  return typeof key === 'string' && (SETTINGS_KEY_ALLOWLIST as readonly string[]).includes(key)
}

/**
 * Register the settings ipcMain handlers.
 *
 * - get-folder / set-folder: the legacy Phase 1 root folder surface, kept
 *   intact for compatibility with the existing renderer code path.
 * - get / set (Plan 03-02): a typed K/V surface used to persist
 *   `conversion.lastPreset`. The key MUST appear in SETTINGS_KEY_ALLOWLIST
 *   — anything else is rejected before touching the repo (T-1-02).
 *   Values are bounded to MAX_SETTING_VALUE_BYTES bytes; the repo treats
 *   them as opaque strings (JSON serialisation lives on the renderer).
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

  ipcMain.handle(IpcChannels.GetSetting, (_event: IpcMainInvokeEvent, key: unknown) => {
    if (!isAllowedKey(key)) {
      throw new Error(`${IpcChannels.GetSetting}: key not in allowlist`)
    }
    return getSettingsRepo().get(key)
  })

  ipcMain.handle(
    IpcChannels.SetSetting,
    (_event: IpcMainInvokeEvent, key: unknown, value: unknown) => {
      if (!isAllowedKey(key)) {
        throw new Error(`${IpcChannels.SetSetting}: key not in allowlist`)
      }
      if (typeof value !== 'string') {
        throw new TypeError(`${IpcChannels.SetSetting}: value must be a string`)
      }
      if (Buffer.byteLength(value, 'utf8') > MAX_SETTING_VALUE_BYTES) {
        throw new Error(
          `${IpcChannels.SetSetting}: value exceeds ${MAX_SETTING_VALUE_BYTES} bytes`
        )
      }
      getSettingsRepo().set(key, value)
    }
  )
}
