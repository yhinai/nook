import { z } from 'zod'
import {
  decisionSchema,
  interviewSchema,
  memorySchema,
  negotiationSchema
} from '../src/contracts.js'
import { browserSchema } from '../src/browser.js'

const userResult = z.object({ user: z.object({ id: z.string() }), token: z.string() })
const connectionResult = z.object({
  id: z.string(),
  revision: z.number(),
  invitationToken: z.string().optional()
})
export async function runDemo(baseUrl: string, registrationKey?: string, includeBrowser = true) {
  async function api(
    path: string,
    token?: string,
    body?: unknown,
    method = body === undefined ? 'GET' : 'POST'
  ): Promise<unknown> {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(registrationKey ? { 'X-Nook-Registration-Key': registrationKey } : {})
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(path === "/v1/chat" ? 150000 : 20000)
    })
    if (!response.ok) {
      throw new Error(`Demo request ${method} ${path} returned HTTP ${response.status}.`)
    }
    return response.json()
  }
  async function poll<T>(path: string, token: string, schema: z.ZodType<T & { phase: string }>) {
    const deadline = Date.now() + 125000
    while (Date.now() < deadline) {
      const value = schema.parse(await api(path, token))
      if (value.phase === 'failed') {
        throw new Error(`Demo task ${path} failed.`)
      }
      if (value.phase !== 'running') {
        return value
      }
      await new Promise((resolve) => setTimeout(resolve, 400))
    }
    throw new Error('Demo task timed out.')
  }
  const suffix = Date.now().toString(36)
  const a = userResult.parse(
    await api('/v1/users', undefined, { displayName: `Demo Alex ${suffix}` })
  )
  const b = userResult.parse(
    await api('/v1/users', undefined, { displayName: `Demo Blair ${suffix}` })
  )
  let interview = interviewSchema.parse(await api('/v1/interviews', a.token, {}))
  interview = interviewSchema.parse(
    await api(`/v1/interviews/${interview.id}/answers`, a.token, {
      questionId: 'values',
      answer:
        'I value time with friends and prefer affordable outdoor activities. I want sustainable work and learning routines.',
      expectedRevision: interview.revision
    })
  )
  await api(`/v1/interviews/${interview.id}/extract`, a.token, {})
  interview = await poll(`/v1/interviews/${interview.id}`, a.token, interviewSchema)
  const extracted = z
    .array(memorySchema)
    .parse(await api('/v1/memories', a.token))
    .filter((value) => interview.memoryIds.includes(value.id))
  if (!extracted.length || extracted.some((value) => value.status !== 'pending')) {
    throw new Error('Interview memories must await confirmation.')
  }
  for (const memory of extracted) {
    await api(`/v1/memories/${memory.id}/review`, a.token, {
      expectedRevision: memory.revision,
      status: 'confirmed'
    })
  }
  console.log(
    JSON.stringify({
      stage: 'interview',
      pendingConfirmationVerified: true,
      confirmedMemories: extracted.length
    })
  )
  const decision = decisionSchema.parse(
    await api('/v1/decisions', a.token, {
      objective:
        'Spend my free afternoon connecting with a friend while preserving energy for tomorrow.',
      category: 'social',
      options: [
        { id: 'park', title: 'Park walk', detail: 'An inexpensive one-hour walk with a friend.' },
        {
          id: 'paper',
          title: 'Paper reading',
          detail: 'Two hours studying a research paper alone.'
        }
      ],
      research: true
    })
  )
  const council = await poll(`/v1/decisions/${decision.id}`, a.token, decisionSchema)
  if (
    council.phase !== 'ready' ||
    council.opinions.length !== 4 ||
    !council.recommendation?.memoryIds.length ||
    council.researchStatus !== 'retrieved'
  ) {
    throw new Error('Council, confirmed evidence or Exa research failed verification.')
  }
  console.log(
    JSON.stringify({
      stage: 'council',
      opinions: council.opinions.length,
      sourceCount: council.sources.length,
      recommendation: council.recommendation.optionId
    })
  )
  const invitation = connectionResult.parse(await api('/v1/connections/invitations', a.token, {}))
  await api('/v1/connections/accept', b.token, { invitationToken: invitation.invitationToken })
  const profile = { name: `Demo Alex ${suffix}`, priority: 'Connection', values: ['Friends'], weekend: true }
  const sent = z.object({ delivery: z.object({ id: z.string(), status: z.literal('delivered') }) }).parse(
    await api('/v1/chat', a.token, { question: `Invite Demo Blair ${suffix} to a park walk tomorrow`, profile })
  )
  const inbox = z.array(z.object({ id: z.string() })).parse(await api('/v1/agent/messages', b.token))
  if (!inbox.some(item => item.id === sent.delivery.id)) throw new Error('Agent invitation did not reach the connected recipient.')
  const conversation = z.object({ message: z.string().min(1), researchStatus: z.literal('retrieved'), sources: z.array(z.object({ url: z.string().url() })).min(1) }).parse(
    await api('/v1/chat', a.token, { question: 'Find public information about Golden Gate Park walking trails in San Francisco. Cite your sources and avoid guessing current hours.', profile, timezone: 'America/Los_Angeles' })
  )
  console.log(JSON.stringify({ stage: 'chat', sourcedReply: Boolean(conversation.message), sourceCount: conversation.sources.length, agentInvitationDelivered: true }))
  let connection = connectionResult.parse(await api(`/v1/connections/${invitation.id}`, a.token))
  let memory = memorySchema.parse(await api(`/v1/memories/${extracted[0].id}`, a.token))
  memory = memorySchema.parse(
    await api(
      `/v1/memories/${memory.id}/visibility`,
      a.token,
      { expectedRevision: memory.revision, visibility: 'friends' },
      'PATCH'
    )
  )
  await api(
    `/v1/connections/${connection.id}/grants`,
    a.token,
    { expectedRevision: connection.revision, memoryIds: [memory.id] },
    'PUT'
  )
  const start = new Date(Date.now() + 86400000).toISOString()
  const end = new Date(Date.now() + 90000000).toISOString()
  const brief = {
    maxCost: 20,
    available: [{ start, end }],
    requiredTags: ['outdoors'],
    preferences: 'A calm activity with time to talk.',
    minScore: 4
  }
  let negotiation = negotiationSchema.parse(
    await api('/v1/negotiations', a.token, {
      connectionId: connection.id,
      objective: 'Choose an affordable outdoor activity together.',
      brief,
      candidates: [
        {
          id: 'walk',
          title: 'Park walk',
          detail: 'A calm park walk with time to talk.',
          start,
          end,
          costPerPerson: 0,
          tags: ['outdoors']
        },
        {
          id: 'picnic',
          title: 'Park picnic',
          detail: 'A simple picnic with time to talk.',
          start,
          end,
          costPerPerson: 12,
          tags: ['outdoors']
        }
      ]
    })
  )
  negotiation = negotiationSchema.parse(
    await api(`/v1/negotiations/${negotiation.id}/brief`, b.token, {
      expectedRevision: negotiation.revision,
      brief: { ...brief, preferences: 'Prefer a free activity.' }
    })
  )
  await api(`/v1/negotiations/${negotiation.id}/start`, a.token, {})
  negotiation = await poll(`/v1/negotiations/${negotiation.id}`, a.token, negotiationSchema)
  if (
    negotiation.phase !== 'awaiting_approval' ||
    negotiation.rounds.length !== 4 ||
    !negotiation.planHash
  ) {
    throw new Error('Two-round negotiation did not produce a proposal.')
  }
  negotiation = negotiationSchema.parse(
    await api(`/v1/negotiations/${negotiation.id}/approval`, a.token, {
      planHash: negotiation.planHash,
      decision: 'approved'
    })
  )
  if (negotiation.phase !== 'awaiting_approval') {
    throw new Error('One human approval must not approve the plan.')
  }
  negotiation = negotiationSchema.parse(
    await api(`/v1/negotiations/${negotiation.id}/approval`, b.token, {
      planHash: negotiation.planHash,
      decision: 'approved'
    })
  )
  if (negotiation.phase !== 'approved') {
    throw new Error('Both exact-plan approvals did not complete.')
  }
  console.log(
    JSON.stringify({
      stage: 'negotiation',
      rounds: negotiation.rounds.length,
      humanApprovals: Object.keys(negotiation.approvals).length,
      externalActions: 0
    })
  )
  if (includeBrowser) {
    const task = browserSchema.parse(
      await api('/v1/browser/tasks', a.token, {
        url: 'https://en.wikipedia.org/wiki/Personal_development',
        purpose: 'Identify general learning and personal-development ideas described on this page.'
      })
    )
    const result = await poll(`/v1/browser/tasks/${task.id}`, a.token, browserSchema)
    if (result.phase !== 'ready' || !result.page?.text || !result.summary) {
      throw new Error('Kernel page reading or summary failed.')
    }
    console.log(
      JSON.stringify({
        stage: 'kernel',
        retrievedCharacters: result.page.text.length,
        findings: result.summary.findings.length
      })
    )
  }
  return { status: 'passed', decisionId: council.id, negotiationId: negotiation.id }
}
