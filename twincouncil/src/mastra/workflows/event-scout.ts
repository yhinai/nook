import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { createStep, createWorkflow } from '@mastra/core/workflows'
import { log } from '../../twin/log.ts'
import { discover, findPeople, rank, verify } from '../../twin/phases.ts'
import { resolveStay, StayInput } from '../../twin/profile.ts'
import { render } from '../../twin/render.ts'
import { ScoutState } from '../../twin/schemas.ts'

export function outputDir(): string {
  return resolve(process.env.TWIN_OUTPUT_DIR ?? process.cwd())
}

const discoverStep = createStep({
  id: 'discover',
  description: 'Phase 1: separate Exa searches per category',
  inputSchema: StayInput,
  outputSchema: ScoutState,
  execute: async ({ inputData }) => {
    const stay = resolveStay(inputData)
    log(`discover: ${stay.city}, ${stay.start} to ${stay.end} (${stay.mode})`)
    const found = await discover(stay)
    return { stay, candidates: found.candidates, events: [], unverified: [], dropped: [], notes: found.notes, markdown: null, files: [] }
  },
})

const verifyStep = createStep({
  id: 'verify',
  description: 'Phase 2: open every page, apply the rules, keep the best',
  inputSchema: ScoutState,
  outputSchema: ScoutState,
  execute: async ({ inputData }) => {
    log(`verify: opening up to ${inputData.candidates.length} pages`)
    const checked = await verify(inputData.stay, inputData.candidates)
    const ranked = await rank(inputData.stay, checked.events)
    return {
      ...inputData,
      events: ranked.events,
      unverified: checked.unverified,
      dropped: [...checked.dropped, ...ranked.cut],
      notes: [...inputData.notes, ...checked.notes, ...ranked.notes],
    }
  },
})

const peopleStep = createStep({
  id: 'people',
  description: 'Phase 3: research announced speakers, hosts and sponsors',
  inputSchema: ScoutState,
  outputSchema: ScoutState,
  execute: async ({ inputData }) => {
    log(`people: researching ${inputData.events.length} events`)
    return { ...inputData, events: await findPeople(inputData.events) }
  },
})

const outputStep = createStep({
  id: 'output',
  description: 'Phase 4: write events.md',
  inputSchema: ScoutState,
  outputSchema: ScoutState,
  execute: async ({ inputData }) => {
    const markdown = render(inputData)
    const dir = outputDir()
    await mkdir(dir, { recursive: true })
    const slug = inputData.stay.city.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    const files = [join(dir, 'events.md'), join(dir, `events-${slug}-${inputData.stay.start}.md`)]
    for (const file of files) await writeFile(file, markdown)
    log(`output: wrote ${files.join(' and ')}`)
    return { ...inputData, markdown, files }
  },
})

/** One stay in, one events.md out. The order is fixed in code; no model decides what runs next. */
export const eventScout = createWorkflow({
  id: 'event-scout',
  inputSchema: StayInput,
  outputSchema: ScoutState,
})
  .then(discoverStep)
  .then(verifyStep)
  .then(peopleStep)
  .then(outputStep)
  .commit()
