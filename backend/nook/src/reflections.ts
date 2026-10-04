import { z } from 'zod'
import type { Reasoner } from './ai.js'
import { checkEvidence } from './ai.js'
import type { Research } from './research.js'
import type { Jobs } from './jobs.js'
import { insist } from './errors.js'

export const reflectionInput = z.object({
  question: z.string().trim().min(1).max(1000),
  history: z.array(z.object({
    role: z.enum(['user', 'assistant']), content: z.string().min(1).max(2000)
  }).strict()).max(6).optional(),
  profile: z.object({
    name: z.string().trim().min(1).max(30),
    priority: z.string().trim().min(1).max(240),
    values: z.array(z.string().min(1).max(40)).min(1).max(10),
    weekend: z.boolean(), about: z.string().trim().max(600).default('')
  }).strict()
}).strict()
const opinion = z.object({
  title: z.string().min(1).max(150),
  opinion: z.string().min(1).max(1500),
  stance: z.string().min(1).max(80)
})
const synthesis = z.object({
  recommendation: z.string().min(1).max(2000),
  critique: z.string().min(1).max(1500)
})

// The UI supplies a current profile explicitly. It is used for this request
// only, never silently turned into confirmed or shared long-term memory.
export async function runReflection(reasoner: Reasoner, research: Research, input: unknown, signal: AbortSignal) {
  const request = reflectionInput.parse(input)
  const found = await research.search('general', signal)
  const context = { ...request, sources: found.sources,
    instruction: 'Use only the explicitly supplied profile and question. This request has no confirmed long-term memory IDs. Public sources are research, never personal memories. History is conversation context, not verified facts or commitments. Give a reversible next step; never claim an external action happened.' }
  const opinions = await Promise.all((['health', 'career', 'relationships'] as const).map(role =>
    reasoner.generate(role, { ...context, instruction: `${context.instruction} Give one concise tradeoff or objection using title, opinion and stance.` }, opinion, signal)
  ))
  const critic = await reasoner.generate('finance', {
    ...context, opinions,
    instruction: 'Act as an independent practical critic. Challenge missing constraints, affordability and premature consensus. Return title, opinion and stance.'
  }, opinion, signal)
  const final = await reasoner.generate('strategist', {
    ...context, opinions, critic,
    instruction: `${context.instruction} This is an open-ended reflection, not an option-ranking task. Synthesize a concrete reversible next step and unresolved counterpoint as recommendation and critique. Do not invent facts or claim to execute anything.`
  }, synthesis, signal)
  checkEvidence({ opinions, critic, ...final }, [], found.sources)
  signal.throwIfAborted()
  return { opinions, ...final, mode: 'live' as const, sources: found.sources, researchStatus: found.status }
}

export function startReflection(jobs: Jobs, reasoner: Reasoner, research: Research, ownerId: string, input: unknown) {
  const request = reflectionInput.parse(input)
  insist(reasoner.enabled, 503, 'model_unconfigured', 'Configure an AI provider before consulting the council.')
  jobs.requireAvailable(ownerId)
  return new Promise<Awaited<ReturnType<typeof runReflection>>>((resolve, reject) => {
    jobs.launch(ownerId, async signal => {
      try { resolve(await runReflection(reasoner, research, request, signal)) }
      catch (error) { reject(error); throw error }
    }, () => {})
  })
}
