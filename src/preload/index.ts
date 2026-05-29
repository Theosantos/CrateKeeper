import { contextBridge, ipcRenderer } from 'electron'
import { IpcChannels, type DjUtilsApi, type ScanEvent } from '../shared/ipc-types'

const djUtils: DjUtilsApi = {
  pickFolder: () => ipcRenderer.invoke(IpcChannels.PickFolder),
  getRootFolder: () => ipcRenderer.invoke(IpcChannels.GetRootFolder),
  setRootFolder: (path: string) => ipcRenderer.invoke(IpcChannels.SetRootFolder, path),
  scan: {
    start: (folder: string) => ipcRenderer.invoke(IpcChannels.ScanStart, folder),
    cancel: (scanId: string) => ipcRenderer.invoke(IpcChannels.ScanCancel, scanId),
    exportCsv: (scanId: string) => ipcRenderer.invoke(IpcChannels.ScanExportCsv, scanId),
    onEvent: (cb: (e: ScanEvent) => void) => {
      const handler = (_: unknown, e: ScanEvent): void => cb(e)
      ipcRenderer.on(IpcChannels.ScanEvent, handler)
      return () => {
        ipcRenderer.off(IpcChannels.ScanEvent, handler)
      }
    }
  }
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
