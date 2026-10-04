import { z } from 'zod'
import { mediatorAgent, twinAgent } from '../mastra/council-agents.ts'
import { Evidence, evidenceBlock, liveCheck, research, sourceList } from './council.ts'
import type { Route } from './council.ts'
import { askJson } from './llm.ts'
import { memoryBrief } from './memory.ts'
import type { PersonMemory } from './memory.ts'
import { today } from './profile.ts'
import { cell } from './render.ts'

// Twin-to-twin: each twin sees only its own person's memory. They exchange positions, share one
// round of Exa research, and each scores the same candidate plans.

export const NegotiateInput = z.object({
  a: z.string().describe('Person id of the first twin, e.g. "alice"'),
  b: z.string().describe('Person id of the second twin, e.g. "bob"'),
  request: z.string().min(3).describe('What the two of them want to arrange'),
})
export type NegotiateInput = z.infer<typeof NegotiateInput>

const PositionBody = z.object({
  mustHave: z.array(z.string()),
  niceToHave: z.array(z.string()),
  dealBreakers: z.array(z.string()),
  origin: z.string().nullable().describe('Where they would start from, if it matters'),
})
export const Position = z.object({ person: z.string(), name: z.string(), ...PositionBody.shape })
export type Position = z.infer<typeof Position>

export const Plan = z.object({
  name: z.string(),
  summary: z.string(),
  schedule: z.array(z.string()).describe('Timed steps, e.g. "Sat 09:00 hike ..."'),
  costPerPerson: z.string().nullable().describe('Only if the evidence supports a figure'),
  evidence: z.array(z.string()).describe('Evidence ids, like r2'),
})
export type Plan = z.infer<typeof Plan>
const Plans = z.object({ plans: z.array(Plan) })

const VerdictBody = z.object({
  scores: z.array(
    z.object({
      plan: z.string().describe('Plan name, exactly as given'),
      score: z.number().describe('0-100'),
      acceptable: z.boolean().describe('false if it breaks a must-have or hits a deal-breaker'),
      likes: z.array(z.string()),
      objections: z.array(z.string()),
    }),
  ),
})
export const Verdict = z.object({ person: z.string(), name: z.string(), ...VerdictBody.shape })
export type Verdict = z.infer<typeof Verdict>

export const NegotiationState = z.object({
  a: z.string(),
  b: z.string(),
  request: z.string(),
  positions: z.array(Position),
  evidence: z.array(Evidence),
  plans: z.array(Plan),
  verdicts: z.array(Verdict),
  chosen: z.string().nullable(),
  markdown: z.string().nullable(),
})
export type NegotiationState = z.infer<typeof NegotiationState>

/** Each twin states its person's position from its own memory, sharing only what planning needs. */
export async function statePosition(person: PersonMemory, request: string): Promise<Position> {
  const prompt = [
    `Today is ${today()}. You are the twin of ${person.name}, negotiating with another person's twin.`,
    memoryBrief(person),
    `The two of them want to arrange: "${request}"`,
    `State ${person.name}'s position. Share only what the other side needs in order to plan; everything else in memory stays private.`,
  ].join('\n')
  const body = await askJson(twinAgent, prompt, PositionBody, { label: `position ${person.id}` })
  return { person: person.id, name: person.name, ...body }
}

/** The twins need facts neither has: one shared Exa mission, briefed from the positions (no names). */
export async function jointResearch(request: string, positions: Position[]): Promise<Evidence[]> {
  const sides = positions.map((p, i) =>
    [
      `Person ${i + 1} needs: ${p.mustHave.join('; ') || 'nothing specific'}.`,
      `Would like: ${p.niceToHave.join('; ') || 'nothing specific'}.`,
      `Rules out: ${p.dealBreakers.join('; ') || 'nothing'}.`,
      p.origin ? `Starts from: ${p.origin}.` : '',
    ]
      .filter(Boolean)
      .join(' '),
  )
  const plan: Route = {
    mission: 'discover',
    reason: 'two twins need shared facts before they can agree',
    brief: [`Two people want to arrange: ${request}.`, ...sides].join(' '),
    questions: [
      'Which specific options satisfy both people at once?',
      'How long does it take to get there from where they start?',
      'What does it cost per person at current prices?',
      'What is there to do and to eat, and is it open and available on the days in question?',
    ],
    council: [],
  }
  return liveCheck(await research(plan))
}

export async function draftPlans(request: string, positions: Position[], evidence: Evidence[]): Promise<Plan[]> {
  const prompt = [
    `Today is ${today()}. Two people want to arrange: "${request}"`,
    ...positions.map(p => `${p.name}'s position: ${JSON.stringify({ mustHave: p.mustHave, niceToHave: p.niceToHave, dealBreakers: p.dealBreakers, origin: p.origin })}`),
    evidenceBlock(evidence),
    'Draft 3 distinct plans that could work for both. Build each only from the evidence, cite the ids it rests on, and leave the cost null where the evidence gives no figure.',
  ].join('\n')
  const { plans } = await askJson(mediatorAgent, prompt, Plans, { label: 'draft plans' })
  return plans.slice(0, 3)
}

/** Each twin scores every plan against its own person's memory. */
export async function scorePlans(person: PersonMemory, request: string, plans: Plan[], evidence: Evidence[]): Promise<Verdict> {
  if (plans.length === 0) return { person: person.id, name: person.name, scores: [] }
  const prompt = [
    `Today is ${today()}. You are the twin of ${person.name}. The request: "${request}"`,
    memoryBrief(person),
    `Candidate plans: ${JSON.stringify(plans)}`,
    evidenceBlock(evidence),
    `Score every plan for ${person.name}: 0-100 for fit, whether it is acceptable at all, what they would like, and what they would object to.`,
  ].join('\n')
  const body = await askJson(twinAgent, prompt, VerdictBody, { label: `score ${person.id}` })
  return { person: person.id, name: person.name, ...body }
}

const plain = (text: string) => text.toLowerCase().replace(/[^\p{L}\p{M}\p{N}]+/gu, '')

/** Decided in code: among plans both accept, the one whose less-happy side is happiest. */
export function choose(plans: Plan[], verdicts: Verdict[]): string | null {
  if (verdicts.length === 0) return null
  let best: { name: string; floor: number; total: number } | null = null
  for (const plan of plans) {
    const scores = verdicts.map(verdict => verdict.scores.find(score => plain(score.plan) === plain(plan.name)))
    if (scores.some(score => !score || !score.acceptable)) continue
    const values = scores.map(score => score?.score ?? 0)
    const candidate = { name: plan.name, floor: Math.min(...values), total: values.reduce((sum, value) => sum + value, 0) }
    if (!best || candidate.floor > best.floor || (candidate.floor === best.floor && candidate.total > best.total)) best = candidate
  }
  return best ? best.name : null
}

export function renderNegotiation(state: NegotiationState): string {
  const lines: string[] = [`# ${state.request}`, '', `Negotiated between ${state.positions.map(p => `${p.name}'s twin`).join(' and ')}.`, '']
  const scoreOf = (verdict: Verdict, plan: Plan) => verdict.scores.find(score => plain(score.plan) === plain(plan.name))

  const chosen = state.plans.find(plan => plan.name === state.chosen)
  if (chosen) {
    lines.push(`## Agreed plan: ${chosen.name}`, '', chosen.summary, '', ...chosen.schedule.map(step => `- ${step}`), '')
    lines.push(`Estimated cost per person: ${chosen.costPerPerson ?? 'not established by the evidence'}. Rests on: ${chosen.evidence.join(', ') || 'no cited evidence'}.`, '')
  } else {
    lines.push('## No agreement', '', state.plans.length > 0 ? 'No candidate plan was acceptable to both sides. The scores and objections are below.' : 'No candidate plans could be drafted from the evidence, so there was nothing to score.', '')
  }

  lines.push('## Positions', '')
  for (const p of state.positions) {
    lines.push(`- **${p.name}**: needs ${p.mustHave.join('; ') || 'nothing specific'}. Would like ${p.niceToHave.join('; ') || 'nothing specific'}. Rules out ${p.dealBreakers.join('; ') || 'nothing'}.`)
  }

  if (state.plans.length > 0) lines.push('', '## Candidates', '', `| ${['Plan', ...state.verdicts.map(v => cell(v.name)), 'Objections'].join(' | ')} |`, `|---|${state.verdicts.map(() => '---|').join('')}---|`)
  for (const plan of state.plans) {
    const cells = state.verdicts.map(verdict => {
      const score = scoreOf(verdict, plan)
      return score ? `${Math.round(score.score)}${score.acceptable ? '' : ' (not acceptable)'}` : '—'
    })
    const objections = state.verdicts.flatMap(verdict => (scoreOf(verdict, plan)?.objections ?? []).map(objection => `${verdict.name}: ${objection}`))
    lines.push(`| ${[cell(plan.name), ...cells, cell(objections.join('; '))].join(' | ')} |`)
  }
  lines.push('')
  if (state.evidence.length > 0) lines.push('## Sources', '', ...sourceList(state.evidence), '')
  lines.push('_Each twin saw only its own person\'s memory. Advice only: nothing was booked, bought or sent._', '')
  return lines.join('\n')
}
