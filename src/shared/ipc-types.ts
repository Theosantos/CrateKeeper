/**
 * Shared IPC types for the contextBridge `window.djUtils` API.
 * Imported by main (handler registration), preload (bridge exposure),
 * and renderer (typed window.djUtils).
 */

/** Channel names — single source of truth so main + preload never drift. */
export const IpcChannels = {
  PickFolder: 'dialog:pick-folder',
  GetRootFolder: 'settings:get-folder',
  SetRootFolder: 'settings:set-folder'
} as const

export type IpcChannel = (typeof IpcChannels)[keyof typeof IpcChannels]

export interface DjUtilsApi {
  pickFolder(): Promise<string | null>
  getRootFolder(): Promise<string | null>
  setRootFolder(path: string): Promise<void>
}

declare global {
  interface Window {
    djUtils: DjUtilsApi
  }
}
