import { ElectronAPI } from '@electron-toolkit/preload'
import type { DjUtilsApi } from '../shared/ipc-types'

declare global {
  interface Window {
    electron: ElectronAPI
    djUtils: DjUtilsApi
  }
}
