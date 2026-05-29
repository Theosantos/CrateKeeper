import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { Worker } from 'node:worker_threads'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerDialogHandlers } from './ipc/dialog'
import { registerSettingsHandlers } from './ipc/settings'
import { registerScanHandlers, makeRendererSender } from './ipc/scan'
import { createScanController } from './scan/controller'
import { getScanRepo, getSettingsRepo } from './db/connection'

let mainWindow: BrowserWindow | null = null

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return win
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register typed IPC handlers used by the window.djUtils contextBridge.
  registerDialogHandlers()
  registerSettingsHandlers()

  // Phase 2: scan backbone. The worker is bundled by electron-vite to
  // out/main/workers/scanWorker.js (RESEARCH Pitfall 1 — see electron.vite.config.ts).
  const send = makeRendererSender(() => mainWindow?.webContents ?? null)
  const scanController = createScanController({
    spawnWorker: (folder, scanId) =>
      new Worker(join(__dirname, 'workers/scanWorker.js'), {
        workerData: { folder, scanId }
      }),
    repo: getScanRepo(),
    send
  })
  registerScanHandlers({
    ipcMain,
    controller: scanController,
    settingsRepo: getSettingsRepo(),
    scanRepo: getScanRepo(),
    getSender: () => mainWindow?.webContents ?? null
  })

  mainWindow = createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
    }
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
