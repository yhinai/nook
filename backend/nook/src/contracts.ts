import { z } from 'zod'

export const text = z.string().trim().min(1).max(2000)
export const id = z.string().uuid()
export const timestamp = z.string().datetime({ offset: true })
export const dimensions = [
  'identity',
  'values',
  'goals',
  'preferences',
  'constraints',
  'decisionRules',
  'relationships',
  'interests',
  'communicationStyle'
] as const
export const memoryInput = z
  .object({
    dimension: z.enum(dimensions),
    kind: z.enum(['explicit', 'inferred', 'temporary', 'decision_rule']),
    field: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_.:-]+$/),
    statement: text,
    value: z.union([
      z.string().max(2000),
      z.number().finite(),
      z.boolean(),
      z.array(z.string().max(200)).max(20)
    ]),
    importance: z.number().int().min(1).max(5).default(3),
    visibility: z.enum(['public', 'friends', 'private', 'never_share']).default('private'),
    expiresAt: timestamp.optional()
  })
  .strict()
  .refine(
    (memory) => memory.kind !== 'temporary' || Boolean(memory.expiresAt),
    'Temporary memories require an expiry.'
  )
export const base = z.object({
  id,
  ownerId: id,
  revision: z.number().int().nonnegative(),
  createdAt: timestamp,
  updatedAt: timestamp
})
export const userSchema = base.extend({ displayName: z.string().trim().min(1).max(100) })
export const twinSchema = base.extend({ label: z.string().max(140) })
export const memorySchema = base.extend({
  ...memoryInput.shape,
  status: z.enum(['pending', 'confirmed', 'rejected', 'superseded']),
  confidence: z.number().min(0).max(1),
  source: z.object({
    type: z.enum(['user', 'interview', 'correction']),
    sourceId: z.string().max(100),
    quote: z.string().max(2000)
  })
})
export type Memory = z.infer<typeof memorySchema>
export const interviewQuestions = [
  { id: 'values', question: 'What matters most to you right now?' },
  {
    id: 'tradeoffs',
    question: 'What tradeoff would you accept, and what would you never compromise on?'
  },
  { id: 'goals', question: 'What are you trying to accomplish this year?' },
  { id: 'relationships', question: 'How do you protect time for friends and family?' },
  { id: 'week', question: 'What does an ideal week look like for you?' },
  { id: 'decisions', question: 'Tell me about a decision you are proud of and why you chose it.' },
  { id: 'risk', question: 'How do you approach risk, and what would change your mind?' },
  { id: 'constraints', question: 'Which current limits should your Twin respect?' }
] as const
export const interviewSchema = base.extend({
  phase: z.enum(['interviewing', 'running', 'ready', 'failed']),
  answers: z
    .array(z.object({ questionId: z.string(), answer: text, answeredAt: timestamp }))
    .max(8),
  memoryIds: z.array(id),
  error: z.string().optional()
})
export const optionSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: text,
    detail: text,
    feasible: z.boolean().default(true)
  })
  .strict()
export const decisionInput = z
  .object({
    objective: text,
    category: z
      .enum(['career', 'wellbeing', 'social', 'travel', 'learning', 'general'])
      .default('general'),
    options: z.array(optionSchema).min(2).max(6),
    research: z.boolean().default(true)
  })
  .strict()
export const councilRoles = ['career', 'finance', 'health', 'relationships'] as const
export const opinionSchema = z.object({
  role: z.enum(councilRoles),
  assessments: z
    .array(
      z.object({
        optionId: z.string(),
        stance: z.enum(['support', 'caution', 'oppose', 'uncertain']),
        score: z.number().min(0).max(10),
        reasoning: text,
        memoryIds: z.array(id).max(10)
      })
    )
    .min(2)
    .max(6),
  risks: z.array(text).max(8),
  unknowns: z.array(text).max(8)
})
export const recommendationSchema = z.object({
  optionId: z.string(),
  reasoning: text,
  memoryIds: z.array(id).max(12),
  conditions: z.array(text).max(8),
  unknowns: z.array(text).max(8)
})
export const sourceSchema = z.object({
  title: z.string().max(300),
  url: z.string().url(),
  highlights: z.array(z.string().max(1200)).max(2)
})
export const eventSchema = z.object({
  sequence: z.number().int().positive(),
  type: z.string(),
  at: timestamp,
  detail: z.string().max(500)
})
export const decisionSchema = base.extend({
  ...decisionInput.shape,
  phase: z.enum(['running', 'ready', 'failed']),
  memoryIds: z.array(id),
  memoryRevision: z.number(),
  opinions: z.array(opinionSchema).max(4),
  recommendation: recommendationSchema.nullable(),
  sources: z.array(sourceSchema).max(4),
  researchStatus: z.enum(['off', 'retrieved', 'unavailable']),
  events: z.array(eventSchema),
  error: z.string().optional()
})
export const connectionSchema = base.extend({
  recipientId: id.nullable(),
  phase: z.enum(['invited', 'active', 'revoked']),
  tokenHash: z.string(),
  expiresAt: timestamp,
  grants: z.record(z.string(), z.array(id).max(12))
})
export const slotSchema = z
  .object({ start: timestamp, end: timestamp })
  .strict()
  .refine(
    (slot) => Date.parse(slot.end) > Date.parse(slot.start),
    'A slot must end after it starts.'
  )
export const candidateSchema = z
  .object({
    id: z.string().min(1).max(80),
    title: text,
    detail: text,
    start: timestamp,
    end: timestamp,
    costPerPerson: z.number().min(0).max(100000),
    tags: z.array(z.string().trim().min(1).max(100)).max(12)
  })
  .strict()
  .refine(
    (candidate) => Date.parse(candidate.end) > Date.parse(candidate.start),
    'A plan must end after it starts.'
  )
export const briefSchema = z
  .object({
    maxCost: z.number().min(0).max(100000),
    available: z.array(slotSchema).min(1).max(12),
    requiredTags: z.array(z.string().max(100)).max(12).default([]),
    forbiddenTags: z.array(z.string().max(100)).max(12).default([]),
    preferences: z.string().max(1500).default(''),
    minScore: z.number().min(0).max(10).default(5)
  })
  .strict()
export const negotiationInput = z
  .object({
    connectionId: id,
    objective: text,
    candidates: z.array(candidateSchema).min(1).max(8),
    brief: briefSchema
  })
  .strict()
export const evaluationSchema = z.object({
  assessments: z
    .array(
      z.object({
        candidateId: z.string(),
        score: z.number().min(0).max(10),
        reasoning: text,
        memoryIds: z.array(id).max(12)
      })
    )
    .max(8),
  unknowns: z.array(text).max(6)
})
export const negotiationSchema = base.extend({
  connectionId: id,
  participants: z.array(id).length(2),
  objective: text,
  candidates: z.array(candidateSchema),
  briefs: z.record(z.string(), briefSchema),
  phase: z.enum([
    'awaiting_briefs',
    'running',
    'awaiting_approval',
    'approved',
    'rejected',
    'no_agreement',
    'failed',
    'stale'
  ]),
  disclosureFingerprint: z.string().nullable(),
  rounds: z.array(
    z.object({
      round: z.number().int(),
      userId: id,
      twinLabel: z.string(),
      evaluation: evaluationSchema
    })
  ),
  plan: candidateSchema.nullable(),
  planHash: z.string().nullable(),
  approvals: z.record(z.string(), z.enum(['approved', 'rejected'])),
  events: z.array(eventSchema),
  error: z.string().optional()
})
export type Decision = z.infer<typeof decisionSchema>
export type Negotiation = z.infer<typeof negotiationSchema>
export type Connection = z.infer<typeof connectionSchema>
export type Candidate = z.infer<typeof candidateSchema>
export type Brief = z.infer<typeof briefSchema>
export type Evaluation = z.infer<typeof evaluationSchema>
export type Entity = z.infer<typeof base>
