import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type DjUtilsApi } from '../shared/ipc-types'

const djUtils: DjUtilsApi = {
  pickFolder: () => ipcRenderer.invoke(IpcChannels.PickFolder),
  getRootFolder: () => ipcRenderer.invoke(IpcChannels.GetRootFolder),
  setRootFolder: (path: string) => ipcRenderer.invoke(IpcChannels.SetRootFolder, path)
}

// With contextIsolation:true + sandbox:true, only contextBridge works.
// The window.* fallback is kept for the (currently unused) isolation-off case.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('djUtils', djUtils)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.djUtils = djUtils
}
