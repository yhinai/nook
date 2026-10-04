import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveAIConfig, normalizeAIBaseUrl, aiProviderLabel } from '../lib/ai-config.ts';

test('generic AI configuration selects an OpenAI-compatible endpoint and model', () => {
  const config = resolveAIConfig({ AI_API_KEY: 'example-key', AI_BASE_URL: 'https://openrouter.ai/api/v1/', AI_MODEL: 'openai/gpt-4.1-mini', GOOGLE_API_KEY: 'other-key', OPENAI_API_KEY: 'legacy-key' }, {});
  assert.deepEqual(config, { provider: 'openai', key: 'example-key', model: 'openai/gpt-4.1-mini', baseUrl: 'https://openrouter.ai/api/v1' });
  assert.equal(aiProviderLabel(config), 'OpenRouter');
});

test('worker bindings take precedence over local env and empty bindings fall back', () => {
  const config = resolveAIConfig({ AI_API_KEY: 'worker-key', AI_MODEL: 'worker-model', AI_BASE_URL: '' }, { AI_API_KEY: 'local-key', AI_MODEL: 'local-model', AI_BASE_URL: 'https://example.com/v1' });
  assert.equal(config.key, 'worker-key');
  assert.equal(config.model, 'worker-model');
  assert.equal(config.baseUrl, 'https://example.com/v1');
});

test('legacy OpenAI defaults and existing Google preference are retained', () => {
  assert.deepEqual(resolveAIConfig({ OPENAI_API_KEY: 'legacy-key' }, {}), { provider: 'openai', key: 'legacy-key', model: 'gpt-4.1-mini', baseUrl: 'https://api.openai.com/v1' });
  assert.deepEqual(resolveAIConfig({ GOOGLE_API_KEY: 'google-key', OPENAI_API_KEY: 'legacy-key' }, {}), { provider: 'google', key: 'google-key', model: 'gemini-2.5-flash' });
  assert.equal(resolveAIConfig({}, {}).key, '');
  assert.equal(resolveAIConfig({ AI_API_KEY: 'generic-key' }, {}).baseUrl, 'https://api.openai.com/v1');
});

test('AI base URLs reject insecure URLs, embedded credentials, query strings and fragments', () => {
  for (const value of ['http://example.com/v1', 'file:///tmp/api', 'invalid-url', 'https://username:password@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) {
    assert.throws(() => normalizeAIBaseUrl(value), { message: 'PROVIDER_CONFIG' });
  }
  assert.equal(normalizeAIBaseUrl('https://example.com/v1///'), 'https://example.com/v1');
});
