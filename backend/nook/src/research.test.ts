import test from 'node:test'
import assert from 'node:assert/strict'
import { createExaResearch } from './research.js'

test('Exa sends the conversational query with fresh highlights and returns only retrieved HTTPS sources', async () => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (_url, options) => {
    const body = JSON.parse(String(options?.body))
    assert.equal(body.query, 'Oakland vegetarian dinner tonight')
    assert.deepEqual(body.contents, { highlights: true, maxAgeHours: 24, livecrawlTimeout: 10000 })
    return new Response(JSON.stringify({ results: [
      { title: 'Actual restaurant menu', url: 'https://example.com/menu', highlights: ['Vegetarian menu'] },
      { title: 'Unsafe result', url: 'http://example.com/menu', highlights: [] }
    ] }), { status: 200, headers: { 'Content-Type': 'application/json' } })
  }
  try {
    const research = createExaResearch({ exaKey: 'test-key', baseUrl: 'https://api.openai.com/v1', model: 'test' })
    const result = await research.searchQuery!('Oakland vegetarian dinner tonight', new AbortController().signal)
    assert.equal(result.status, 'retrieved')
    assert.deepEqual(result.sources, [{ title: 'Actual restaurant menu', url: 'https://example.com/menu', highlights: ['Vegetarian menu'] }])
  } finally { globalThis.fetch = originalFetch }
})
