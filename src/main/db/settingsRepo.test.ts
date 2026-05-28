import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { createSettingsRepo, initSettingsSchema, type SettingsRepo } from './settingsRepo'

describe('SettingsRepo', () => {
  let db: Database.Database
  let repo: SettingsRepo

  beforeEach(() => {
    db = new Database(':memory:')
    initSettingsSchema(db)
    repo = createSettingsRepo(db)
  })

  it('returns null for a missing key', () => {
    expect(repo.get('rootFolder')).toBeNull()
  })

  it('round-trips a value: set then get returns the same string', () => {
    repo.set('rootFolder', '/Users/x/Music')
    expect(repo.get('rootFolder')).toBe('/Users/x/Music')
  })

  it('upserts on repeated set: get returns the most recent value', () => {
    repo.set('rootFolder', '/first/path')
    repo.set('rootFolder', '/second/path')
    expect(repo.get('rootFolder')).toBe('/second/path')
  })

  it('throws when value is not a string', () => {
    // @ts-expect-error — intentionally exercising the runtime guard
    expect(() => repo.set('rootFolder', 42)).toThrow()
  })
})
