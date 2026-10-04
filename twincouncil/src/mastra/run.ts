import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { AskInput, AskState } from '../twin/council.ts'
import { errorMessage, log } from '../twin/log.ts'
import type { NegotiateInput, NegotiationState } from '../twin/negotiate.ts'
import { resolveStay, today } from '../twin/profile.ts'
import type { StayInput } from '../twin/profile.ts'
import type { ScoutState } from '../twin/schemas.ts'
import { ask } from './workflows/ask.ts'
import { eventScout, outputDir } from './workflows/event-scout.ts'
import { negotiate } from './workflows/negotiate.ts'

/** Ask the twin one question: route → Exa mission → council → recommendation. */
export async function askTwin(input: AskInput): Promise<AskState> {
  const run = await ask.createRun()
  const outcome = await run.start({ inputData: input })
  if (outcome.status !== 'success') {
    throw new Error(outcome.status === 'failed' ? outcome.error.message : `workflow ended as "${outcome.status}"`)
  }
  return outcome.result
}

/** Let two people's twins agree on a plan. */
export async function negotiateTwins(input: NegotiateInput): Promise<NegotiationState> {
  const run = await negotiate.createRun()
  const outcome = await run.start({ inputData: input })
  if (outcome.status !== 'success') {
    throw new Error(outcome.status === 'failed' ? outcome.error.message : `workflow ended as "${outcome.status}"`)
  }
  return outcome.result
}

/** The one event scout this process is doing or last did. The twin serves one person, so one at a time. */
export const current = {
  state: 'idle' as 'idle' | 'running' | 'done' | 'failed',
  startedAt: null as string | null,
  finishedAt: null as string | null,
  plan: [] as StayInput[],
  files: [] as string[],
  error: null as string | null,
}

/** Scout each stay in turn. Never throws: the outcome is recorded on `current`. */
export async function runPlan(plan: StayInput[]): Promise<ScoutState[]> {
  Object.assign(current, { state: 'running', startedAt: new Date().toISOString(), finishedAt: null, plan, files: [], error: null })
  const results: ScoutState[] = []
  try {
    for (const input of plan) {
      const stay = resolveStay(input)
      if (stay.end < today(stay.timeZone)) {
        log(`skipping ${stay.city}: that stay ended ${stay.end}`)
        continue
      }
      const run = await eventScout.createRun()
      const outcome = await run.start({ inputData: input })
      if (outcome.status !== 'success') {
        throw new Error(outcome.status === 'failed' ? outcome.error.message : `workflow ended as "${outcome.status}"`)
      }
      results.push(outcome.result)
      current.files.push(...outcome.result.files)
    }
    // Several stays: events.md holds all of them, one section per city.
    if (results.length > 1) {
      await writeFile(join(outputDir(), 'events.md'), results.map(result => result.markdown).join('\n---\n\n'))
    }
    current.state = 'done'
  } catch (err) {
    current.state = 'failed'
    current.error = errorMessage(err)
    log(`run failed: ${current.error}`)
  }
  current.finishedAt = new Date().toISOString()
  return results
}
