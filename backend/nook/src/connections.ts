import { z } from 'zod'
import { connectionSchema, memorySchema, userSchema, type Connection } from './contracts.js'
import type { Store } from './store.js'
import { digest, fresh, secret } from './store.js'
import { isCurrent } from './memory.js'
import { insist } from './errors.js'

export function memberConnection(
  store: Store,
  connectionId: string,
  ownerId: string,
  active = true
): Connection {
  const connection = store.read('connection', connectionId, connectionSchema)
  insist(
    connection && (connection.ownerId === ownerId || connection.recipientId === ownerId),
    404,
    'not_found',
    'Connection not found.'
  )
  if (active) {
    insist(
      connection.phase === 'active',
      409,
      'connection_inactive',
      'Both people must accept the connection before their Twins interact.'
    )
  }
  return connection
}
export function connectionView(store: Store, connection: Connection, ownerId: string) {
  const participants = [connection.ownerId, connection.recipientId]
    .filter((participant): participant is string => Boolean(participant))
    .map((id) => ({ id, displayName: store.owned('user', id, id, userSchema).displayName, isMe: id === ownerId }))
  return {
    id: connection.id,
    revision: connection.revision,
    phase: connection.phase,
    participants,
    expiresAt: connection.expiresAt,
    mySharedMemoryIds: connection.grants[ownerId] || []
  }
}
export function invite(store: Store, ownerId: string) {
  const token = secret()
  const connection = store.insert(
    'connection',
    {
      ...fresh(ownerId),
      recipientId: null,
      phase: 'invited',
      tokenHash: digest(token),
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      grants: {}
    },
    connectionSchema
  )
  store.audit(ownerId, 'connection.invited', connection.id)
  return {
    ...connectionView(store, connection, ownerId),
    invitationToken: token,
    disclosure: 'Invitation is prepared only; nothing has been sent.'
  }
}
export function accept(store: Store, ownerId: string, input: unknown) {
  const { invitationToken } = z
    .object({ invitationToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })
    .strict()
    .parse(input)
  const connection = store
    .list('connection', connectionSchema)
    .find((item) => item.tokenHash === digest(invitationToken))
  insist(
    connection?.phase === 'invited' && Date.parse(connection.expiresAt) > Date.now(),
    404,
    'invitation_invalid',
    'Invitation is invalid, expired or already used.'
  )
  insist(
    connection.ownerId !== ownerId,
    400,
    'self_connection',
    'A Twin cannot accept its own invitation.'
  )
  const saved = store.update(
    'connection',
    { ...connection, phase: 'active', recipientId: ownerId, tokenHash: '' },
    connectionSchema
  )
  store.audit(ownerId, 'connection.accepted', saved.id)
  store.audit(saved.ownerId, 'connection.accepted', saved.id)
  return connectionView(store, saved, ownerId)
}
export function grant(store: Store, ownerId: string, connectionId: string, input: unknown) {
  const request = z
    .object({
      expectedRevision: z.number().int().nonnegative(),
      memoryIds: z.array(z.string().uuid()).max(12)
    })
    .strict()
    .parse(input)
  const connection = memberConnection(store, connectionId, ownerId)
  insist(
    connection.revision === request.expectedRevision,
    409,
    'revision_conflict',
    'Connection changed. Read it before changing disclosure.'
  )
  insist(
    new Set(request.memoryIds).size === request.memoryIds.length,
    400,
    'duplicate_memories',
    'Choose each shared memory once.'
  )
  for (const memoryId of request.memoryIds) {
    const memory = store.owned('memory', memoryId, ownerId, memorySchema)
    insist(
      isCurrent(memory) && (memory.visibility === 'public' || memory.visibility === 'friends'),
      403,
      'protected_memory',
      'Only current, confirmed public or friends memories can be shared. Private and never-share memories remain protected.'
    )
  }
  const saved = store.update(
    'connection',
    { ...connection, grants: { ...connection.grants, [ownerId]: request.memoryIds } },
    connectionSchema
  )
  store.audit(ownerId, 'connection.disclosure_changed', connectionId)
  return connectionView(store, saved, ownerId)
}
export function revoke(store: Store, ownerId: string, connectionId: string) {
  const connection = memberConnection(store, connectionId, ownerId, false)
  const saved =
    connection.phase === 'revoked'
      ? connection
      : store.update(
          'connection',
          { ...connection, phase: 'revoked', grants: {}, tokenHash: '' },
          connectionSchema
        )
  store.audit(ownerId, 'connection.revoked', connectionId)
  return connectionView(store, saved, ownerId)
}
export function disclosedMemories(store: Store, connection: Connection, ownerId: string) {
  return (connection.grants[ownerId] || [])
    .map((id) => store.read('memory', id, memorySchema))
    .filter(
      (memory) =>
        memory?.ownerId === ownerId &&
        isCurrent(memory) &&
        (memory.visibility === 'public' || memory.visibility === 'friends')
    )
    .map((memory) => {
      insist(memory, 500, 'invalid_memory', 'Disclosure could not be prepared.')
      const { id, revision, field, dimension, statement, value, confidence } = memory
      return { id, revision, field, dimension, statement, value, confidence }
    })
}

export const twinRequestInput = z.object({ recipientId: z.string().uuid() }).strict()
export const twinResponseInput = z.object({ connectionId: z.string().uuid(), decision: z.enum(['accept', 'decline']) }).strict()

// Directory cards expose identity only, never another person's profile or memories.
export function twinDirectory(store: Store, ownerId: string) {
  const connections = store.list('connection', connectionSchema).filter(connection =>
    (connection.ownerId === ownerId || connection.recipientId === ownerId) &&
    (connection.phase === 'active' || (connection.phase === 'invited' && Date.parse(connection.expiresAt) > Date.now()))
  )
  return store.list('user', userSchema).filter(user => user.id !== ownerId).map(user => {
    const matches = connections.filter(connection => connection.ownerId === user.id || connection.recipientId === user.id)
    const connection = matches.find(item => item.phase === 'active') || matches.at(-1)
    return {
      id: user.id, displayName: user.displayName,
      status: !connection ? 'available' : connection.phase === 'active' ? 'connected' : connection.recipientId === ownerId ? 'incoming' : 'outgoing',
      ...(connection ? { connectionId: connection.id } : {})
    }
  })
}

export function requestTwin(store: Store, ownerId: string, input: unknown) {
  const { recipientId } = twinRequestInput.parse(input)
  insist(recipientId !== ownerId, 400, 'self_connection', 'Choose another person’s Twin.')
  store.owned('user', recipientId, recipientId, userSchema)
  return store.transaction(() => {
    const existing = store.list('connection', connectionSchema).find(connection =>
      ((connection.ownerId === ownerId && connection.recipientId === recipientId) ||
       (connection.ownerId === recipientId && connection.recipientId === ownerId)) &&
      (connection.phase === 'active' || (connection.phase === 'invited' && Date.parse(connection.expiresAt) > Date.now()))
    )
    if (existing) return connectionView(store, existing, ownerId)
    const connection = store.insert('connection', {
      ...fresh(ownerId), recipientId, phase: 'invited', tokenHash: '',
      expiresAt: new Date(Date.now() + 86400000).toISOString(), grants: {}
    }, connectionSchema)
    store.audit(ownerId, 'connection.requested', connection.id)
    store.audit(recipientId, 'connection.request_received', connection.id)
    return connectionView(store, connection, ownerId)
  })
}

export function respondToTwin(store: Store, ownerId: string, input: unknown) {
  const { connectionId, decision } = twinResponseInput.parse(input)
  const connection = memberConnection(store, connectionId, ownerId, false)
  insist(connection.recipientId === ownerId, 403, 'request_recipient_only', 'Only the invited person can respond.')
  insist(connection.phase === 'invited' && Date.parse(connection.expiresAt) > Date.now(), 409, 'invitation_invalid', 'This connection request has expired or was already answered.')
  const saved = store.update('connection', {
    ...connection, phase: decision === 'accept' ? 'active' : 'revoked', tokenHash: '', grants: {}
  }, connectionSchema)
  store.audit(ownerId, decision === 'accept' ? 'connection.accepted' : 'connection.declined', saved.id)
  store.audit(saved.ownerId, decision === 'accept' ? 'connection.accepted' : 'connection.declined', saved.id)
  return connectionView(store, saved, ownerId)
}
