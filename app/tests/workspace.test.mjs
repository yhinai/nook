import test from 'node:test';
import assert from 'node:assert/strict';
import { workspaceSchema } from '../lib/workspace.ts';
import { createRequestBudget } from '../lib/request-budget.ts';
const profile = { name: 'Test', priority: 'Learning', values: ['Learning'], weekend: true };
const decision = { id: 'one', question: 'A choice', kind: 'reflection', saved: true };
test('corrupt persisted opinions and profile snapshots are rejected before rendering', () => {
  const workspace = { profile, decisions: [decision], plans: {}, friends: [] };
  assert.equal(workspaceSchema.safeParse(workspace).success, true);
  for (const malformed of [{ opinions: {} }, { opinions: [{ title: 'One', opinion: 'One', stance: 'One' }] }, { profileSnapshot: { ...profile, values: null } }]) assert.equal(workspaceSchema.safeParse({ ...workspace, decisions: [{ ...decision, ...malformed }] }).success, false);
});
test('per-user budget blocks concurrent and excessive requests, then resets', () => {
  const acquire = createRequestBudget(2, 1000);
  const first = acquire('one', 1); assert.equal(typeof first, 'function'); assert.equal(acquire('one', 2), null);
  first(); const second = acquire('one', 3); assert.equal(typeof second, 'function'); second(); second();
  assert.equal(acquire('one', 4), null); assert.equal(typeof acquire('two', 4), 'function'); assert.equal(typeof acquire('one', 1002), 'function');
});

test('older workspaces retain their data and require onboarding', () => {
  const saved = workspaceSchema.parse({ profile, decisions: [decision] });
  assert.equal(saved.onboardingCompleted, false);
  assert.equal(saved.profile.name, 'Test');
  assert.deepEqual(saved.profile.social, { linkedin: '', instagram: '', website: '' });
  assert.equal(saved.decisions.length, 1);
});
test('completed onboarding and optional personal details survive persistence', () => {
  const data = { profile: { ...profile, about: 'Designer who loves hiking', social: { linkedin: 'https://www.linkedin.com/in/test', instagram: 'https://instagram.com/test', website: 'https://example.com' } }, onboardingCompleted: true, decisions: [] };
  const saved = workspaceSchema.parse(JSON.parse(JSON.stringify(data)));
  assert.equal(saved.onboardingCompleted, true);
  assert.equal(saved.profile.about, data.profile.about);
  assert.deepEqual(saved.profile.social, data.profile.social);
});
test('profile links reject unsafe URLs and incorrect social domains', () => {
  for (const social of [{ website: 'javascript:alert(1)' }, { linkedin: 'https://linkedin.com.evil.test/me' }, { instagram: 'https://example.com/me' }, { website: 'https://user:password@example.com' }]) {
    assert.equal(workspaceSchema.safeParse({ profile: { ...profile, social }, decisions: [] }).success, false);
  }
});
