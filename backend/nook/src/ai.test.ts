import test from 'node:test'
import assert from 'node:assert/strict'
import { z } from 'zod'
import { modelOutputSchema } from './ai.js'

test('Gemini decoder simplification retains types and required fields while server validation retains limits', () => {
  const schema = z.object({ name: z.string().min(1).max(20), scores: z.array(z.number().min(0).max(10)).max(4) }).strict()
  const simplified = modelOutputSchema(schema, 'https://generativelanguage.googleapis.com/v1beta/openai')
  const text = JSON.stringify(simplified)
  assert.doesNotMatch(text, /maxLength|maxItems/)
  assert.match(text, /minimum/)
  assert.match(text, /maximum/)
  assert.match(text, /required/)
  assert.equal(z.object({ type: z.literal('string') }).parse(simplified.properties?.name).type, 'string')
  assert.equal(schema.safeParse({ name: 'x'.repeat(21), scores: [11] }).success, false)
  const ordinary = modelOutputSchema(schema, 'https://openrouter.ai/api/v1')
  assert.equal(z.object({ maxLength: z.number() }).parse(ordinary.properties?.name).maxLength, 20)
})
