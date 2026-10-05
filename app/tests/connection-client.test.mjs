import test from 'node:test';
import assert from 'node:assert/strict';
import { connectionRequest } from '../lib/connection-client.ts';
const profile = { name: 'Alex', priority: 'Friends', values: ['Friends'], weekend: true, about: '' };
test('connection client handles HTML outages and validates delivery before showing success', async () => {
  await assert.rejects(connectionRequest(profile, 'list', {}, undefined, async () => new Response('<html>Gateway error</html>', { status: 502 })), /Could not reach/);
  await assert.rejects(connectionRequest(profile, 'send', {}, undefined, async () => Response.json({ status: 'delivered' })));
});
test('connection client forwards only the explicit message and request ID with cancellation', async () => {
  const requestId = '11111111-1111-4111-8111-111111111111';
  const mock = async (url, options) => {
    assert.equal(url, '/api/connections');
    assert.ok(options.signal);
    assert.deepEqual(JSON.parse(options.body), { profile, action: 'send', connectionId: requestId, requestId, content: 'Friday works!' });
    return Response.json({ id: requestId, status: 'delivered' });
  };
  assert.equal((await connectionRequest(profile, 'send', { connectionId: requestId, requestId, content: 'Friday works!' }, undefined, mock)).status, 'delivered');
});
