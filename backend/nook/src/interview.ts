import { z } from 'zod'
import {
  interviewQuestions,
  interviewSchema,
  memoryInput,
  memorySchema,
  timestamp
} from './contracts.js'
import type { Store } from './store.js'
import { fresh } from './store.js'
import type { Jobs } from './jobs.js'
import { insist } from './errors.js'
import { touchTwin } from './memory.js'
import type { Reasoner } from './ai.js'

const extractedMemory = z.object({
  ...memoryInput.shape,
  expiresAt: timestamp.nullable(),
  questionId: z.string(),
  quote: z.string().min(1).max(2000),
  confidence: z.number().min(0).max(1)
})
const extractionSchema = z.object({ memories: z.array(extractedMemory).max(12) })
export const answerSchema = z
  .object({
    questionId: z.enum(interviewQuestions.map(({ id }) => id)),
    answer: z.string().trim().min(3).max(2000),
    expectedRevision: z.number().int().nonnegative()
  })
  .strict()
export function createInterview(store: Store, ownerId: string) {
  return {
    ...store.insert(
      'interview',
      { ...fresh(ownerId), phase: 'interviewing', answers: [], memoryIds: [] },
      interviewSchema
    ),
    questions: interviewQuestions
  }
}
export function answerInterview(
  store: Store,
  ownerId: string,
  interviewId: string,
  input: unknown
) {
  const request = answerSchema.parse(input)
  const interview = store.owned('interview', interviewId, ownerId, interviewSchema)
  insist(
    interview.phase === 'interviewing',
    409,
    'interview_closed',
    'This interview is no longer accepting answers.'
  )
  insist(
    request.expectedRevision === interview.revision,
    409,
    'revision_conflict',
    'Read the latest interview before answering.'
  )
  const answers = interview.answers.filter((answer) => answer.questionId !== request.questionId)
  answers.push({
    questionId: request.questionId,
    answer: request.answer,
    answeredAt: new Date().toISOString()
  })
  return store.update('interview', { ...interview, answers }, interviewSchema)
}
export function finishInterview(
  store: Store,
  jobs: Jobs,
  reasoner: Reasoner,
  ownerId: string,
  interviewId: string
) {
  const interview = store.owned('interview', interviewId, ownerId, interviewSchema)
  insist(
    reasoner.enabled,
    503,
    'model_unconfigured',
    'Configure an AI provider before extracting memories.'
  )
  insist(
    interview.phase === 'interviewing' || interview.phase === 'failed',
    409,
    'interview_closed',
    'This interview has already been extracted or is running.'
  )
  insist(
    interview.answers.length > 0,
    400,
    'empty_interview',
    'Answer at least one interview question.'
  )
  jobs.requireAvailable(ownerId)
  const running = store.update(
    'interview',
    { ...interview, phase: 'running', error: undefined },
    interviewSchema
  )
  jobs.launch(
    ownerId,
    async (signal) => {
      const extracted = await reasoner.generate(
        'interview',
        { questions: interviewQuestions, answers: interview.answers },
        extractionSchema,
        signal
      )
      signal.throwIfAborted()
      store.transaction(() => {
        const ids: string[] = []
        const fields = new Set<string>()
        for (const candidate of extracted.memories) {
          const answer = interview.answers.find((item) => item.questionId === candidate.questionId)
          insist(
            answer?.answer.includes(candidate.quote),
            502,
            'unsupported_memory',
            'The extraction contained an unsupported quote.'
          )
          const parsed = memoryInput.parse(candidateFields(candidate))
          insist(
            !fields.has(parsed.field),
            502,
            'duplicate_memory',
            'The extraction contained conflicting memory fields.'
          )
          insist(
            !parsed.expiresAt || Date.parse(parsed.expiresAt) > Date.now(),
            502,
            'expired_memory',
            'The extraction returned an expired memory.'
          )
          fields.add(parsed.field)
          const memory = store.insert(
            'memory',
            {
              ...fresh(ownerId),
              ...parsed,
              visibility: 'private',
              status: 'pending',
              confidence:
                parsed.kind === 'inferred'
                  ? Math.min(candidate.confidence, 0.7)
                  : candidate.confidence,
              source: { type: 'interview', sourceId: interview.id, quote: candidate.quote }
            },
            memorySchema
          )
          ids.push(memory.id)
        }
        insist(ids.length > 0, 502, 'empty_extraction', 'No supported memories were extracted.')
        touchTwin(store, ownerId)
        store.update('interview', { ...running, phase: 'ready', memoryIds: ids }, interviewSchema)
        store.audit(ownerId, 'interview.extracted', interview.id)
      })
    },
    () => {
      const latest = store.owned('interview', interviewId, ownerId, interviewSchema)
      if (latest.phase === 'running') {
        store.update(
          'interview',
          {
            ...latest,
            phase: 'failed',
            error: 'Extraction failed or was interrupted. Your answers are saved; you can retry.'
          },
          interviewSchema
        )
      }
    }
  )
  return running
}
function candidateFields(candidate: z.infer<typeof extractedMemory>) {
  const {
    questionId: _questionId,
    quote: _quote,
    confidence: _confidence,
    expiresAt,
    ...fields
  } = candidate
  return { ...fields, ...(expiresAt ? { expiresAt } : {}) }
}
