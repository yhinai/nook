import test from 'node:test';
import assert from 'node:assert/strict';
import { runBackendCouncil } from '../lib/nook-backend.ts';
const input = { question: 'How do I balance learning and friends?', profile: { name: 'Test', priority: 'Make time for people.', values: ['Friends'], weekend: true } };
const settings = { url: 'https://nook.example', registrationKey: 'registration-secret' };
const result = { opinions: Array.from({ length: 3 }, () => ({ title: 'Tradeoff', opinion: 'Clarify the schedule.', stance: 'Ask first' })), recommendation: 'Try a small step.', critique: 'Timing is unknown.', mode: 'live' };
test('backend adapter isolates identities, forwards context and keeps credentials off the result', async () => {
  let registrations = 0;
  const seen = [];
  const mock = async (url, options) => {
    if (url.pathname === '/v1/users/session') { registrations++; assert.equal(options.headers['X-Nook-Registration-Key'], settings.registrationKey); return Response.json({ token: `private-${registrations}` }); }
    assert.equal(url.pathname, '/v1/reflections');
    assert.equal(options.headers['X-Nook-Registration-Key'], undefined);
    seen.push(options.headers.Authorization);
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(result);
  };
  const signal = new AbortController().signal;
  assert.deepEqual(await runBackendCouncil(input, 'bridge-a', settings, signal, mock), result);
  await runBackendCouncil(input, 'bridge-a', settings, signal, mock);
  await runBackendCouncil(input, 'bridge-b', settings, signal, mock);
  assert.equal(registrations, 2);
  assert.deepEqual(seen, ['Bearer private-1', 'Bearer private-1', 'Bearer private-2']);
});
test('adapter rejects unencrypted remote targets before sending secrets', async () => {
  let called = false;
  await assert.rejects(runBackendCouncil(input, 'unsafe', { ...settings, url: 'http://remote.example' }, new AbortController().signal, async () => { called = true; }));
  assert.equal(called, false);
});
test('adapter rejects invalid backend results and redacts upstream errors', async () => {
  for (const status of [200, 500]) {
    const mock = async (url) => url.pathname === '/v1/users/session' ? Response.json({ token: 'private' }) : Response.json({ privateDetail: 'must not leak' }, { status });
    await assert.rejects(runBackendCouncil(input, `bad-${status}`, settings, new AbortController().signal, mock), error => !error.message.includes('must not leak'));
  }
});
test('chat adapter uses migrated backend chat endpoint, shares identity and validates grounding', async () => {
  const { runBackendChat } = await import('../lib/nook-backend.ts');
  const chat = { message: 'Which city should I look in?', sources: [], researchStatus: 'off', mode: 'live' };
  let registrations = 0;
  const mock = async (url, options) => {
    if (url.pathname === '/v1/users/session') { registrations++; return Response.json({ token: 'private-chat' }); }
    assert.equal(url.pathname, '/v1/chat');
    assert.equal(options.headers.Authorization, 'Bearer private-chat');
    assert.deepEqual(JSON.parse(options.body), input);
    return Response.json(chat);
  };
  assert.deepEqual(await runBackendChat(input, 'bridge-chat', settings, new AbortController().signal, mock), chat);
  await runBackendChat(input, 'bridge-chat', settings, new AbortController().signal, mock);
  assert.equal(registrations, 1);
});
