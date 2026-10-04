import { readNegotiation, candidateFits, disclosureFingerprint } from './negotiation-records.js'
import { evaluationSchema, negotiationSchema, twinSchema } from './contracts.js'
import { digest, type Store } from './store.js'
import { memberConnection, disclosedMemories } from './connections.js'
import { checkEvidence, type Reasoner } from './ai.js'
import type { Jobs } from './jobs.js'
import { insist } from './errors.js'
import { appendEvent } from './decisions.js'

export function startNegotiation(
  store: Store,
  jobs: Jobs,
  reasoner: Reasoner,
  ownerId: string,
  negotiationId: string
) {
  const negotiation = readNegotiation(store, ownerId, negotiationId)
  insist(
    reasoner.enabled,
    503,
    'model_unconfigured',
    'Configure an AI provider before Twins negotiate.'
  )
  insist(
    negotiation.phase === 'awaiting_briefs',
    409,
    'negotiation_closed',
    'Start a new negotiation rather than changing a completed plan.'
  )
  insist(
    negotiation.participants.every((userId) => negotiation.briefs[userId]),
    409,
    'brief_missing',
    'Both participants must explicitly submit their planning brief.'
  )
  const connection = memberConnection(store, negotiation.connectionId, ownerId)
  const candidates = negotiation.candidates.filter(
    (candidate) =>
      Date.parse(candidate.start) > Date.now() &&
      negotiation.participants.every((userId) =>
        candidateFits(candidate, negotiation.briefs[userId])
      )
  )
  if (!candidates.length) {
    return store.update(
      'negotiation',
      appendEvent(
        { ...negotiation, phase: 'no_agreement' },
        'negotiation.no_agreement',
        "No supplied candidate satisfies both participants' hard constraints."
      ),
      negotiationSchema
    )
  }
  jobs.requireAvailable(ownerId)
  const disclosures = Object.fromEntries(
    negotiation.participants.map((userId) => [userId, disclosedMemories(store, connection, userId)])
  )
  const running = store.update(
    'negotiation',
    appendEvent(
      {
        ...negotiation,
        phase: 'running',
        disclosureFingerprint: disclosureFingerprint(store, connection)
      },
      'negotiation.started',
      'Twins will negotiate only explicitly shared context and supplied candidates.'
    ),
    negotiationSchema
  )
  const read = () => readNegotiation(store, ownerId, negotiationId)
  jobs.launch(
    ownerId,
    async (signal) => {
      for (let round = 1; round <= 2; round++) {
        const previous = read().rounds.filter((entry) => entry.round === round - 1)
        await Promise.all(
          negotiation.participants.map(async (userId) => {
            const twin = store.owned('twin', userId, userId, twinSchema)
            const evaluation = await reasoner.generate(
              'twin',
              {
                twinLabel: twin.label,
                objective: negotiation.objective,
                round,
                brief: negotiation.briefs[userId],
                memories: disclosures[userId],
                candidates,
                peerAssessments: previous.filter((entry) => entry.userId !== userId),
                instruction:
                  'Score every candidate exactly once. Your only knowledge of the person is the explicit shared brief and memories supplied here. Do not claim calendar access, bookings or human approval.'
              },
              evaluationSchema,
              signal
            )
            insist(
              evaluation.assessments.length === candidates.length &&
                new Set(evaluation.assessments.map((item) => item.candidateId)).size ===
                  candidates.length &&
                evaluation.assessments.every((item) =>
                  candidates.some((candidate) => candidate.id === item.candidateId)
                ),
              502,
              'invalid_candidates',
              'A Twin returned incomplete candidate assessments.'
            )
            checkEvidence(
              evaluation,
              disclosures[userId].map((memory) => memory.id),
              []
            )
            signal.throwIfAborted()
            const current = read()
            insist(
              current.phase === 'running',
              409,
              'context_changed',
              'The shared context changed during negotiation.'
            )
            store.update(
              'negotiation',
              appendEvent(
                {
                  ...current,
                  rounds: [...current.rounds, { round, userId, twinLabel: twin.label, evaluation }]
                },
                'twin.assessment',
                `${twin.label} completed negotiation round ${round}.`
              ),
              negotiationSchema
            )
          })
        )
      }
      const current = read()
      insist(
        current.phase === 'running',
        409,
        'context_changed',
        'Disclosure changed during negotiation.'
      )
      const final = current.rounds.filter((entry) => entry.round === 2)
      const ranked = candidates
        .map((candidate) => {
          const scores = negotiation.participants.map(
            (userId) =>
              final
                .find((entry) => entry.userId === userId)
                ?.evaluation.assessments.find((item) => item.candidateId === candidate.id)?.score ??
              -1
          )
          return {
            candidate,
            scores,
            minimum: Math.min(...scores),
            sum: scores.reduce((a, b) => a + b, 0)
          }
        })
        .filter(({ scores }) =>
          scores.every(
            (score, index) => score >= negotiation.briefs[negotiation.participants[index]].minScore
          )
        )
        .sort(
          (a, b) =>
            b.minimum - a.minimum ||
            b.sum - a.sum ||
            a.candidate.costPerPerson - b.candidate.costPerPerson ||
            a.candidate.id.localeCompare(b.candidate.id)
        )
      const plan = ranked[0]?.candidate ?? null
      signal.throwIfAborted()
      store.update(
        'negotiation',
        appendEvent(
          {
            ...current,
            phase: plan ? 'awaiting_approval' : 'no_agreement',
            plan,
            planHash: plan ? digest(JSON.stringify(plan)) : null
          },
          plan ? 'plan.proposed' : 'negotiation.no_agreement',
          plan
            ? 'Both Twins rate this plan above their disclosed threshold. Both humans must approve; nothing was booked or sent.'
            : "The Twins could not agree within both participants' fit thresholds."
        ),
        negotiationSchema
      )
      for (const participant of negotiation.participants) {
        store.audit(participant, 'negotiation.finished', negotiationId)
      }
    },
    () => {
      const current = store.read('negotiation', negotiationId, negotiationSchema)
      if (current?.phase === 'running') {
        store.update(
          'negotiation',
          appendEvent(
            {
              ...current,
              phase: 'failed',
              error:
                'Negotiation failed, timed out or its consent changed. No plan was approved or executed.'
            },
            'negotiation.failed',
            'Saved valid completed rounds; no action was executed.'
          ),
          negotiationSchema
        )
      }
    }
  )
  return running
}
