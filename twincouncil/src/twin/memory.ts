import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { z } from 'zod'
import { profile, today } from './profile.ts'

// Twin memory: what the twin knows about a person. It is the only source for values and
// preferences, and it never goes to Exa or to the researcher agent.

const PERSON_ID = /^[a-z0-9_-]{1,40}$/

export const MemoryFact = z.object({
  kind: z.enum(['preference', 'value', 'constraint', 'goal', 'fact']),
  text: z.string().min(1),
  updatedAt: z.string(),
})
export type MemoryFact = z.infer<typeof MemoryFact>

export const PersonMemory = z.object({ id: z.string(), name: z.string(), facts: z.array(MemoryFact) })
export type PersonMemory = z.infer<typeof PersonMemory>

function seed(id: string, name: string, facts: [MemoryFact['kind'], string][]): PersonMemory {
  return { id, name, facts: facts.map(([kind, text]) => ({ kind, text, updatedAt: '2026-10-04' })) }
}

const home = profile.itinerary[0]?.city ?? 'San Francisco, CA'

// Used until a person has a saved memory file. "me" is ASSUMED from the profile; alice and bob are
// the demo personas from the TwinCouncil brief, for the twin-to-twin demo.
const SEEDS: Record<string, PersonMemory | undefined> = {
  me: seed('me', profile.name ?? 'Me', [
    ['fact', profile.about],
    ['fact', `Home base: ${home}`],
    ...profile.interests.map((interest): [MemoryFact['kind'], string] => ['preference', `Interested in ${interest}`]),
  ]),
  alice: seed('alice', 'Alice', [
    ['fact', `Lives in ${home}`],
    ['preference', 'Loves hiking'],
    ['constraint', 'Wants to spend under $300 on a weekend trip'],
    ['constraint', 'Free on Saturday morning'],
  ]),
  bob: seed('bob', 'Bob', [
    ['fact', `Lives in ${home}`],
    ['preference', 'Cares most about good food'],
    ['constraint', 'No camping'],
    ['constraint', 'Free on Saturday afternoon'],
  ]),
}

export function memoryDir(): string {
  return resolve(process.env.TWIN_MEMORY_DIR ?? join(process.env.TWIN_OUTPUT_DIR ?? process.cwd(), 'memory'))
}

function fileFor(id: string): string {
  // The id becomes a file name, so it is restricted to a safe alphabet.
  if (!PERSON_ID.test(id)) throw new Error(`invalid person id "${id}": use lowercase letters, digits, - or _`)
  return join(memoryDir(), `${id}.json`)
}

export async function recall(id: string): Promise<PersonMemory> {
  // Only a missing file means "nothing saved yet": after any other read error, falling back to the
  // seed would let the next remember() save the seed over the real file.
  const saved = await readFile(fileFor(id), 'utf8').catch((err: NodeJS.ErrnoException) => {
    if (err.code === 'ENOENT') return null
    throw err
  })
  if (saved !== null) {
    try {
      return PersonMemory.parse(JSON.parse(saved))
    } catch (err) {
      throw new Error(`memory file ${id}.json is not valid: ${err instanceof Error ? err.message : String(err)}`)
    }
  }
  // Own keys only: "constructor" and "__proto__" are valid ids and would find Object.prototype.
  return structuredClone((Object.hasOwn(SEEDS, id) ? SEEDS[id] : undefined) ?? { id, name: id, facts: [] })
}

// remember() reads, appends and writes back, so calls run one at a time: two that overlapped would
// read the same file, and the later write would drop the earlier fact.
let writes: Promise<unknown> = Promise.resolve()

export async function remember(id: string, text: string, kind: MemoryFact['kind'] = 'preference'): Promise<PersonMemory> {
  const file = fileFor(id)
  const fact = text.trim()
  // An empty fact would be saved and then fail MemoryFact on every later recall.
  if (!fact) throw new Error('nothing to remember: the text is empty')
  const turn = writes.then(async () => {
    const memory = await recall(id)
    memory.facts.push({ kind, text: fact, updatedAt: today() })
    await mkdir(memoryDir(), { recursive: true })
    // Written beside the file, then renamed into place: a concurrent recall never reads half a file.
    const temp = `${file}.${process.pid}.tmp`
    await writeFile(temp, `${JSON.stringify(memory, null, 2)}\n`)
    await rename(temp, file)
    return memory
  })
  writes = turn.catch(() => undefined)
  return turn
}

export function memoryBrief(memory: PersonMemory): string {
  if (memory.facts.length === 0) return `Memory of ${memory.name}: nothing yet.`
  return [`Memory of ${memory.name}:`, ...memory.facts.map(fact => `- (${fact.kind}, as of ${fact.updatedAt}) ${fact.text}`)].join('\n')
}
