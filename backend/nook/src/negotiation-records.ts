import { z } from 'zod'
import {
  briefSchema,
  negotiationInput,
  negotiationSchema,
  type Candidate,
  type Brief,
  type Connection,
  type Negotiation
} from './contracts.js'
import type { Store } from './store.js'
import { digest, fresh } from './store.js'
import { memberConnection, disclosedMemories } from './connections.js'
import { insist } from './errors.js'
import { appendEvent } from './decisions.js'

export function disclosureFingerprint(store: Store, connection: Connection): string {
  insist(
    connection.recipientId,
    409,
    'connection_inactive',
    'The other Twin has not accepted the connection.'
  )
  return digest(
    JSON.stringify({
      revision: connection.revision,
      phase: connection.phase,
      first: disclosedMemories(store, connection, connection.ownerId),
      second: disclosedMemories(store, connection, connection.recipientId)
    })
  )
}
export function candidateFits(candidate: Candidate, brief: Brief): boolean {
  const tags = new Set(candidate.tags.map((tag) => tag.toLowerCase()))
  return (
    Math.ceil(candidate.costPerPerson * 100) <= Math.floor(brief.maxCost * 100) &&
    brief.requiredTags.every((tag) => tags.has(tag.toLowerCase())) &&
    brief.forbiddenTags.every((tag) => !tags.has(tag.toLowerCase())) &&
    brief.available.some(
      (slot) =>
        Date.parse(candidate.start) >= Date.parse(slot.start) &&
        Date.parse(candidate.end) <= Date.parse(slot.end)
    )
  )
}
export function readNegotiation(store: Store, ownerId: string, negotiationId: string): Negotiation {
  const negotiation = store.read('negotiation', negotiationId, negotiationSchema)
  insist(
    negotiation && negotiation.participants.includes(ownerId),
    404,
    'not_found',
    'Negotiation not found.'
  )
  const connection = memberConnection(store, negotiation.connectionId, ownerId, false)
  insist(
    connection.phase === 'active',
    403,
    'connection_revoked',
    'The connection is not active; shared content is unavailable.'
  )
  if (
    negotiation.disclosureFingerprint &&
    disclosureFingerprint(store, connection) !== negotiation.disclosureFingerprint &&
    negotiation.phase !== 'stale'
  ) {
    return store.update(
      'negotiation',
      appendEvent(
        {
          ...negotiation,
          phase: 'stale',
          rounds: [],
          plan: null,
          planHash: null,
          approvals: {},
          error: 'Disclosure changed or a shared memory expired. Start a new negotiation.'
        },
        'negotiation.stale',
        'Removed old shared content and approvals after a disclosure change.'
      ),
      negotiationSchema
    )
  }
  return negotiation
}
export function createNegotiation(store: Store, ownerId: string, input: unknown) {
  const request = negotiationInput.parse(input)
  const connection = memberConnection(store, request.connectionId, ownerId)
  insist(
    connection.recipientId,
    409,
    'connection_inactive',
    'Both people must accept the connection.'
  )
  insist(
    new Set(request.candidates.map((candidate) => candidate.id)).size === request.candidates.length,
    400,
    'duplicate_candidates',
    'Candidate IDs must be unique.'
  )
  const created = store.insert(
    'negotiation',
    appendEvent(
      {
        ...fresh(ownerId),
        connectionId: connection.id,
        participants: [connection.ownerId, connection.recipientId],
        objective: request.objective,
        candidates: request.candidates,
        briefs: { [ownerId]: request.brief },
        phase: 'awaiting_briefs',
        disclosureFingerprint: null,
        rounds: [],
        plan: null,
        planHash: null,
        approvals: {},
        events: []
      },
      'negotiation.created',
      'The first participant supplied a planning brief. Awaiting the other participant.'
    ),
    negotiationSchema
  )
  store.audit(ownerId, 'negotiation.created', created.id)
  return created
}
export function submitBrief(store: Store, ownerId: string, negotiationId: string, input: unknown) {
  const request = z
    .object({ expectedRevision: z.number().int().nonnegative(), brief: briefSchema })
    .strict()
    .parse(input)
  const negotiation = readNegotiation(store, ownerId, negotiationId)
  insist(
    negotiation.phase === 'awaiting_briefs',
    409,
    'negotiation_closed',
    'Briefs cannot change after negotiation starts.'
  )
  insist(
    request.expectedRevision === negotiation.revision,
    409,
    'revision_conflict',
    'Read the latest negotiation before submitting your brief.'
  )
  const saved = store.update(
    'negotiation',
    appendEvent(
      { ...negotiation, briefs: { ...negotiation.briefs, [ownerId]: request.brief } },
      'brief.submitted',
      'A participant explicitly supplied their planning constraints.'
    ),
    negotiationSchema
  )
  store.audit(ownerId, 'negotiation.brief_submitted', saved.id)
  return saved
}
export function approvePlan(store: Store, ownerId: string, negotiationId: string, input: unknown) {
  const request = z
    .object({
      planHash: z.string().regex(/^[a-f0-9]{64}$/),
      decision: z.enum(['approved', 'rejected'])
    })
    .strict()
    .parse(input)
  return store.transaction(() => {
    const negotiation = readNegotiation(store, ownerId, negotiationId)
    insist(
      negotiation.phase === 'awaiting_approval' || negotiation.phase === 'approved',
      409,
      'plan_unavailable',
      'No current proposed plan is available for approval.'
    )
    insist(
      negotiation.plan && negotiation.planHash === request.planHash,
      409,
      'plan_changed',
      'Approve the exact proposed plan; its hash changed.'
    )
    const plan = negotiation.plan
    insist(
      negotiation.participants.every((userId) => candidateFits(plan, negotiation.briefs[userId])) &&
        Date.parse(plan.start) > Date.now(),
      409,
      'constraints_changed',
      'The plan no longer satisfies the supplied constraints.'
    )
    const approvals = { ...negotiation.approvals, [ownerId]: request.decision }
    const phase =
      request.decision === 'rejected'
        ? 'rejected'
        : negotiation.participants.every((userId) => approvals[userId] === 'approved')
          ? 'approved'
          : 'awaiting_approval'
    const saved = store.update(
      'negotiation',
      appendEvent(
        { ...negotiation, approvals, phase },
        'human.approval',
        `A participant ${request.decision} this exact plan. Approval does not perform external actions.`
      ),
      negotiationSchema
    )
    store.audit(ownerId, `plan.${request.decision}`, negotiationId)
    return saved
  })
}
