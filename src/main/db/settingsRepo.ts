import type Database from 'better-sqlite3'

export interface SettingsRepo {
  get(key: string): string | null
  set(key: string, value: string): void
}

/**
 * Ensure the settings(key TEXT PRIMARY KEY, value TEXT) table exists.
 * Safe to call repeatedly.
 */
export function initSettingsSchema(db: Database.Database): void {
  db.exec('CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
}

/**
 * Build a key/value SettingsRepo bound to the given Database instance.
 * Uses prepared statements only — no string-interpolated SQL.
 * Tests inject a ':memory:' Database; production binds to the userData DB.
 */
export function createSettingsRepo(db: Database.Database): SettingsRepo {
  const getStmt = db.prepare('SELECT value FROM settings WHERE key = ?')
  const setStmt = db.prepare(
    'INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )

  return {
    get(key: string): string | null {
      if (typeof key !== 'string') {
        throw new TypeError('SettingsRepo.get: key must be a string')
      }
      const row = getStmt.get(key) as { value: string } | undefined
      return row?.value ?? null
    },

    set(key: string, value: string): void {
      if (typeof key !== 'string') {
        throw new TypeError('SettingsRepo.set: key must be a string')
      }
      if (typeof value !== 'string') {
        throw new TypeError('SettingsRepo.set: value must be a string')
      }
      setStmt.run(key, value)
    }
  }
}
