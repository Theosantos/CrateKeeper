import { ElectronAPI } from '@electron-toolkit/preload'
import type { CrateKeeperApi } from '../shared/ipc-types'

declare global {
  interface Window {
    electron: ElectronAPI
    crateKeeper: CrateKeeperApi
  }
}
