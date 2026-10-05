import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveNookIdentity, identityHeaders } from '../lib/nook-identity.ts';

test('public visitors receive unique secure identities without signing in and keep them across routes', () => {
  const a = resolveNookIdentity(new Request('https://nook.example/api/chat'));
  const b = resolveNookIdentity(new Request('https://nook.example/api/chat'));
  assert.notEqual(a.userId, b.userId);
  assert.match(a.userId, /^visitor:[a-f0-9]{64}$/);
  assert.match(a.cookie, /^__Host-nook-visitor=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=31536000; Secure$/);
  const headers = identityHeaders(a, { 'Cache-Control': 'no-store' });
  assert.equal(headers.get('set-cookie'), a.cookie);
  assert.equal(headers.get('cache-control'), 'no-store');
  const cookie = a.cookie.split(';')[0];
  for (const path of ['/api/chat', '/api/council', '/api/connections']) {
    const restored = resolveNookIdentity(new Request(`https://nook.example${path}`, { headers: { cookie: `other=1; ${cookie}` } }));
    assert.equal(restored.userId, a.userId);
    assert.equal(restored.cookie, undefined);
  }
});
test('authenticated identities retain their existing Twins and guest cookies cannot select an account', () => {
  const request = new Request('https://nook.example', { headers: { cookie: `__Host-nook-visitor=${'a'.repeat(64)}`, 'x-user-id': 'someone-else' } });
  assert.deepEqual(resolveNookIdentity(request, 'verified-account'), { userId: 'verified-account' });
  assert.equal(resolveNookIdentity(request).userId, `visitor:${'a'.repeat(64)}`);
  assert.equal(identityHeaders({ userId: 'verified-account' }, {}).get('set-cookie'), null);
});
test('invalid cookies are replaced and loopback visitors also stay separate', () => {
  for (const cookie of ['__Host-nook-visitor=shared', '__Host-nook-visitor=%0D%0Aevil', `nook-visitor=${'a'.repeat(64)}`]) {
    assert.ok(resolveNookIdentity(new Request('https://nook.example', { headers: { cookie } })).cookie);
  }
  const a = resolveNookIdentity(new Request('http://127.0.0.1:5173/api/chat'));
  const b = resolveNookIdentity(new Request('http://127.0.0.1:5173/api/chat'));
  assert.notEqual(a.userId, b.userId);
  assert.match(a.cookie, /^nook-visitor=/);
  assert.doesNotMatch(a.cookie, /; Secure/);
  assert.equal(resolveNookIdentity(new Request('http://127.0.0.1:5173/api/connections', { headers: { cookie: a.cookie.split(';')[0] } })).userId, a.userId);
});
