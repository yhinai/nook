import { z } from 'zod'
import {
  councilRoles,
  decisionInput,
  decisionSchema,
  opinionSchema,
  recommendationSchema,
  twinSchema,
  memorySchema,
  type Decision
} from './contracts.js'
import type { Store } from './store.js'
import { fresh } from './store.js'
import type { Jobs } from './jobs.js'
import { checkEvidence, type Reasoner } from './ai.js'
import type { Research } from './research.js'
import { memoryContext, relevantMemories, isCurrent } from './memory.js'
import { insist } from './errors.js'

export function appendEvent<T extends { events: Decision['events'] }>(
  value: T,
  type: string,
  detail: string
): T {
  return {
    ...value,
    events: [
      ...value.events,
      { sequence: value.events.length + 1, type, detail, at: new Date().toISOString() }
    ]
  }
}
export function startDecision(
  store: Store,
  jobs: Jobs,
  reasoner: Reasoner,
  research: Research,
  ownerId: string,
  input: unknown
): Decision {
  const request = decisionInput.parse(input)
  insist(
    reasoner.enabled,
    503,
    'model_unconfigured',
    'Configure an AI provider before consulting the council.'
  )
  insist(
    new Set(request.options.map((option) => option.id)).size === request.options.length,
    400,
    'duplicate_options',
    'Decision option IDs must be unique.'
  )
  insist(
    request.options.some((option) => option.feasible),
    400,
    'no_feasible_option',
    'At least one option must be feasible.'
  )
  jobs.requireAvailable(ownerId)
  const memories = relevantMemories(store, ownerId, `${request.objective} ${request.category}`)
  const twin = store.owned('twin', ownerId, ownerId, twinSchema)
  const created = store.insert(
    'decision',
    appendEvent(
      {
        ...fresh(ownerId),
        ...request,
        phase: 'running',
        memoryIds: memories.map((memory) => memory.id),
        memoryRevision: twin.revision,
        opinions: [],
        recommendation: null,
        sources: [],
        researchStatus: 'off',
        events: []
      },
      'decision.started',
      'Retrieved relevant confirmed memories; consulting the council.'
    ),
    decisionSchema
  )
  const read = () => store.owned('decision', created.id, ownerId, decisionSchema)
  jobs.launch(
    ownerId,
    async (signal) => {
      const found = request.research
        ? await research.search(request.category, signal)
        : { status: 'off' as const, sources: [] }
      store.update(
        'decision',
        appendEvent(
          { ...read(), sources: found.sources, researchStatus: found.status },
          'research.finished',
          `Exa research: ${found.status}.`
        ),
        decisionSchema
      )
      const context = {
        twinLabel: twin.label,
        objective: request.objective,
        options: request.options,
        memories: memoryContext(memories),
        sources: found.sources,
        researchStatus: found.status
      }
      let next = 0
      async function worker() {
        while (next < councilRoles.length) {
          signal.throwIfAborted()
          const role = councilRoles[next++]
          const opinion = await reasoner.generate(
            role,
            {
              ...context,
              role,
              instruction:
                'Assess every supplied option exactly once. Genuine disagreement is useful; do not manufacture facts or force opposition. Only confirmed supplied memories describe the person.'
            },
            opinionSchema.extend({ role: z.literal(role) }),
            signal
          )
          insist(
            opinion.role === role,
            502,
            'invalid_role',
            'The council returned an invalid role.'
          )
          insist(
            opinion.assessments.length === request.options.length &&
              new Set(opinion.assessments.map((item) => item.optionId)).size ===
                request.options.length &&
              opinion.assessments.every((item) =>
                request.options.some((option) => option.id === item.optionId)
              ),
            502,
            'invalid_options',
            'The council returned incomplete option assessments.'
          )
          checkEvidence(opinion, created.memoryIds, found.sources)
          signal.throwIfAborted()
          store.update(
            'decision',
            appendEvent(
              { ...read(), opinions: [...read().opinions, opinion] },
              'council.opinion',
              `${role} completed its assessment.`
            ),
            decisionSchema
          )
        }
      }
      await Promise.all([worker(), worker()])
      const recommendation = await reasoner.generate(
        'strategist',
        {
          ...context,
          opinions: read().opinions,
          instruction:
            'Choose a feasible supplied option and explain alignment using actual confirmed memory IDs. Preserve disagreement, risks and unknowns. A recommendation is not approval or execution.'
        },
        recommendationSchema,
        signal
      )
      checkEvidence(recommendation, created.memoryIds, found.sources)
      insist(
        request.options.some((option) => option.id === recommendation.optionId && option.feasible),
        502,
        'invalid_recommendation',
        'The strategist chose an infeasible or unknown option.'
      )
      insist(
        !memories.length || recommendation.memoryIds.length > 0,
        502,
        'missing_evidence',
        "The recommendation did not reference this person's confirmed judgment."
      )
      const currentTwin = store.owned('twin', ownerId, ownerId, twinSchema)
      insist(
        currentTwin.revision === twin.revision &&
          memories.every((memory) => {
            const current = store.read('memory', memory.id, memorySchema)
            return current && isCurrent(current) && current.revision === memory.revision
          }),
        409,
        'context_changed',
        'Your confirmed context changed during the decision. Run it again.'
      )
      signal.throwIfAborted()
      store.update(
        'decision',
        appendEvent(
          { ...read(), phase: 'ready', recommendation },
          'decision.ready',
          'The Life Strategist prepared a recommendation; no external action occurred.'
        ),
        decisionSchema
      )
      store.audit(ownerId, 'decision.ready', created.id)
    },
    () => {
      const current = read()
      if (current.phase === 'running') {
        store.update(
          'decision',
          appendEvent(
            {
              ...current,
              phase: 'failed',
              error:
                'Council work failed, timed out, or its context changed. Completed opinions are saved; start a new decision.'
            },
            'decision.failed',
            'Saved completed work; no recommendation was accepted.'
          ),
          decisionSchema
        )
      }
    }
  )
  return created
}
