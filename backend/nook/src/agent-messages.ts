import { z } from 'zod'
import { agentMessageCommand } from '../../../src/shared/agent-message.js'
import { connectionSchema, base, userSchema } from './contracts.js'
import { memberConnection } from './connections.js'
import { fresh, type Store } from './store.js'
import { insist } from './errors.js'

export const agentMessageSchema = base.extend({
  senderId: z.string().uuid(), connectionId: z.string().uuid(),
  content: z.string().trim().min(1).max(1000), kind: z.enum(['invitation', 'message']),
  status: z.literal('delivered'), requestId: z.string().uuid().optional()
}).strict()
export const messageInput = z.object({ connectionId: z.string().uuid(), content: z.string().trim().min(1).max(1000), kind: z.enum(['invitation', 'message']).default('message'), requestId: z.string().uuid() }).strict()

export function inbox(store: Store, ownerId: string) {
  return store.list('agent_message', agentMessageSchema, ownerId).slice(-100).reverse().map(message => ({
    ...message, senderName: store.owned('user', message.senderId, message.senderId, userSchema).displayName
  }))
}
export function deliverMessage(store: Store, ownerId: string, input: unknown) {
  const request = messageInput.parse(input)
  const connection = memberConnection(store, request.connectionId, ownerId)
  const recipientId = connection.ownerId === ownerId ? connection.recipientId! : connection.ownerId
  const recipient = store.owned('user', recipientId, recipientId, userSchema)
  return store.transaction(() => {
    const previous = store.list('agent_message', agentMessageSchema).find(message => message.senderId === ownerId && message.requestId === request.requestId)
    if (previous) {
      insist(previous.connectionId === connection.id && previous.content === request.content && previous.kind === request.kind, 409, 'request_conflict', 'This message request was already used for different content.')
      return { ...previous, recipientName: recipient.displayName }
    }
    const saved = store.insert('agent_message', {
      ...fresh(recipient.id), senderId: ownerId, connectionId: connection.id,
      content: request.content, kind: request.kind, status: 'delivered', requestId: request.requestId
    }, agentMessageSchema)
    store.audit(ownerId, 'agent.message_sent', saved.id)
    store.audit(recipient.id, 'agent.message_received', saved.id)
    return { ...saved, recipientName: recipient.displayName }
  })
}

export function sendAgentMessage(store: Store, ownerId: string, question: string, requestId?: string) {
  const command = agentMessageCommand(question)
  if (!command) return null
  const candidates = store.list('connection', connectionSchema)
    .filter(connection => connection.phase === 'active' && (connection.ownerId === ownerId || connection.recipientId === ownerId))
    .map(connection => {
      const recipientId = connection.ownerId === ownerId ? connection.recipientId! : connection.ownerId
      return { connection, recipient: store.owned('user', recipientId, recipientId, userSchema) }
    })
    .filter(({ recipient }) => {
      const target = command.target.toLocaleLowerCase()
      const name = recipient.displayName.toLocaleLowerCase()
      return target === name || target.startsWith(`${name} `) || target.startsWith(`${name}:`) || target.startsWith(`${name},`)
    })
  insist(candidates.length > 0, 409, 'agent_not_connected', 'Connect with that person’s Twin first. No message was sent.')
  const longest = Math.max(...candidates.map(item => item.recipient.displayName.length))
  const matches = candidates.filter(item => item.recipient.displayName.length === longest)
  insist(new Set(matches.map(item => item.recipient.id)).size === 1, 409, 'recipient_ambiguous', 'More than one connected Twin has that name. Choose them from your Circle. No message was sent.')
  const { connection, recipient } = matches[0]
  const remainder = command.target.slice(recipient.displayName.length).trim()
  insist(!(/^(?:and|or)\s/i.test(remainder) || (command.verb === 'invite' && remainder.startsWith(','))), 409, 'multiple_recipients', 'Send to one connected Twin at a time. No message was sent.')
  const message = deliverMessage(store, ownerId, { connectionId: connection.id, content: command.content, kind: command.verb === 'invite' ? 'invitation' : 'message', requestId: requestId || fresh(ownerId).id })
  return { message: `${command.verb === 'invite' ? 'Invitation' : 'Message'} delivered to ${recipient.displayName}’s Twin inbox. They can reply from their Circle.`, mode: 'live' as const, sources: [], researchStatus: 'off' as const, delivery: { id: message.id, recipient: recipient.displayName, status: message.status } }
}
