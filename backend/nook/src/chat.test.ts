import test from 'node:test'
import assert from 'node:assert/strict'
import { chatInput, runChat, startChat } from './chat.js'
import type { Reasoner } from './ai.js'
import type { Research } from './research.js'
import { Jobs } from './jobs.js'

const input = {
  question: 'Find dinner for tonight',
  history: [{ role: 'user', content: 'I am in Oakland and want vegetarian food under $30.' }],
  profile: { name: 'Alex', priority: 'Connection', values: ['Friends'], weekend: true }
}
const source = { title: 'Restaurant menu', url: 'https://example.com/menu', highlights: ['Vegetarian dinner menu in Oakland.'] }

test('chat searches the actual request and history and grounds a conversational answer in retrieved sources', async () => {
  let calls = 0
  const research: Research = { enabled: true,
    async search() { throw new Error('Static category searches must not be used') },
    async searchQuery(query) {
      assert.equal(query, 'Oakland vegetarian dinner under $30 tonight')
      return { status: 'retrieved', sources: [source] }
    }
  }
  const reasoner: Reasoner = { enabled: true, async generate(role, context, schema) {
    assert.equal(role, 'chat')
    const data = context as { history: unknown; sources?: unknown }
    assert.deepEqual(data.history, input.history)
    if (calls++ === 0) return schema.parse({ searchQuery: 'Oakland vegetarian dinner under $30 tonight', clarification: null })
    assert.deepEqual(data.sources, [source])
    return schema.parse({ message: 'This menu includes vegetarian dinner: [menu](https://example.com/menu). Check current prices and hours before going.', ...(calls > 2 ? {evidence: [{claim: 'This menu includes vegetarian dinner', highlightIndex: 0, sourceIndex: 0}]} : {}) })
  } }
  const result = await runChat(reasoner, research, input, new AbortController().signal)
  assert.equal(calls, 3)
  assert.equal(result.mode, 'live')
  assert.equal(result.researchStatus, 'retrieved')
  assert.deepEqual(result.sources, [source])
})

test('chat asks a missing-location question before doing public research', async () => {
  const research: Research = { enabled: true, async search() { throw new Error('Unexpected search') }, async searchQuery() { throw new Error('Unexpected search') } }
  const reasoner: Reasoner = { enabled: true, async generate(_role, _context, schema) {
    return schema.parse({ searchQuery: null, clarification: 'What city or neighborhood should I look in?' })
  } }
  const result = await runChat(reasoner, research, { ...input, history: [] }, new AbortController().signal)
  assert.equal(result.message, 'What city or neighborhood should I look in?')
  assert.deepEqual(result.sources, [])
})

test('chat exposes failed live research to the answer model without supplying sample places', async () => {
  let calls = 0
  const reasoner: Reasoner = { enabled: true, async generate(_role, context, schema) {
    if (calls++ === 0) return schema.parse({ searchQuery: 'Oakland vegetarian dinner', clarification: null })
    assert.equal((context as { researchStatus: string }).researchStatus, 'unavailable')
    assert.deepEqual((context as { sources: unknown }).sources, [])
    return schema.parse({ message: 'I could not retrieve live results. What kind of food sounds good?' })
  } }
  const research: Research = { enabled: true, async search() { throw new Error('Unexpected search') }, async searchQuery() { return { status: 'unavailable', sources: [] } } }
  const result = await runChat(reasoner, research, input, new AbortController().signal)
  assert.equal(result.researchStatus, 'unavailable')
})

test('chat rejects fabricated links and unconfigured AI instead of answering with fixtures', async () => {
  const reasoner: Reasoner = { enabled: true, async generate(_role, _context, schema) {
    return schema.parse(_context && typeof _context === 'object' && 'searched' in _context
      ? { message: 'Try https://invented.example/menu' }
      : { searchQuery: null, clarification: null })
  } }
  const research: Research = { enabled: false, async search() { return { status: 'off', sources: [] } } }
  await assert.rejects(runChat(reasoner, research, input, new AbortController().signal), /unverified source URL/)
  assert.throws(() => startChat(new Jobs(), { ...reasoner, enabled: false }, research, 'owner', input), /Configure an AI provider/)
})

test('chat uses the supplied local timezone for planning and answering tonight requests', async () => {
  const timezone = 'America/Los_Angeles'
  const expectedDate = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(new Date())
  let calls = 0
  const reasoner: Reasoner = { enabled: true, async generate(_role, context, schema) {
    const data = context as { timezone: string; currentDate: string; currentTime: string; instruction: string }
    assert.equal(data.timezone, timezone)
    assert.equal(data.currentDate, expectedDate)
    assert.match(data.currentTime, /P[DS]T/)
    if (calls++ === 0) return schema.parse({ searchQuery: null, clarification: null })
    assert.match(data.instruction, /do not suggest a restaurant for tonight if retrieved hours say it is closed/)
    assert.match(data.instruction, /without recent menu\/price evidence/)
    return schema.parse({ message: 'What kind of dinner are you in the mood for?' })
  } }
  const research: Research = { enabled: false, async search() { throw new Error('Unexpected search') } }
  await runChat(reasoner, research, { ...input, timezone }, new AbortController().signal)
  assert.equal(calls, 2)
  assert.equal(chatInput.safeParse({ ...input, timezone: 'Invalid/Timezone' }).success, false)
})


test('researched chat audits the draft instead of returning unverified prices', async () => {
  let calls = 0
  const reasoner: Reasoner = { enabled: true, async generate(_role, context, schema) {
    if (calls++ === 0) return schema.parse({ searchQuery: 'Oakland vegetarian dinner', clarification: null })
    if (calls === 2) return schema.parse({ message: 'A meal costs $11 and it is verified open tonight.' })
    assert.equal((context as {draft: string}).draft, 'A meal costs $11 and it is verified open tonight.')
    return schema.parse({message: 'This vegetarian menu is a candidate, but I could not verify the total cost or tonight’s availability. [Menu](https://example.com/menu)', evidence: [{claim: 'This vegetarian menu', highlightIndex: 0, sourceIndex: 0}]})
  } }
  const research: Research = { enabled: true, async search() { throw new Error('Unexpected category search') }, async searchQuery() { return {status: 'retrieved', sources: [source]} } }
  const result = await runChat(reasoner, research, input, new AbortController().signal)
  assert.equal(result.message.includes('$11'), false)
  assert.equal(calls, 3)
})

test('source audit repairs an absent claim once and rejects persistent unsupported evidence', async () => {
  for (const repair of [true, false]) {
    let calls = 0
    const reasoner: Reasoner = { enabled: true, async generate(_role, context, schema) {
      calls++
      if (calls === 1) return schema.parse({ searchQuery: 'vegetarian dinner', clarification: null })
      if (calls === 2) return schema.parse({ message: 'This menu lists vegetarian dinner.' })
      if (calls === 4) assert.match((context as { validationFeedback: string }).validationFeedback, /exact substring/)
      return schema.parse({ message: 'This menu lists vegetarian dinner.', evidence: [{ claim: repair && calls === 4 ? 'This menu lists vegetarian dinner' : 'An absent claim', highlightIndex: 0, sourceIndex: 0 }] })
    } }
    const research: Research = { enabled: true, async search() { throw new Error('Unexpected search') }, async searchQuery() { return { status: 'retrieved', sources: [source] } } }
    const operation = runChat(reasoner, research, input, new AbortController().signal)
    if (repair) assert.equal((await operation).message, 'This menu lists vegetarian dinner.')
    else await assert.rejects(operation, /could not be supported/)
    assert.equal(calls, 4)
  }
})
test('client cancellation aborts active model work and releases the user job', async () => {
  const jobs = new Jobs()
  const controller = new AbortController()
  let modelAborted = false
  const reasoner: Reasoner = {
    enabled: true,
    async generate(_role, _context, _schema, signal) {
      return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => { modelAborted = true; reject(new DOMException('Cancelled', 'AbortError')) }, { once: true })
      })
    }
  }
  const pending = startChat(jobs, reasoner, { enabled: false, search: async () => ({ status: 'off', sources: [] }) }, 'cancelled-client', input, controller.signal)
  await new Promise(resolve => setImmediate(resolve))
  controller.abort()
  await assert.rejects(pending, error => error instanceof Error && error.name === 'AbortError')
  await jobs.settle()
  assert.equal(modelAborted, true)
  assert.doesNotThrow(() => jobs.requireAvailable('cancelled-client'))
})
