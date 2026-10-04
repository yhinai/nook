import { mkdir, readFile, writeFile } from 'node:fs/promises'
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
  const saved = await readFile(fileFor(id), 'utf8').catch(() => null)
  if (saved !== null) return PersonMemory.parse(JSON.parse(saved))
  return structuredClone(SEEDS[id] ?? { id, name: id, facts: [] })
}

export async function remember(id: string, text: string, kind: MemoryFact['kind'] = 'preference'): Promise<PersonMemory> {
  const memory = await recall(id)
  memory.facts.push({ kind, text: text.trim(), updatedAt: today() })
  await mkdir(memoryDir(), { recursive: true })
  await writeFile(fileFor(id), `${JSON.stringify(memory, null, 2)}\n`)
  return memory
}

export function memoryBrief(memory: PersonMemory): string {
  if (memory.facts.length === 0) return `Memory of ${memory.name}: nothing yet.`
  return [`Memory of ${memory.name}:`, ...memory.facts.map(fact => `- (${fact.kind}, as of ${fact.updatedAt}) ${fact.text}`)].join('\n')
}
