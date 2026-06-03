import type { IpcMain, IpcMainInvokeEvent, WebContents } from 'electron'
import path from 'node:path'
import { IpcChannels, type ConversionEvent, type ResumableBatch } from '../../shared/ipc-types'
import type { ConversionController } from '../conversion/controller'
import { BatchAlreadyActive } from '../conversion/controller'
import type { SettingsRepo } from '../db/settingsRepo'
import { PRESETS } from '../conversion/presets'
import { AUDIO_EXTS } from '../workers/scanCore'

const ROOT_FOLDER_KEY = 'rootFolder'

const CUSTOM_CODEC_ALLOWLIST = [
  'libmp3lame',
  'aac',
  'flac',
  'pcm_s16le',
  'libopus'
] as const

export interface ConversionStartHandlerDeps {
  controller: ConversionController
  settingsRepo: SettingsRepo
}

export interface ConversionCancelHandlerDeps {
  controller: ConversionController
}

function assertObject(v: unknown, label: string): asserts v is Record<string, unknown> {
  if (v === null || typeof v !== 'object') {
    throw new TypeError(`${label}: payload must be an object`)
  }
}

function assertPreset(p: unknown): void {
  if (p === null || typeof p !== 'object') {
    throw new TypeError(`${IpcChannels.ConversionStart}: preset must be an object`)
  }
  const slug = (p as { slug?: unknown }).slug
  if (typeof slug !== 'string') {
    throw new TypeError(`${IpcChannels.ConversionStart}: preset.slug must be a string`)
  }
  const isKnown = PRESETS.some((known) => known.slug === slug)
  if (!isKnown && slug !== 'custom') {
    throw new Error(`${IpcChannels.ConversionStart}: unknown preset slug "${slug}"`)
  }
  if (slug === 'custom') {
    const codec = (p as { codec?: unknown }).codec
    if (typeof codec !== 'string') {
      throw new TypeError(`${IpcChannels.ConversionStart}: custom.codec must be a string`)
    }
    if (!(CUSTOM_CODEC_ALLOWLIST as readonly string[]).includes(codec)) {
      throw new Error(
        `${IpcChannels.ConversionStart}: custom.codec must be one of ${CUSTOM_CODEC_ALLOWLIST.join(', ')}`
      )
    }
    const br = (p as { bitrateKbps?: unknown }).bitrateKbps
    if (br !== null) {
      if (typeof br !== 'number' || !Number.isInteger(br) || br <= 0 || br > 1024) {
        throw new Error(
          `${IpcChannels.ConversionStart}: custom.bitrateKbps must be null or a positive integer ≤ 1024`
        )
      }
    }
  }
}

function resolvesUnderRoot(filePath: string, rootFolder: string): boolean {
  const resolvedFile = path.resolve(filePath)
  const resolvedRoot = path.resolve(rootFolder)
  return (
    resolvedFile === resolvedRoot ||
    resolvedFile.startsWith(resolvedRoot + path.sep)
  )
}

/**
 * conversion:start handler.
 *
 * V5 validation:
 *   - payload is an object
 *   - rootFolder === settingsRepo.get('rootFolder') (folder allowlist gate)
 *   - filePaths is a non-empty string[] where every entry resolves under
 *     rootFolder (Pitfall 8 — path traversal mitigation, T-3-01)
 *   - filePath extensions in AUDIO_EXTS (defence in depth — plan-checker
 *     SUGGESTION 1: AUDIO_EXTS server-side filter on V5 validation)
 *   - preset is a known slug OR 'custom' with allow-listed codec / bitrate
 *     (T-3-04 + T-3-08)
 *
 * Maps BatchAlreadyActive to a French-friendly error so the renderer can
 * surface a clean toast.
 */
export async function conversionStartHandler(
  deps: ConversionStartHandlerDeps,
  params: unknown
): Promise<string> {
  assertObject(params, IpcChannels.ConversionStart)
  const { rootFolder, filePaths, preset } = params

  if (typeof rootFolder !== 'string') {
    throw new TypeError(`${IpcChannels.ConversionStart}: rootFolder must be a string`)
  }
  const persisted = deps.settingsRepo.get(ROOT_FOLDER_KEY)
  if (persisted === null) {
    throw new Error(`${IpcChannels.ConversionStart}: no rootFolder configured`)
  }
  if (rootFolder !== persisted) {
    throw new Error(
      `${IpcChannels.ConversionStart}: rootFolder must equal the persisted rootFolder`
    )
  }

  if (!Array.isArray(filePaths) || filePaths.length === 0) {
    throw new TypeError(
      `${IpcChannels.ConversionStart}: filePaths must be a non-empty string[]`
    )
  }
  for (const f of filePaths) {
    if (typeof f !== 'string') {
      throw new TypeError(
        `${IpcChannels.ConversionStart}: filePaths entries must be strings`
      )
    }
    if (!resolvesUnderRoot(f, rootFolder)) {
      throw new Error(
        `${IpcChannels.ConversionStart}: file ${f} does not resolve under rootFolder ${rootFolder}`
      )
    }
    // Plan-checker SUGGESTION 1: defence-in-depth audio-extension filter.
    const ext = path.extname(f).toLowerCase()
    if (!(AUDIO_EXTS as readonly string[]).includes(ext)) {
      throw new Error(
        `${IpcChannels.ConversionStart}: file ${f} has unsupported extension`
      )
    }
  }

  assertPreset(preset)

  try {
    return await deps.controller.start({
      rootFolder,
      filePaths: filePaths as string[],
      preset: preset as Parameters<ConversionController['start']>[0]['preset']
    })
  } catch (err) {
    if (err instanceof BatchAlreadyActive) {
      throw new Error('Une conversion est déjà en cours')
    }
    throw err
  }
}

export async function conversionCancelHandler(
  deps: ConversionCancelHandlerDeps,
  id: unknown
): Promise<void> {
  if (typeof id !== 'string') {
    throw new TypeError(`${IpcChannels.ConversionCancel}: conversionId must be a string`)
  }
  await deps.controller.cancel(id)
}

/**
 * conversion:list-resumable handler — STUB returning [] for Plan 03-01.
 * Plan 03-03 replaces this with `deps.controller.listResumable()` once the
 * boot-time `markStaleAsCrashed` + UI banner is wired.
 */
export async function conversionListResumableHandler(): Promise<ResumableBatch[]> {
  return []
}

/**
 * conversion:resume handler — STUB throwing for Plan 03-01.
 * Plan 03-03 replaces this with `deps.controller.resume(id)`.
 */
export async function conversionResumeHandler(_id: unknown): Promise<void> {
  throw new Error('conversion:resume not implemented in Plan 03-01; see Plan 03-03')
}

export interface RegisterConversionHandlersOpts extends ConversionStartHandlerDeps {
  ipcMain: IpcMain
  getSender: () => WebContents | null
}

/**
 * Register the four conversion invoke channels on ipcMain. The
 * conversion:event push channel is forwarded by the controller's `send` dep
 * (not registered here — ipcMain.handle is renderer→main only).
 */
export function registerConversionHandlers(opts: RegisterConversionHandlersOpts): void {
  const startDeps: ConversionStartHandlerDeps = {
    controller: opts.controller,
    settingsRepo: opts.settingsRepo
  }
  const cancelDeps: ConversionCancelHandlerDeps = { controller: opts.controller }

  opts.ipcMain.handle(
    IpcChannels.ConversionStart,
    (_e: IpcMainInvokeEvent, params: unknown) =>
      conversionStartHandler(startDeps, params)
  )
  opts.ipcMain.handle(
    IpcChannels.ConversionCancel,
    (_e: IpcMainInvokeEvent, id: unknown) =>
      conversionCancelHandler(cancelDeps, id)
  )
  opts.ipcMain.handle(IpcChannels.ConversionListResumable, () =>
    conversionListResumableHandler()
  )
  opts.ipcMain.handle(
    IpcChannels.ConversionResume,
    (_e: IpcMainInvokeEvent, id: unknown) => conversionResumeHandler(id)
  )
}

/** Build the controller `send` dep that forwards ConversionEvent payloads. */
export function makeConversionSender(
  getSender: () => WebContents | null
): (channel: string, payload: ConversionEvent) => void {
  return (channel, payload): void => {
    const wc = getSender()
    if (!wc || wc.isDestroyed()) return
    wc.send(channel, payload)
  }
}
