import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.js'
import { register, createMemory } from './memory.js'
import { requestTwin, respondToTwin, twinDirectory } from './connections.js'
import { connectionSchema } from './contracts.js'

test('registered Twins are discovered by ID, with no private profile content and recipient-only consent', () => {
  const store = new Store(':memory:')
  try {
    const a = register(store, { displayName: 'Alex' }).user.id
    const b = register(store, { displayName: 'Maya' }).user.id
    const c = register(store, { displayName: 'Maya' }).user.id
    createMemory(store, b, { dimension: 'values', kind: 'explicit', field: 'secret', statement: 'Private secret', value: 'secret', visibility: 'private' })
    assert.deepEqual(twinDirectory(store, a), [{ id: b, displayName: 'Maya', status: 'available' }, { id: c, displayName: 'Maya', status: 'available' }])
    assert.throws(() => requestTwin(store, a, { recipientId: a }))
    const pending = requestTwin(store, a, { recipientId: b })
    assert.equal(requestTwin(store, b, { recipientId: a }).id, pending.id)
    assert.equal(twinDirectory(store, a)[0].status, 'outgoing')
    assert.equal(twinDirectory(store, b)[0].status, 'incoming')
    assert.throws(() => respondToTwin(store, a, { connectionId: pending.id, decision: 'accept' }))
    assert.throws(() => respondToTwin(store, c, { connectionId: pending.id, decision: 'accept' }))
    assert.equal(respondToTwin(store, b, { connectionId: pending.id, decision: 'decline' }).phase, 'revoked')
    assert.equal(twinDirectory(store, a)[0].status, 'available')
    const retry = requestTwin(store, a, { recipientId: b })
    assert.notEqual(retry.id, pending.id)
    assert.equal(respondToTwin(store, b, { connectionId: retry.id, decision: 'accept' }).phase, 'active')
    assert.equal(requestTwin(store, a, { recipientId: b }).id, retry.id)
    assert.equal(twinDirectory(store, a)[0].status, 'connected')
    assert.equal(twinDirectory(store, a)[1].status, 'available')
    assert.throws(() => respondToTwin(store, b, { connectionId: retry.id, decision: 'accept' }))
  } finally { store.close() }
})
test('expired requests cannot be accepted and a new request can be created', () => {
  const store = new Store(':memory:')
  try {
    const a = register(store, { displayName: 'Alex' }).user.id
    const b = register(store, { displayName: 'Maya' }).user.id
    const pending = requestTwin(store, a, { recipientId: b })
    const record = store.owned('connection', pending.id, a, connectionSchema)
    store.update('connection', { ...record, expiresAt: '2020-01-01T00:00:00.000Z' }, connectionSchema)
    assert.equal(twinDirectory(store, a)[0].status, 'available')
    assert.throws(() => respondToTwin(store, b, { connectionId: pending.id, decision: 'accept' }))
    assert.notEqual(requestTwin(store, a, { recipientId: b }).id, pending.id)
  } finally { store.close() }
})
