import test from 'node:test'
import assert from 'node:assert/strict'
import { Store } from './store.js'
import { register, registerSession } from './memory.js'
import { accept, invite, revoke } from './connections.js'
import { agentMessageSchema, sendAgentMessage } from './agent-messages.js'
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
    assert.match(result.message, /Invitation sent to Maya/)
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
