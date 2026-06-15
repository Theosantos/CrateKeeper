import { contextBridge, ipcRenderer } from 'electron'
import {
  IpcChannels,
  type CrateKeeperApi,
  type ScanEvent,
  type ConversionEvent,
  type Preset,
  type ResumableBatch,
  type TaggerQueueResult,
  type TaggerSession,
  type GenrePresetsResult,
  type SaveTagEditInput,
  type WaveformResult
} from '../shared/ipc-types'

const crateKeeper: CrateKeeperApi = {
  pickFolder: () => ipcRenderer.invoke(IpcChannels.PickFolder),
  getRootFolder: () => ipcRenderer.invoke(IpcChannels.GetRootFolder),
  setRootFolder: (path: string) => ipcRenderer.invoke(IpcChannels.SetRootFolder, path),
  getSetting: (key) => ipcRenderer.invoke(IpcChannels.GetSetting, key),
  setSetting: (key, value) => ipcRenderer.invoke(IpcChannels.SetSetting, key, value),
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
  },
  conversion: {
    start: (params: { rootFolder: string; filePaths: string[]; preset: Preset }) =>
      ipcRenderer.invoke(IpcChannels.ConversionStart, params),
    cancel: (conversionId: string) =>
      ipcRenderer.invoke(IpcChannels.ConversionCancel, conversionId),
    listResumable: (): Promise<ResumableBatch[]> =>
      ipcRenderer.invoke(IpcChannels.ConversionListResumable),
    resume: (conversionId: string) =>
      ipcRenderer.invoke(IpcChannels.ConversionResume, conversionId),
    discard: (conversionId: string) =>
      ipcRenderer.invoke(IpcChannels.ConversionDiscard, conversionId),
    pickFiles: (): Promise<string[] | null> =>
      ipcRenderer.invoke(IpcChannels.ConversionPickFiles),
    onEvent: (cb: (e: ConversionEvent) => void) => {
      const handler = (_: unknown, e: ConversionEvent): void => cb(e)
      ipcRenderer.on(IpcChannels.ConversionEvent, handler)
      return () => {
        ipcRenderer.off(IpcChannels.ConversionEvent, handler)
      }
    }
  },
  tagger: {
    loadQueue: (): Promise<TaggerQueueResult> =>
      ipcRenderer.invoke(IpcChannels.TaggerLoadQueue),
    saveEdit: (input: SaveTagEditInput): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TaggerSaveEdit, input),
    deleteEdit: (filePath: string): Promise<void> =>
      ipcRenderer.invoke(IpcChannels.TaggerDeleteEdit, filePath),
    getSession: (): Promise<TaggerSession | null> =>
      ipcRenderer.invoke(IpcChannels.TaggerGetSession),
    setSession: (input: {
      currentFilePath: string | null
      scanId: string | null
    }): Promise<void> => ipcRenderer.invoke(IpcChannels.TaggerSetSession, input),
    getGenrePresets: (): Promise<GenrePresetsResult> =>
      ipcRenderer.invoke(IpcChannels.TaggerGetGenrePresets),
    getWaveform: (filePath: string, bars: number): Promise<WaveformResult> =>
      ipcRenderer.invoke(IpcChannels.TaggerGetWaveform, filePath, bars)
  }
}

// With contextIsolation:true + sandbox:true, only contextBridge works.
// The window.* fallback is kept for the (currently unused) isolation-off case.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('crateKeeper', crateKeeper)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.crateKeeper = crateKeeper
}
