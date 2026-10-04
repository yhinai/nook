import test from 'node:test';
import assert from 'node:assert/strict';
import { chatConfig, localChatIdentity, runChat } from '../lib/chat-agent.ts';
import { decisionSchema } from '../lib/workspace.ts';
const input = { question: 'Find vegetarian dinner in Oakland under $40', profile: { name: 'A', priority: 'Rest', values: ['Friends'], weekend: true } };
const config = { key: 'server-secret', model: 'test', exaKey: 'research-secret' };
const ai = value => Response.json({ choices: [{ message: { content: JSON.stringify(value.message ? { evidence: [], ...value } : value) } }] });
test('binding values override process values and generic, OpenRouter, Google and OpenAI provider keys work', () => {
  assert.equal(chatConfig({ AI_API_KEY: 'binding', AI_BASE_URL: 'https://gateway.example/v1', AI_MODEL: 'configured' }, { AI_API_KEY: 'process' }).key, 'binding');
  assert.equal(chatConfig({ GOOGLE_API_KEY: 'google' }, {}).provider, 'google');
  assert.equal(chatConfig({ OPENAI_API_KEY: 'openai' }, {}).provider, 'openai');
  assert.equal(chatConfig({ OPENROUTER_API_KEY: 'router' }, {}).baseUrl, 'https://openrouter.ai/api/v1');
  assert.equal(chatConfig({ AI_API_KEY: '' }, { AI_API_KEY: 'process' }).key, '');
});
test('development identity rejects external forwarding and production but allows local proxy', () => {
  assert.equal(localChatIdentity(new Request('http://localhost:3000/api/chat'), true), 'local-development');
  assert.equal(localChatIdentity(new Request('http://localhost:3000/api/chat', { headers: { 'x-forwarded-host': 'localhost:3000', 'x-forwarded-for': '::1' } }), true), 'local-development');
  assert.equal(localChatIdentity(new Request('https://nook.example/api/chat'), true), null);
  assert.equal(localChatIdentity(new Request('http://localhost:3000/api/chat', { headers: { 'x-forwarded-host': 'nook.example' } }), true), null);
  assert.equal(localChatIdentity(new Request('http://localhost:3000/api/chat', { headers: { 'x-forwarded-for': '203.0.113.1' } }), true), null);
  assert.equal(localChatIdentity(new Request('http://localhost:3000/api/chat'), false), null);
});
test('real search uses planned user query and history, returning only retrieved safe sources', async () => {
  let calls = 0;
  const history = [{ role: 'user', content: 'Dinner tonight?' }, { role: 'assistant', content: 'Which city?' }];
  const mock = async (url, options) => {
    const body = JSON.parse(options.body);
    if (url === 'https://api.exa.ai/search') {
      assert.equal(options.headers['x-api-key'], 'research-secret');
      assert.equal(body.query, 'Oakland vegetarian dinner under $40');
      return Response.json({ results: [{ title: 'Actual restaurant', url: 'https://restaurant.example/menu', highlights: ['Vegetarian dinner menu.'] }, { title: 'Unsafe', url: 'javascript:alert(1)', highlights: ['Ignored'] }] });
    }
    calls++;
    const context = JSON.parse(body.messages[1].content);
    assert.deepEqual(context.history, history);
    if (calls === 1) return ai({ searchQuery: 'Oakland vegetarian dinner under $40', needsLocation: false });
    assert.equal(context.sources.length, 1);
    assert.equal(context.researchStatus, 'retrieved');
    if (calls === 2) assert.ok(body.messages[0].content.includes('Never invent a place'));
    return ai({ message: 'This menu has vegetarian options [1].', sourceIndices: [0, 5], evidence: [{ claim: 'vegetarian options', quote: 'Vegetarian dinner menu.', sourceIndex: 0 }] });
  };
  const result = await runChat({ ...input, history }, config, undefined, mock);
  assert.equal(result.mode, 'live');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://restaurant.example/menu');
  assert.ok(!JSON.stringify(result).includes('secret'));
});
test('missing location and personal chat do not invoke Exa', async () => {
  for (const needsLocation of [true, false]) {
    let calls = 0;
    const mock = async (url, options) => {
      assert.notEqual(url, 'https://api.exa.ai/search');
      const body = JSON.parse(options.body);
      calls++;
      if (calls === 1) return ai({ searchQuery: needsLocation ? 'must not search' : null, needsLocation });
      const context = JSON.parse(body.messages[1].content);
      assert.equal(context.researchStatus, 'off');
      assert.equal(context.needsLocation, needsLocation);
      return ai({ message: needsLocation ? 'Which city should I look in?' : 'What would make that easier today?', sourceIndices: [] });
    };
    const result = await runChat({ ...input, question: needsLocation ? 'Find dinner' : 'I feel overwhelmed' }, config, undefined, mock);
    assert.equal(result.sources.length, 0);
    assert.equal(calls, 2);
  }
});
test('search outage or missing Exa key gives AI unavailable status without canned fallback', async () => {
  for (const exaKey of ['', 'key']) {
    let calls = 0;
    const mock = async (url, options) => {
      if (url === 'https://api.exa.ai/search') return Response.json({ privateError: 'secret' }, { status: 503 });
      calls++;
      if (calls === 1) return ai({ searchQuery: 'Oakland dinner', needsLocation: false });
      const body = JSON.parse(options.body);
      assert.equal(JSON.parse(body.messages[1].content).researchStatus, 'unavailable');
      assert.ok(body.messages[0].content.includes('give no specific external recommendations from memory'));
      return ai({ message: 'I could not verify options. What cuisine sounds good?', sourceIndices: [] });
    };
    const result = await runChat(input, { ...config, exaKey }, undefined, mock);
    assert.equal(result.researchStatus, 'unavailable');
    assert.deepEqual(result.sources, []);
  }
});
test('provider failures remain failures instead of sample chat', async () => {
  await assert.rejects(runChat(input, config, undefined, async () => Response.json({ error: 'private key details' }, { status: 401 })), error => error.message === 'PROVIDER_CONFIG');
  await assert.rejects(runChat(input, config, AbortSignal.abort(), async () => { throw new Error('should not fetch'); }), error => error.name === 'AbortError');
});
test('Google uses configured model and validates provider output', async () => {
  let calls = 0;
  const mock = async (url, options) => {
    assert.ok(url.includes('/models/custom-google:generateContent'));
    assert.equal(options.headers['x-goog-api-key'], 'google-secret');
    calls++;
    return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(calls === 1 ? { searchQuery: null, needsLocation: false } : { message: 'Tell me a little more.', sourceIndices: [] }) }] } }] });
  };
  assert.equal((await runChat(input, { key: 'google-secret', provider: 'google', model: 'custom-google' }, undefined, mock)).message, 'Tell me a little more.');
});
test('saved conversation validates messages and rejects unsafe source URLs', () => {
  const saved = { id: 'chat-1', question: input.question, kind: 'reflection', saved: false, message: 'Where should we look?', mode: 'live', researchStatus: 'off', sources: [] };
  assert.equal(decisionSchema.parse(saved).message, saved.message);
  assert.equal(decisionSchema.safeParse({ ...saved, sources: [{ title: 'bad', url: 'javascript:alert(1)', highlights: [] }] }).success, false);
});
test('selected source numbering matches displayed cards, unknown citations and indices are discarded', async () => {
  let calls = 0;
  const mock = async (url) => {
    if (url === 'https://api.exa.ai/search') return Response.json({ results: [0, 1, 2].map(index => ({ title: `Menu ${index}`, url: `https://restaurant.example/${index}`, highlights: ['Dinner menu'] })) });
    calls++;
    return ai(calls === 1 ? { searchQuery: 'Oakland dinner', needsLocation: false } : { message: 'A vegetarian dinner option [3]. Unknown [6].', sourceIndices: [2, 5], evidence: [{ claim: 'dinner option', quote: 'Dinner menu', sourceIndex: 2 }] });
  };
  const result = await runChat(input, config, undefined, mock);
  assert.equal(result.message, 'A vegetarian dinner option [1]. Unknown .');
  assert.deepEqual(result.sources.map(source => source.url), ['https://restaurant.example/2']);
});
test('invented provider source links are rejected', async () => {
  let calls = 0;
  await assert.rejects(runChat(input, config, undefined, async () => {
    calls++;
    return ai(calls === 1 ? { searchQuery: null, needsLocation: false } : { message: 'Try https://invented.example', sourceIndices: [] });
  }), error => error.message === 'INVALID_RESPONSE');
});
test('chat context uses supplied timezone date and zero-based model citations normalize to visible source numbers', async () => {
  let calls = 0;
  const timezone = 'America/Los_Angeles';
  const mock = async (url, options) => {
    if (url === 'https://api.exa.ai/search') return Response.json({ results: [0, 1].map(index => ({ title: `Menu ${index}`, url: `https://restaurant.example/${index}`, highlights: ['Dinner menu'] })) });
    calls++;
    const body = JSON.parse(options.body);
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.timezone, timezone);
    assert.match(context.currentDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.match(context.currentTime, /P[SD]T/);
    if (calls === 2) {
      assert.ok(body.messages[0].content.includes('Exclude candidates whose sources indicate they are closed'));
      assert.ok(body.messages[0].content.includes('old review'));
    }
    return ai(calls === 1 ? { searchQuery: 'Oakland dinner tonight', needsLocation: false } : { message: 'Candidates with unverified prices [0] [1].', sourceIndices: [0, 1], evidence: [0, 1].map(sourceIndex => ({ claim: 'Candidates', quote: 'Dinner menu', sourceIndex })) });
  };
  const result = await runChat({ ...input, timezone }, config, undefined, mock);
  assert.equal(result.message, 'Candidates with unverified prices [1] [2].');
});
test('independent factual audit replaces fabricated draft prices and availability', async () => {
  let calls = 0;
  const mock = async (url, options) => {
    if (url === 'https://api.exa.ai/search') return Response.json({ results: [{ title: 'Official venue', url: 'https://restaurant.example/menu', highlights: ['Vegetarian choices. Closed Sundays.'] }, { title: 'Synthesized listing', url: 'https://exa.ai/library/places/restaurants/example', highlights: ['$11 to $18. Open tonight.'] }] });
    calls++;
    if (calls === 1) return ai({ searchQuery: 'Oakland dinner', needsLocation: false });
    if (calls === 2) return ai({ message: 'Verified open tonight, dinner costs $11–$18 [1].', sourceIndices: [0] });
    const body = JSON.parse(options.body);
    const context = JSON.parse(body.messages[1].content);
    assert.equal(context.sources.length, 1);
    assert.match(context.draft.message, /\$11/);
    assert.match(body.messages[0].content, /independent factual verifier/);
    return ai({ message: 'I could not verify a dinner option for tonight. What other neighborhood works?', sourceIndices: [], evidence: [] });
  };
  const result = await runChat(input, config, undefined, mock);
  assert.equal(calls, 3);
  assert.ok(!result.message.includes('$11'));
  assert.ok(!result.message.includes('Verified'));
  assert.deepEqual(result.sources, []);
});
test('audit invalid quote, invented price, and unsupported open confirmation fail rather than serving draft', async () => {
  for (const audited of [
    { message: 'Dinner costs $11.', sourceIndices: [0], evidence: [] },
    { message: 'Verified open tonight.', sourceIndices: [0], evidence: [] },
    { message: 'Vegetarian options.', sourceIndices: [0], evidence: [{ claim: 'Vegetarian options.', quote: 'invented evidence', sourceIndex: 0 }] },
  ]) {
    let calls = 0;
    const mock = async url => {
      if (url === 'https://api.exa.ai/search') return Response.json({ results: [{ title: 'Menu', url: 'https://restaurant.example/menu', highlights: ['Vegetarian choices.'] }] });
      calls++;
      return ai(calls === 1 ? { searchQuery: 'Oakland dinner', needsLocation: false } : calls === 2 ? { message: 'Invented draft $15', sourceIndices: [0] } : audited);
    };
    await assert.rejects(runChat(input, config, undefined, mock), error => error.message === 'GROUNDING_FAILED');
    assert.equal(calls, 3);
  }
});
test('audit allows honest availability uncertainty and user budget references but not assistant invented prices', async () => {
  let calls = 0;
  const mock = async url => {
    if (url === 'https://api.exa.ai/search') return Response.json({ results: [{ title: 'Menu', url: 'https://restaurant.example/menu', highlights: ['Vegetarian choices.'] }] });
    calls++;
    return ai(calls === 1 ? { searchQuery: 'Oakland dinner', needsLocation: false } : calls === 2 ? { message: 'Verified open tonight, $11.', sourceIndices: [0] } : { message: "I cannot verify they are open tonight or fit your $40 budget. What other neighborhood works?", sourceIndices: [], evidence: [] });
  };
  const result = await runChat(input, config, undefined, mock);
  assert.match(result.message, /cannot verify/);
  assert.match(result.message, /\$40 budget/);
});
test('configured Google provider independently audits generic-provider drafts', async () => {
  const settings = chatConfig({ AI_API_KEY: 'generic', AI_MODEL: 'generic-model', GOOGLE_API_KEY: 'auditor', GOOGLE_MODEL: 'audit-model', EXA_API_KEY: 'exa' }, {});
  assert.equal(settings.key, 'generic');
  assert.equal(settings.auditKey, 'auditor');
  let draftCalls = 0;
  let audited = false;
  const mock = async (url, options) => {
    if (url === 'https://api.exa.ai/search') return Response.json({ results: [{ title: 'Venue', url: 'https://restaurant.example', highlights: ['Vegetarian choices.'] }] });
    if (url.includes('generativelanguage.googleapis.com')) {
      audited = true;
      assert.equal(options.headers['x-goog-api-key'], 'auditor');
      assert.ok(url.includes('/models/audit-model:generateContent'));
      const data = JSON.parse(options.body);
      assert.match(data.systemInstruction.parts[0].text, /independent factual verifier/);
      return Response.json({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify({ message: 'Vegetarian choices [1]. Opening hours and prices are unverified.', sourceIndices: [0], evidence: [{ claim: 'Vegetarian choices', quote: 'Vegetarian choices.', sourceIndex: 0 }] }) }] } }] });
    }
    draftCalls++;
    assert.equal(options.headers.Authorization, 'Bearer generic');
    return ai(draftCalls === 1 ? { searchQuery: 'Oakland dinner', needsLocation: false } : { message: 'Invented draft $11', sourceIndices: [0] });
  };
  const result = await runChat(input, settings, undefined, mock);
  assert.equal(draftCalls, 2);
  assert.equal(audited, true);
  assert.ok(!result.message.includes('$11'));
});
test('fenced provider JSON is accepted and malformed JSON retries the same task once', async () => {
  let calls = 0;
  const result = await runChat({ ...input, question: 'Hello' }, config, undefined, async () => {
    calls++;
    return Response.json({ choices: [{ message: { content: calls === 1 ? '{broken' : calls === 2 ? '```json\n{"searchQuery":null,"needsLocation":false}\n```' : '{"message":"Hello!","sourceIndices":[]}' } }] });
  });
  assert.equal(calls, 3);
  assert.equal(result.message, 'Hello!');
});
test('invitation commands without an agent backend disclose non-delivery and never call the model', async () => {
  const result = await runChat({ ...input, question: 'invite Maya for dinner' }, config, undefined, async () => { throw new Error('Must not call AI'); });
  assert.match(result.message, /No message was sent/);
});
test('persistent malformed provider output stops after one retry', async () => {
  let calls = 0;
  await assert.rejects(runChat(input, config, undefined, async () => { calls++; return Response.json({ choices: [{ message: { content: 'bad JSON' } }] }); }), error => error.message === 'INVALID_RESPONSE');
  assert.equal(calls, 2);
});
