import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Store } from './store.js'
import { register, createMemory, reviewMemory, profile } from './memory.js'
import { createInterview } from './interview.js'
import { interviewSchema, memorySchema } from './contracts.js'
import { recoverInterruptedJobs } from './recovery.js'
import { Jobs } from './jobs.js'

test('restart preserves authenticated users and confirmed memory, marks interrupted work failed', () => {
  const directory = mkdtempSync(join(tmpdir(), 'nook-persistence-'))
  const database = join(directory, 'nook.db')
  try {
    let store = new Store(database)
    const user = register(store, { displayName: 'Restart test' })
    const memory = createMemory(store, user.user.id, {
      dimension: 'values',
      kind: 'explicit',
      field: 'learning',
      statement: 'I value learning.',
      value: true
    })
    reviewMemory(store, user.user.id, memory.id, { expectedRevision: 0, status: 'confirmed' })
    const interview = createInterview(store, user.user.id)
    store.update('interview', { ...interview, phase: 'running' }, interviewSchema)
    store.close()
    store = new Store(database)
    recoverInterruptedJobs(store)
    assert.equal(store.authenticate(user.token), user.user.id)
    assert.equal(profile(store, user.user.id).confirmed[0].id, memory.id)
    assert.equal(
      store.owned('interview', interview.id, user.user.id, interviewSchema).phase,
      'failed'
    )
    store.close()
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
test('expired context is excluded and temporary memory requires a future expiry', () => {
  const store = new Store(':memory:')
  const user = register(store, { displayName: 'Expiry test' })
  assert.throws(
    () =>
      createMemory(store, user.user.id, {
        dimension: 'constraints',
        kind: 'temporary',
        field: 'time',
        statement: 'Busy today.',
        value: true
      }),
    /Temporary/
  )
  assert.throws(
    () =>
      createMemory(store, user.user.id, {
        dimension: 'constraints',
        kind: 'temporary',
        field: 'time',
        statement: 'Busy today.',
        value: true,
        expiresAt: new Date(0).toISOString()
      }),
    /future/
  )
  const memory = createMemory(store, user.user.id, {
    dimension: 'constraints',
    kind: 'temporary',
    field: 'time',
    statement: 'Busy today.',
    value: true,
    expiresAt: new Date(Date.now() + 60000).toISOString()
  })
  reviewMemory(store, user.user.id, memory.id, { expectedRevision: 0, status: 'confirmed' })
  const current = profile(store, user.user.id).confirmed[0]
  store.update('memory', { ...current, expiresAt: new Date(0).toISOString() }, memorySchema)
  assert.equal(profile(store, user.user.id).confirmed.length, 0)
  store.close()
})
test('job queue enforces per-user concurrency, aborts peers after failure, and releases capacity', async () => {
  const jobs = new Jobs()
  let release: () => void = () => {}
  let failed = 0
  let taskSignal: AbortSignal | undefined
  jobs.launch(
    'a',
    () =>
      new Promise<void>((resolve) => {
        release = resolve
      }),
    () => {
      failed++
    }
  )
  assert.throws(() => jobs.requireAvailable('a'), /already running/)
  await Promise.resolve()
  release()
  await jobs.settle()
  jobs.requireAvailable('a')
  jobs.launch(
    'a',
    async (signal) => {
      taskSignal = signal
      throw new Error('offline')
    },
    () => {
      failed++
    }
  )
  await jobs.settle()
  assert.equal(failed, 1)
  assert.equal(taskSignal?.aborted, true)
  jobs.requireAvailable('a')
})
