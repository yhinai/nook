import { DatabaseSync } from 'node:sqlite'
import { mkdirSync, chmodSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { Entity } from './contracts.js'
import { ApiError, insist } from './errors.js'

const rowSchema = z.object({ data: z.string() })
export const digest = (value: string) => createHash('sha256').update(value).digest('hex')
export const secret = () => randomBytes(32).toString('base64url')
export function fresh(ownerId: string): Entity {
  const at = new Date().toISOString()
  return { id: randomUUID(), ownerId, revision: 0, createdAt: at, updatedAt: at }
}
export class Store {
  private db: DatabaseSync
  constructor(path: string) {
    if (path !== ':memory:') {
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
    }
    this.db = new DatabaseSync(path, { timeout: 5000 })
    this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS records(kind TEXT NOT NULL,id TEXT NOT NULL,owner_id TEXT NOT NULL,revision INTEGER NOT NULL,data TEXT NOT NULL,PRIMARY KEY(kind,id));
      CREATE INDEX IF NOT EXISTS owner_records ON records(kind,owner_id);
      CREATE TABLE IF NOT EXISTS tokens(hash TEXT PRIMARY KEY,owner_id TEXT NOT NULL,created_at TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT,owner_id TEXT NOT NULL,action TEXT NOT NULL,entity_id TEXT NOT NULL,at TEXT NOT NULL);`)
    if (path !== ':memory:' && process.platform !== 'win32') {
      for (const file of [path, `${path}-wal`, `${path}-shm`]) {
        if (existsSync(file)) {
          chmodSync(file, 0o600)
        }
      }
    }
  }
  read<T>(kind: string, id: string, schema: z.ZodType<T>): T | null {
    const row = this.db.prepare('SELECT data FROM records WHERE kind=? AND id=?').get(kind, id)
    return row ? schema.parse(JSON.parse(rowSchema.parse(row).data)) : null
  }
  list<T>(kind: string, schema: z.ZodType<T>, ownerId?: string): T[] {
    const rows = ownerId
      ? this.db
          .prepare('SELECT data FROM records WHERE kind=? AND owner_id=? ORDER BY rowid')
          .all(kind, ownerId)
      : this.db.prepare('SELECT data FROM records WHERE kind=? ORDER BY rowid').all(kind)
    return rows.map((row) => schema.parse(JSON.parse(rowSchema.parse(row).data)))
  }
  owned<T extends Entity>(kind: string, id: string, ownerId: string, schema: z.ZodType<T>): T {
    const value = this.read(kind, id, schema)
    insist(value?.ownerId === ownerId, 404, 'not_found', 'Resource not found.')
    return value
  }
  insert<T extends Entity>(kind: string, value: unknown, schema: z.ZodType<T>): T {
    const checked = schema.parse(value)
    this.db
      .prepare('INSERT INTO records(kind,id,owner_id,revision,data) VALUES(?,?,?,?,?)')
      .run(kind, checked.id, checked.ownerId, checked.revision, JSON.stringify(checked))
    return checked
  }
  update<T extends Entity>(kind: string, input: unknown, schema: z.ZodType<T>): T {
    const value = schema.parse(input)
    const checked = schema.parse({
      ...value,
      revision: value.revision + 1,
      updatedAt: new Date().toISOString()
    })
    const result = this.db
      .prepare(
        'UPDATE records SET revision=?,data=? WHERE kind=? AND id=? AND owner_id=? AND revision=?'
      )
      .run(checked.revision, JSON.stringify(checked), kind, value.id, value.ownerId, value.revision)
    insist(
      result.changes === 1,
      409,
      'revision_conflict',
      'Resource changed. Read it again before updating.'
    )
    return checked
  }
  transaction<T>(operation: () => T): T {
    this.db.exec('BEGIN IMMEDIATE')
    try {
      const value = operation()
      this.db.exec('COMMIT')
      return value
    } catch (error) {
      this.db.exec('ROLLBACK')
      throw error
    }
  }
  issueToken(ownerId: string): string {
    const token = `nook_${secret()}`
    this.db
      .prepare('INSERT INTO tokens VALUES(?,?,?)')
      .run(digest(token), ownerId, new Date().toISOString())
    return token
  }
  authenticate(token: string): string {
    insist(
      /^nook_[A-Za-z0-9_-]{43}$/.test(token),
      401,
      'unauthorized',
      'A valid bearer token is required.'
    )
    const row = this.db.prepare('SELECT owner_id FROM tokens WHERE hash=?').get(digest(token))
    if (!row) {
      throw new ApiError(401, 'unauthorized', 'A valid bearer token is required.')
    }
    return z.object({ owner_id: z.string() }).parse(row).owner_id
  }
  audit(ownerId: string, action: string, entityId: string): void {
    this.db
      .prepare('INSERT INTO audit(owner_id,action,entity_id,at) VALUES(?,?,?,?)')
      .run(ownerId, action, entityId, new Date().toISOString())
  }
  auditLog(ownerId: string) {
    return this.db
      .prepare(
        'SELECT id,action,entity_id,at FROM audit WHERE owner_id=? ORDER BY id DESC LIMIT 200'
      )
      .all(ownerId)
  }
  close() {
    this.db.close()
  }
}
