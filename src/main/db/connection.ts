import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import { initSettingsSchema, createSettingsRepo, type SettingsRepo } from './settingsRepo'
import { initScanSchema, createScanRepo, type ScanRepo } from '../scan/scanRepo'
import {
  initConversionSchema,
  createConversionRepo,
  type ConversionRepo
} from '../conversion/conversionRepo'

let dbInstance: Database.Database | null = null
let settingsRepoInstance: SettingsRepo | null = null
let scanRepoInstance: ScanRepo | null = null
let conversionRepoInstance: ConversionRepo | null = null

/**
 * Open (or return the cached) better-sqlite3 connection at userData/cratekeeper.db.
 *
 * Lazy: defers app.getPath('userData') until first call so this module can be
 * imported in tests that never invoke openDb().
 */
export function openDb(): Database.Database {
  if (dbInstance) {
    return dbInstance
  }

  const dbPath = path.join(app.getPath('userData'), 'cratekeeper.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  initSettingsSchema(db)
  initScanSchema(db)
  initConversionSchema(db)

  dbInstance = db
  return db
}

/**
 * Get the default SettingsRepo bound to the userData database.
 * Tests should construct their own repo via createSettingsRepo(testDb).
 */
export function getSettingsRepo(): SettingsRepo {
  if (!settingsRepoInstance) {
    settingsRepoInstance = createSettingsRepo(openDb())
  }
  return settingsRepoInstance
}

/**
 * Get the default ScanRepo bound to the userData database.
 * Tests should construct their own repo via createScanRepo(testDb).
 */
export function getScanRepo(): ScanRepo {
  if (!scanRepoInstance) {
    scanRepoInstance = createScanRepo(openDb())
  }
  return scanRepoInstance
}

/**
 * Get the default ConversionRepo bound to the userData database.
 * Tests should construct their own repo via createConversionRepo(testDb).
 */
export function getConversionRepo(): ConversionRepo {
  if (!conversionRepoInstance) {
    conversionRepoInstance = createConversionRepo(openDb())
  }
  return conversionRepoInstance
}

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    settingsRepoInstance = null
    scanRepoInstance = null
    conversionRepoInstance = null
  }
}
