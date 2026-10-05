import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.js'
import { register, registerSession } from './memory.js'
import { accept, invite, revoke } from './connections.js'
import { agentMessageSchema, sendAgentMessage, deliverMessage, inbox } from './agent-messages.js'
import { ApiError } from './errors.js'
import { createRoutes } from './routes.js'
import { Jobs } from './jobs.js'

test('explicit invitation reaches only the connected recipient inbox without calling AI', async () => {
  const store = new Store(':memory:')
  try {
    const alex = register(store, { displayName: 'Alex' }).user.id
    const maya = register(store, { displayName: 'Maya' }).user.id
    const outsider = register(store, { displayName: 'Sam' }).user.id
    accept(store, maya, { invitationToken: invite(store, alex).invitationToken })
    const routes = createRoutes({ store, jobs: new Jobs(), reasoner: { enabled: false, generate: async () => { throw new Error('Must not call AI') } }, research: { enabled: false, search: async () => ({ status: 'off', sources: [] }) }, browser: { enabled: false, read: async () => { throw new Error('unused') } }, browserDomains: [] })
    const result = await routes.find(route => route.path === '/chat')!.action({ ownerId: alex, resourceId: '', body: { question: 'invite Maya for dinner Friday', profile: { name: 'Alex', priority: 'Rest', values: ['Friends'], weekend: true } } }) as { message: string }
    assert.match(result.message, /Invitation delivered to Maya/)
    const inbox = store.list('agent_message', agentMessageSchema, maya)
    assert.equal(inbox.length, 1)
    assert.equal(inbox[0].content, 'invite Maya for dinner Friday')
    assert.equal(inbox[0].senderId, alex)
    assert.equal(inbox[0].ownerId, maya)
    assert.equal(store.list('agent_message', agentMessageSchema, outsider).length, 0)
    assert.equal(sendAgentMessage(store, alex, 'Should I invite Maya?'), null)
  } finally { store.close() }
})
test('unknown, ambiguous and revoked recipients never receive a message', () => {
  const store = new Store(':memory:')
  try {
    const alex = register(store, { displayName: 'Alex' }).user.id
    assert.throws(() => sendAgentMessage(store, alex, 'invite Maya'), error => error instanceof ApiError && error.code === 'agent_not_connected')
    const connectionIds: string[] = []
    for (let i = 0; i < 2; i++) {
      const maya = register(store, { displayName: 'Maya' }).user.id
      const connection = accept(store, maya, { invitationToken: invite(store, alex).invitationToken })
      connectionIds.push(connection.id)
    }
    assert.throws(() => sendAgentMessage(store, alex, 'invite Maya'), error => error instanceof ApiError && error.code === 'recipient_ambiguous')
    connectionIds.forEach(id => revoke(store, alex, id))
    assert.throws(() => sendAgentMessage(store, alex, 'message Maya: hi'), error => error instanceof ApiError && error.code === 'agent_not_connected')
    assert.equal(store.list('agent_message', agentMessageSchema).length, 0)
  } finally { store.close() }
})
test('backend session restores the same user and Twin without matching by display name', () => {
  const store = new Store(':memory:')
  try {
    const first = registerSession(store, { displayName: 'Alex', externalId: 'a'.repeat(64) })
    const restored = registerSession(store, { displayName: 'Alex', externalId: 'a'.repeat(64) })
    const other = registerSession(store, { displayName: 'Alex', externalId: 'b'.repeat(64) })
    assert.equal(first.user.id, restored.user.id)
    assert.notEqual(first.user.id, other.user.id)
    assert.equal(store.authenticate(restored.token), first.user.id)
  } finally { store.close() }
})

test('message retry delivers once; recipients can reply and other users cannot access the connection', () => {
  const store = new Store(':memory:')
  try {
    const alex = register(store, { displayName: 'Alex' }).user.id
    const maya = register(store, { displayName: 'Maya' }).user.id
    const outsider = register(store, { displayName: 'Sam' }).user.id
    const connection = accept(store, maya, { invitationToken: invite(store, alex).invitationToken })
    const requestId = '11111111-1111-4111-8111-111111111111'
    const first = sendAgentMessage(store, alex, 'invite Maya for dinner', requestId)!
    assert.equal(sendAgentMessage(store, alex, 'invite Maya for dinner', requestId)!.delivery.id, first.delivery.id)
    assert.equal(inbox(store, maya).length, 1)
    assert.equal(inbox(store, maya)[0].senderName, 'Alex')
    assert.throws(() => sendAgentMessage(store, alex, 'invite Maya for lunch', requestId), error => error instanceof ApiError && error.code === 'request_conflict')
    assert.throws(() => deliverMessage(store, outsider, { connectionId: connection.id, content: 'Hi', requestId }), error => error instanceof ApiError && error.status === 404)
    deliverMessage(store, maya, { connectionId: connection.id, content: 'Friday works!', requestId })
    assert.equal(inbox(store, alex)[0].content, 'Friday works!')
    assert.equal(inbox(store, alex)[0].senderName, 'Maya')
    revoke(store, alex, connection.id)
    assert.throws(() => deliverMessage(store, maya, { connectionId: connection.id, content: 'Saturday?', requestId: '22222222-2222-4222-8222-222222222222' }), error => error instanceof ApiError && error.code === 'connection_inactive')
  } finally { store.close() }
})
test('session profile edits preserve identity and connection participants identify self by ID', () => {
  const store = new Store(':memory:')
  try {
    const first = registerSession(store, { displayName: 'Alex', externalId: 'c'.repeat(64) })
    const edited = registerSession(store, { displayName: 'Maya', externalId: 'c'.repeat(64) })
    assert.equal(edited.user.id, first.user.id)
    assert.equal(edited.user.displayName, 'Maya')
    const other = register(store, { displayName: 'Maya' }).user.id
    const connection = accept(store, other, { invitationToken: invite(store, first.user.id).invitationToken })
    assert.equal(connection.participants.filter(person => person.isMe).length, 1)
    assert.equal(connection.participants.find(person => person.isMe)!.id, other)
  } finally { store.close() }
})
