import { z } from 'zod'
import { agentMessageCommand } from '../../../src/shared/agent-message.js'
import { connectionSchema, base, userSchema } from './contracts.js'
import { fresh, type Store } from './store.js'
import { insist } from './errors.js'

export const agentMessageSchema = base.extend({
  senderId: z.string().uuid(), connectionId: z.string().uuid(),
  content: z.string().trim().min(1).max(1000), kind: z.enum(['invitation', 'message']),
  status: z.literal('delivered')
}).strict()

export function sendAgentMessage(store: Store, ownerId: string, question: string) {
  const command = agentMessageCommand(question)
  if (!command) return null
  const candidates = store.list('connection', connectionSchema)
    .filter(connection => connection.phase === 'active' && (connection.ownerId === ownerId || connection.recipientId === ownerId))
    .map(connection => {
      const recipientId = connection.ownerId === ownerId ? connection.recipientId! : connection.ownerId
      return { connection, recipient: store.owned('user', recipientId, recipientId, userSchema) }
    })
    .filter(({ recipient }) => {
      const target = command.target.toLowerCase()
      const name = recipient.displayName.toLowerCase()
      return target === name || target.startsWith(`${name} `) || target.startsWith(`${name}:`) || target.startsWith(`${name},`)
    })
  insist(candidates.length > 0, 409, 'agent_not_connected', 'Connect with that person’s Twin first. No message was sent.')
  const longest = Math.max(...candidates.map(item => item.recipient.displayName.length))
  const matches = candidates.filter(item => item.recipient.displayName.length === longest)
  const recipientIds = new Set(matches.map(item => item.recipient.id))
  insist(recipientIds.size === 1, 409, 'recipient_ambiguous', 'More than one connected Twin has that name. Use their full name. No message was sent.')
  const { connection, recipient } = matches[0]
  const remainder = command.target.slice(recipient.displayName.length).trim()
  insist(!/^(?:and\s|,)/i.test(remainder), 409, 'recipient_ambiguous', 'Send to one connected Twin at a time. No message was sent.')
  const message = store.transaction(() => {
    const saved = store.insert('agent_message', {
      ...fresh(recipient.id), senderId: ownerId, connectionId: connection.id,
      content: command.content, kind: command.verb === 'invite' ? 'invitation' : 'message', status: 'delivered'
    }, agentMessageSchema)
    store.audit(ownerId, 'agent.message_sent', saved.id)
    store.audit(recipient.id, 'agent.message_received', saved.id)
    return saved
  })
  return { message: `${command.verb === 'invite' ? 'Invitation' : 'Message'} sent to ${recipient.displayName}’s Twin. Waiting for their reply.`, mode: 'live' as const, sources: [], researchStatus: 'off' as const, delivery: { id: message.id, recipient: recipient.displayName, status: message.status } }
}
