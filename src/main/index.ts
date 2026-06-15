import { app, shell, BrowserWindow, ipcMain, protocol } from 'electron'
import { join } from 'path'
import { Worker } from 'node:worker_threads'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { registerDialogHandlers } from './ipc/dialog'
import { registerSettingsHandlers } from './ipc/settings'
import { registerScanHandlers, makeRendererSender } from './ipc/scan'
import { createScanController } from './scan/controller'
import {
  getScanRepo,
  getSettingsRepo,
  getConversionRepo,
  getTaggerRepo
} from './db/connection'
import {
  registerConversionHandlers,
  makeConversionSender
} from './ipc/conversion'
import { createConversionController } from './conversion/controller'
import { resolveFfmpegPath } from './conversion/ffmpegPath'
import {
  AUDIO_PROTOCOL_SCHEME,
  registerAudioProtocol
} from './tagger/audioProtocol'
import { registerTaggerHandlers } from './ipc/tagger'
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ffmpegStatic = require('ffmpeg-static') as string

// Pitfall 2: must run before app.whenReady so <audio> treats cratekeeper://
// as a streaming origin (Phase 4 Tagger preview).
// corsEnabled is REQUIRED for wavesurfer.js — it fetch()es the audio URL to
// decode the waveform peaks, and that fetch is cross-origin relative to the
// renderer page. Without corsEnabled the response is opaque and decode never
// completes (no waveform, play stays disabled).
protocol.registerSchemesAsPrivileged([
  {
    scheme: AUDIO_PROTOCOL_SCHEME,
    privileges: {
      stream: true,
      supportFetchAPI: true,
      secure: true,
      standard: true,
      corsEnabled: true,
      bypassCSP: false
    }
  }
])

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
      sandbox: true,
      // Pitfall 5: Tagger preview auto-plays on card mount (no user gesture required)
      autoplayPolicy: 'no-user-gesture-required'
    }
  })

  win.on('ready-to-show', () => {
    win.show()
  })

  // Surface renderer crashes (white screen) in the terminal instead of failing
  // silently — `reason`/`exitCode` tell us OOM vs crash vs killed.
  win.webContents.on('render-process-gone', (_e, details) => {
    // eslint-disable-next-line no-console
    console.error('[main] renderer process gone:', details.reason, 'exitCode:', details.exitCode)
  })
  win.webContents.on('unresponsive', () => {
    // eslint-disable-next-line no-console
    console.error('[main] renderer became unresponsive')
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
  electronApp.setAppUserModelId('com.cratekeeper.app')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Register typed IPC handlers used by the window.crateKeeper contextBridge.
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

  // Phase 3: conversion backbone. The worker is bundled by electron-vite to
  // out/main/workers/conversionWorker.js (Pitfall 1 carry-forward). The
  // ffmpeg-static binary path is resolved once at controller construction
  // and rewritten from app.asar → app.asar.unpacked in packaged builds.
  //
  // Construction order (Pitfall 9): the conversion controller must exist
  // BEFORE the boot-time stale-heartbeat sweep, and the sweep must run
  // BEFORE createWindow() so the renderer never observes a 'running' row
  // that is actually crashed.
  const conversionSend = makeConversionSender(
    () => mainWindow?.webContents ?? null
  )
  const conversionRepo = getConversionRepo()
  const conversionController = createConversionController({
    spawnWorker: (data) =>
      new Worker(join(__dirname, 'workers/conversionWorker.js'), {
        workerData: data
      }),
    repo: conversionRepo,
    send: conversionSend,
    resolveFfmpegPath,
    getFfmpegRawPath: () => ffmpegStatic,
    isPackaged: app.isPackaged
  })

  // Pitfall 9: boot-time crash detection. Runs ONCE before createWindow().
  // Threshold = 30s (Pitfall 6: safe given default heartbeat = 5s).
  conversionController.markStaleAsCrashed({
    thresholdMs: 30_000,
    now: Date.now()
  })

  registerConversionHandlers({
    ipcMain,
    controller: conversionController,
    repo: conversionRepo,
    settingsRepo: getSettingsRepo(),
    getSender: () => mainWindow?.webContents ?? null
  })

  // Phase 4: Tagger backbone. Custom protocol handler streams audio files
  // under settings.rootFolder; IPC handlers expose the 6-channel surface
  // documented in 04-CONTEXT.md.
  registerAudioProtocol(getSettingsRepo())
  registerTaggerHandlers({
    ipcMain,
    taggerRepo: getTaggerRepo(),
    scanRepo: getScanRepo(),
    settingsRepo: getSettingsRepo(),
    resolveFfmpegPath: () =>
      resolveFfmpegPath({ rawPath: ffmpegStatic, isPackaged: app.isPackaged })
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
