import { createStep, createWorkflow } from '@mastra/core/workflows'
import { log } from '../../twin/log.ts'
import { recall } from '../../twin/memory.ts'
import { choose, draftPlans, jointResearch, NegotiateInput, NegotiationState, renderNegotiation, scorePlans, statePosition } from '../../twin/negotiate.ts'

const positionsStep = createStep({
  id: 'positions',
  description: 'Each twin states its position from its own memory',
  inputSchema: NegotiateInput,
  outputSchema: NegotiationState,
  execute: async ({ inputData }) => {
    if (inputData.a === inputData.b) throw new Error(`negotiate needs two different people, but a and b are both "${inputData.a}"`)
    const [a, b] = await Promise.all([recall(inputData.a), recall(inputData.b)])
    log(`negotiate: ${a.name} and ${b.name}`)
    const positions = await Promise.all([statePosition(a, inputData.request), statePosition(b, inputData.request)])
    return { ...inputData, positions, evidence: [], plans: [], verdicts: [], chosen: null, markdown: null }
  },
})

const researchStep = createStep({
  id: 'research',
  description: 'One shared Exa mission, briefed from the positions',
  inputSchema: NegotiationState,
  outputSchema: NegotiationState,
  execute: async ({ inputData }) => ({ ...inputData, evidence: await jointResearch(inputData.request, inputData.positions) }),
})

const plansStep = createStep({
  id: 'plans',
  description: 'A neutral mediator drafts candidate plans from the evidence',
  inputSchema: NegotiationState,
  outputSchema: NegotiationState,
  execute: async ({ inputData }) => ({ ...inputData, plans: await draftPlans(inputData.request, inputData.positions, inputData.evidence) }),
})

const agreeStep = createStep({
  id: 'agree',
  description: 'Each twin scores the plans; the choice is made in code',
  inputSchema: NegotiationState,
  outputSchema: NegotiationState,
  execute: async ({ inputData }) => {
    const [a, b] = await Promise.all([recall(inputData.a), recall(inputData.b)])
    const verdicts = await Promise.all([a, b].map(person => scorePlans(person, inputData.request, inputData.plans, inputData.evidence)))
    const state = { ...inputData, verdicts, chosen: choose(inputData.plans, verdicts) }
    log(`negotiate: ${state.chosen ? `agreed on "${state.chosen}"` : 'no plan acceptable to both'}`)
    return { ...state, markdown: renderNegotiation(state) }
  },
})

/** Two twins, one shared round of research, one plan both can accept. */
export const negotiate = createWorkflow({
  id: 'negotiate',
  inputSchema: NegotiateInput,
  outputSchema: NegotiationState,
})
  .then(positionsStep)
  .then(researchStep)
  .then(plansStep)
  .then(agreeStep)
  .commit()
