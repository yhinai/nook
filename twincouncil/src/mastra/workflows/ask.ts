import { createStep, createWorkflow } from '@mastra/core/workflows'
import { AskInput, AskState, convene, liveCheck, renderAnswer, research, route, synthesize } from '../../twin/council.ts'
import { log } from '../../twin/log.ts'
import { recall } from '../../twin/memory.ts'

// Memory is read fresh in each step rather than carried in workflow state, so private memory is
// never part of what Mastra stores or returns for a run.
async function people(state: { person: string; others: string[] }) {
  return { me: await recall(state.person), others: await Promise.all(state.others.map(id => recall(id))) }
}

const routeStep = createStep({
  id: 'route',
  description: 'Memory question, or which Exa mission?',
  inputSchema: AskInput,
  outputSchema: AskState,
  execute: async ({ inputData }) => {
    const state = { question: inputData.question, person: inputData.person ?? 'me', others: inputData.others ?? [] }
    const { me, others } = await people(state)
    const plan = await route(state.question, me, others)
    log(`ask: ${plan.mission} (${plan.reason})`)
    return { ...state, route: plan, evidence: [], opinions: [], recommendation: null, markdown: null }
  },
})

const researchStep = createStep({
  id: 'research',
  description: 'Exa mission, then a live check of the top sources in a Kernel browser',
  inputSchema: AskState,
  outputSchema: AskState,
  execute: async ({ inputData }) => ({ ...inputData, evidence: await liveCheck(await research(inputData.route)) }),
})

const councilStep = createStep({
  id: 'council',
  description: 'Each advisor the twin called gives its view',
  inputSchema: AskState,
  outputSchema: AskState,
  execute: async ({ inputData }) => {
    const { me, others } = await people(inputData)
    log(`council: ${inputData.route.council.join(', ') || 'not convened'}`)
    return { ...inputData, opinions: await convene(inputData.question, me, others, inputData.route, inputData.evidence) }
  },
})

const answerStep = createStep({
  id: 'answer',
  description: 'The twin makes the personalised recommendation',
  inputSchema: AskState,
  outputSchema: AskState,
  execute: async ({ inputData }) => {
    const { me, others } = await people(inputData)
    const recommendation = await synthesize(inputData.question, me, others, inputData.route, inputData.evidence, inputData.opinions)
    const state = { ...inputData, recommendation }
    return { ...state, markdown: renderAnswer(state) }
  },
})

/** intent → Exa research → evidence → council → the twin's recommendation. */
export const ask = createWorkflow({
  id: 'ask',
  inputSchema: AskInput,
  outputSchema: AskState,
})
  .then(routeStep)
  .then(researchStep)
  .then(councilStep)
  .then(answerStep)
  .commit()
