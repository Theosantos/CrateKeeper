import Database from 'better-sqlite3'
import { app } from 'electron'
import path from 'node:path'
import { initSettingsSchema, createSettingsRepo, type SettingsRepo } from './settingsRepo'

let dbInstance: Database.Database | null = null
let settingsRepoInstance: SettingsRepo | null = null

/**
 * Open (or return the cached) better-sqlite3 connection at userData/dj-utils.db.
 *
 * Lazy: defers app.getPath('userData') until first call so this module can be
 * imported in tests that never invoke openDb().
 */
export function openDb(): Database.Database {
  if (dbInstance) {
    return dbInstance
  }

  const dbPath = path.join(app.getPath('userData'), 'dj-utils.db')
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  initSettingsSchema(db)

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

export function closeDb(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
    settingsRepoInstance = null
  }
}
