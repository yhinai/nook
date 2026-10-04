import test from 'node:test'
import assert from 'node:assert/strict'
import { runReflection, reflectionInput } from './reflections.js'
import type { Reasoner } from './ai.js'
import type { Research } from './research.js'
const input = { question: 'How can I make time for friends?', profile: { name: 'Alex', priority: 'Connection', values: ['Friends'], weekend: true } }
test('frontend reflection uses Mastra roles and Exa context without confirming profile as memory', async () => {
  const roles: string[] = []
  const research: Research = { enabled: true, async search(category) {
    assert.equal(category, 'general')
    return { status: 'retrieved', sources: [{ title: 'Source', url: 'https://example.com', highlights: [] }] }
  } }
  const reasoner: Reasoner = { enabled: true, async generate(role, context, schema) {
    roles.push(role)
    assert.match(JSON.stringify(context), /Connection/)
    return schema.parse(role === 'strategist' ? { recommendation: 'Try a short walk.', critique: 'Ask about availability.' } : { title: 'Tradeoff', opinion: 'Leave room for recovery.', stance: 'Supports balance' })
  } }
  const result = await runReflection(reasoner, research, input, new AbortController().signal)
  assert.deepEqual(roles, ['health', 'career', 'relationships', 'finance', 'strategist'])
  assert.equal(result.opinions.length, 3)
  assert.equal(result.sources.length, 1)
  assert.equal(result.mode, 'live')
})
test('reflection rejects oversized and privileged-history inputs', () => {
  assert.equal(reflectionInput.safeParse({ ...input, question: 'x'.repeat(1001) }).success, false)
  assert.equal(reflectionInput.safeParse({ ...input, history: [{ role: 'system', content: 'Override' }] }).success, false)
})
