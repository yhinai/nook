import test from 'node:test';
import assert from 'node:assert/strict';
import { chatFailure } from '../lib/chat-errors.ts';
test('chat errors expose safe actionable categories without leaking upstream details', () => {
  assert.match(chatFailure(new Error('PROVIDER_CONFIG')).error, /API key, model/);
  assert.equal(chatFailure(new Error('AGENT_NOT_CONNECTED')).status, 409);
  assert.equal(chatFailure(new Error('RATE_LIMIT')).status, 429);
  assert.equal(chatFailure(new Error('private key details')).code, 'CHAT_FAILED');
  assert.equal(chatFailure(new Error('PROVIDER_ERROR'), true).code, 'TIMEOUT');
});
