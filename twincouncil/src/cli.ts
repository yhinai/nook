import { parseArgs } from 'node:util'
import './mastra/index.ts' // registers the agents and the workflows
import { askTwin, current, negotiateTwins, runPlan } from './mastra/run.ts'
import { exa } from './twin/exa.ts'
import { MemoryFact, memoryBrief, recall, remember } from './twin/memory.ts'
import { profile, StayInput } from './twin/profile.ts'

const USAGE = `npm run twin -- <command>

  ask "<question>" [--person me] [--with sam]      route → Exa mission → council → recommendation
  negotiate --a alice --b bob "<request>"          two twins agree on a plan
  remember "<fact>" [--person me] [--kind preference|value|constraint|goal|fact]
  memory [--person me]                             show what the twin knows
  scout [--city "New York, NY" --start 2026-10-19 --end 2026-10-25] [--mode visit|relocate]
                                                   events for one stay, or the whole itinerary → events.md
`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    person: { type: 'string' },
    with: { type: 'string', multiple: true },
    kind: { type: 'string' },
    a: { type: 'string' },
    b: { type: 'string' },
    city: { type: 'string' },
    mode: { type: 'string' },
    start: { type: 'string' },
    end: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  },
})
const [command, ...words] = positionals
const text = words.join(' ').trim()
const person = values.person ?? 'me'

function fail(message: string): never {
  console.error(`${message}\n\n${USAGE}`)
  process.exit(1)
}

if (values.help || !command) {
  console.log(USAGE)
  process.exit(command ? 0 : 1)
}
if (['ask', 'negotiate', 'scout'].includes(command) && !process.env.ANTHROPIC_API_KEY) {
  fail('ANTHROPIC_API_KEY is not set. Copy .env.example to .env and fill it in.')
}

let exitCode = 0
try {
  if (command === 'ask') {
    if (!text) fail('ask needs a question.')
    console.log((await askTwin({ question: text, person, others: values.with ?? [] })).markdown)
  } else if (command === 'negotiate') {
    if (!values.a || !values.b || !text) fail('negotiate needs --a, --b and a request.')
    console.log((await negotiateTwins({ a: values.a, b: values.b, request: text })).markdown)
  } else if (command === 'remember') {
    const kind = MemoryFact.shape.kind.safeParse(values.kind ?? 'preference')
    if (!text || !kind.success) fail('remember needs a fact, and --kind must be one of the listed kinds.')
    console.log(memoryBrief(await remember(person, text, kind.data)))
  } else if (command === 'memory') {
    console.log(memoryBrief(await recall(person)))
  } else if (command === 'scout') {
    let plan = profile.itinerary
    if (values.city) {
      const stay = StayInput.safeParse({ city: values.city, mode: values.mode, start: values.start, end: values.end })
      if (!stay.success) fail(`Invalid stay: ${stay.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`)
      plan = [stay.data]
    }
    for (const result of await runPlan(plan)) {
      console.log(`${result.stay.city}: ${result.events.length} events kept, ${result.unverified.length} could not be verified`)
    }
    if (current.state === 'failed') throw new Error(current.error ?? 'scout failed')
    console.log(`Wrote ${current.files.join(', ') || 'nothing (no stay is current)'}`)
  } else {
    fail(`Unknown command "${command}".`)
  }
} catch (err) {
  console.error(`Failed: ${err instanceof Error ? err.message : String(err)}`)
  exitCode = 1
}

await exa.disconnect()
process.exit(exitCode)
