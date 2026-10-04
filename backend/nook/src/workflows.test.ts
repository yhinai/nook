import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { Store } from './store.js'
import { Jobs } from './jobs.js'
import { register, createMemory, reviewMemory, profile, changeVisibility } from './memory.js'
import {
  invite,
  accept,
  grant,
  revoke,
  disclosedMemories,
  memberConnection
} from './connections.js'
import {
  createNegotiation,
  submitBrief,
  approvePlan,
  readNegotiation,
  candidateFits
} from './negotiation-records.js'
import { startNegotiation } from './negotiations.js'
import { startDecision } from './decisions.js'
import { createInterview, answerInterview, finishInterview } from './interview.js'
import { decisionSchema, interviewSchema, briefSchema, candidateSchema } from './contracts.js'
import { approvedUrl, createKernelBrowser } from './browser.js'
import type { Reasoner, AgentRole } from './ai.js'
import { ApiError } from './errors.js'

function fixture() {
  const store = new Store(':memory:')
  const a = register(store, { displayName: 'Alex' })
  const b = register(store, { displayName: 'Blair' })
  const jobs = new Jobs()
  const seen: string[] = []
  const reasoner: Reasoner = {
    enabled: true,
    async generate<T>(role: AgentRole, context: unknown, schema: z.ZodType<T>) {
      seen.push(JSON.stringify(context))
      const data = z
        .object({
          options: z.array(z.object({ id: z.string() })).optional(),
          candidates: z.array(z.object({ id: z.string() })).optional(),
          memories: z.array(z.object({ id: z.string() })).optional(),
          answers: z.array(z.object({ questionId: z.string(), answer: z.string() })).optional()
        })
        .passthrough()
        .parse(context)
      const ids = data.memories?.slice(0, 1).map((item) => item.id) || []
      let value: unknown
      if (role === 'strategist') {
        value = {
          optionId: data.options?.[0].id,
          reasoning: 'This fits the supplied confirmed priorities.',
          memoryIds: ids,
          conditions: [],
          unknowns: []
        }
      } else if (role === 'twin') {
        value = {
          assessments: data.candidates?.map((item) => ({
            candidateId: item.id,
            score: 8,
            reasoning: 'Fits the disclosed brief.',
            memoryIds: ids
          })),
          unknowns: []
        }
      } else if (role === 'interview') {
        value = {
          memories: [
            {
              dimension: 'values',
              kind: 'explicit',
              field: 'priority',
              statement: data.answers?.[0].answer,
              value: 'friends',
              importance: 4,
              visibility: 'private',
              expiresAt: null,
              questionId: data.answers?.[0].questionId,
              quote: data.answers?.[0].answer,
              confidence: 1
            }
          ]
        }
      } else {
        value = {
          role,
          assessments: data.options?.map((item) => ({
            optionId: item.id,
            stance: 'support',
            score: 8,
            reasoning: 'Fits the confirmed priorities.',
            memoryIds: ids
          })),
          risks: [],
          unknowns: []
        }
      }
      return schema.parse(value)
    }
  }
  return { store, a, b, jobs, reasoner, seen }
}
function confirmed(
  store: Store,
  ownerId: string,
  visibility: 'friends' | 'never_share' = 'friends',
  field = 'friends'
) {
  const memory = createMemory(store, ownerId, {
    dimension: 'values',
    kind: 'explicit',
    field,
    statement:
      visibility === 'never_share' ? 'SECRET_PRIVATE_NEVER_SHARE' : 'I value time with friends.',
    value: 'friends',
    visibility
  })
  return reviewMemory(store, ownerId, memory.id, {
    expectedRevision: memory.revision,
    status: 'confirmed'
  })
}
function connected(store: Store, a: string, b: string) {
  const invitation = invite(store, a)
  accept(store, b, { invitationToken: invitation.invitationToken })
  return memberConnection(store, invitation.id, a)
}
const start = new Date(Date.now() + 86400000).toISOString()
const end = new Date(Date.now() + 90000000).toISOString()
const brief = briefSchema.parse({ maxCost: 30, available: [{ start, end }] })
const candidate = candidateSchema.parse({
  id: 'walk',
  title: 'Walk',
  detail: 'A public park walk.',
  start,
  end,
  costPerPerson: 0,
  tags: ['outdoors']
})

test('bearer tokens are opaque, wrong owner cannot access, pending and rejected memories never become current', () => {
  const { store, a, b } = fixture()
  assert.equal(store.authenticate(a.token), a.user.id)
  assert.throws(() => store.authenticate('wrong'), ApiError)
  const memory = createMemory(store, a.user.id, {
    dimension: 'values',
    kind: 'inferred',
    field: 'test',
    statement: 'Perhaps prefers learning.',
    value: true
  })
  assert.equal(profile(store, a.user.id).confirmed.length, 0)
  assert.throws(
    () => reviewMemory(store, b.user.id, memory.id, { expectedRevision: 0, status: 'confirmed' }),
    /not found/i
  )
  reviewMemory(store, a.user.id, memory.id, { expectedRevision: 0, status: 'rejected' })
  assert.equal(profile(store, a.user.id).confirmed.length, 0)
  store.close()
})
test('correction requires exact revision and explicit supersession', () => {
  const { store, a } = fixture()
  const first = confirmed(store, a.user.id)
  const correction = createMemory(store, a.user.id, {
    dimension: 'values',
    kind: 'explicit',
    field: 'friends',
    statement: 'I now prioritize learning.',
    value: 'learning'
  })
  assert.throws(
    () =>
      reviewMemory(store, a.user.id, correction.id, { expectedRevision: 0, status: 'confirmed' }),
    /supersedes/i
  )
  reviewMemory(store, a.user.id, correction.id, {
    expectedRevision: 0,
    status: 'confirmed',
    supersedesIds: [first.id]
  })
  assert.equal(profile(store, a.user.id).confirmed[0].id, correction.id)
  assert.throws(
    () =>
      changeVisibility(store, a.user.id, correction.id, {
        expectedRevision: 0,
        visibility: 'friends'
      }),
    /latest memory/i
  )
  store.close()
})
test('invitation consumption and explicit grants protect private and never-share memories', () => {
  const { store, a, b } = fixture()
  const secret = confirmed(store, a.user.id, 'never_share')
  const shared = confirmed(store, a.user.id, 'friends', 'shared')
  const invitation = invite(store, a.user.id)
  accept(store, b.user.id, { invitationToken: invitation.invitationToken })
  assert.throws(
    () => accept(store, b.user.id, { invitationToken: invitation.invitationToken }),
    /invalid/i
  )
  let connection = memberConnection(store, invitation.id, a.user.id)
  assert.equal(disclosedMemories(store, connection, a.user.id).length, 0)
  assert.throws(
    () =>
      grant(store, a.user.id, connection.id, {
        expectedRevision: connection.revision,
        memoryIds: [secret.id]
      }),
    /protected/i
  )
  grant(store, a.user.id, connection.id, {
    expectedRevision: connection.revision,
    memoryIds: [shared.id]
  })
  connection = memberConnection(store, connection.id, a.user.id)
  assert.deepEqual(
    disclosedMemories(store, connection, a.user.id).map((item) => item.id),
    [shared.id]
  )
  revoke(store, a.user.id, connection.id)
  assert.throws(() => memberConnection(store, connection.id, b.user.id), /accept/i)
  store.close()
})
test('real workflow contract: extraction stays pending, four council roles and strategist cite confirmed context', async () => {
  const { store, a, jobs, reasoner } = fixture()
  const interview = createInterview(store, a.user.id)
  answerInterview(store, a.user.id, interview.id, {
    expectedRevision: interview.revision,
    questionId: 'values',
    answer: 'I prioritize time with friends.'
  })
  finishInterview(store, jobs, reasoner, a.user.id, interview.id)
  await jobs.settle()
  const extracted = store.owned('interview', interview.id, a.user.id, interviewSchema)
  assert.equal(extracted.phase, 'ready')
  assert.equal(profile(store, a.user.id).confirmed.length, 0)
  const memory = profile(store, a.user.id).pending[0]
  reviewMemory(store, a.user.id, memory.id, {
    expectedRevision: memory.revision,
    status: 'confirmed'
  })
  const decision = startDecision(
    store,
    jobs,
    reasoner,
    {
      enabled: false,
      async search() {
        return { status: 'off', sources: [] }
      }
    },
    a.user.id,
    {
      objective: 'Plan my weekend.',
      options: [
        { id: 'friends', title: 'Friends', detail: 'Time together.' },
        { id: 'learn', title: 'Learn', detail: 'Read a paper.' }
      ],
      research: false
    }
  )
  await jobs.settle()
  const result = store.owned('decision', decision.id, a.user.id, decisionSchema)
  assert.equal(result.phase, 'ready')
  assert.equal(new Set(result.opinions.map((value) => value.role)).size, 4)
  assert.deepEqual(result.recommendation?.memoryIds, [memory.id])
  store.close()
})
test('two rounds exclude private data, enforce constraints, require both exact-plan approvals and invalidate disclosure changes', async () => {
  const { store, a, b, jobs, reasoner, seen } = fixture()
  confirmed(store, a.user.id, 'never_share')
  const shared = confirmed(store, a.user.id, 'friends', 'shared')
  let connection = connected(store, a.user.id, b.user.id)
  grant(store, a.user.id, connection.id, {
    expectedRevision: connection.revision,
    memoryIds: [shared.id]
  })
  let negotiation = createNegotiation(store, a.user.id, {
    connectionId: connection.id,
    objective: 'Plan a walk.',
    candidates: [candidate],
    brief
  })
  negotiation = submitBrief(store, b.user.id, negotiation.id, {
    expectedRevision: negotiation.revision,
    brief
  })
  startNegotiation(store, jobs, reasoner, a.user.id, negotiation.id)
  await jobs.settle()
  negotiation = readNegotiation(store, a.user.id, negotiation.id)
  assert.equal(negotiation.phase, 'awaiting_approval')
  assert.equal(negotiation.rounds.length, 4)
  assert.ok(seen.every((context) => !context.includes('SECRET_PRIVATE_NEVER_SHARE')))
  assert.throws(
    () =>
      approvePlan(store, a.user.id, negotiation.id, {
        planHash: 'a'.repeat(64),
        decision: 'approved'
      }),
    /exact/i
  )
  negotiation = approvePlan(store, a.user.id, negotiation.id, {
    planHash: negotiation.planHash,
    decision: 'approved'
  })
  assert.equal(negotiation.phase, 'awaiting_approval')
  negotiation = approvePlan(store, b.user.id, negotiation.id, {
    planHash: negotiation.planHash,
    decision: 'approved'
  })
  assert.equal(negotiation.phase, 'approved')
  connection = memberConnection(store, connection.id, a.user.id)
  grant(store, a.user.id, connection.id, { expectedRevision: connection.revision, memoryIds: [] })
  negotiation = readNegotiation(store, b.user.id, negotiation.id)
  assert.equal(negotiation.phase, 'stale')
  assert.equal(negotiation.rounds.length, 0)
  assert.equal(negotiation.plan, null)
  assert.deepEqual(negotiation.approvals, {})
  assert.equal(candidateFits({ ...candidate, costPerPerson: 31 }, brief), false)
  assert.equal(candidateFits(candidate, { ...brief, forbiddenTags: ['outdoors'] }), false)
  store.close()
})
test('provider failure persists failed state instead of a fabricated result', async () => {
  const { store, a, jobs } = fixture()
  const reasoner: Reasoner = {
    enabled: true,
    async generate() {
      throw new Error('provider offline')
    }
  }
  const decision = startDecision(
    store,
    jobs,
    reasoner,
    {
      enabled: false,
      async search() {
        return { status: 'off', sources: [] }
      }
    },
    a.user.id,
    {
      objective: 'Choose.',
      options: [
        { id: 'a', title: 'A', detail: 'A.' },
        { id: 'b', title: 'B', detail: 'B.' }
      ],
      research: false
    }
  )
  await jobs.settle()
  const result = store.owned('decision', decision.id, a.user.id, decisionSchema)
  assert.equal(result.phase, 'failed')
  assert.equal(result.recommendation, null)
  store.close()
})
test('browser blocks credential-bearing, private, cross-domain and unconfigured requests', async () => {
  for (const value of [
    'http://github.com',
    'https://localhost',
    'https://169.254.169.254',
    'https://user:password@github.com',
    'https://github.com/?secret=a',
    'https://evil.example'
  ]) {
    assert.throws(() => approvedUrl(value, ['github.com']))
  }
  assert.equal(
    approvedUrl('https://github.com/stablyai/orca', ['github.com']).hostname,
    'github.com'
  )
  await assert.rejects(
    createKernelBrowser(undefined, ['github.com']).read(
      'https://github.com',
      AbortSignal.timeout(1000)
    ),
    /Configure Kernel/
  )
})
