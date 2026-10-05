import test from 'node:test';
import assert from 'node:assert/strict';
import { approximateLocation, currentLocation, locationSchema, locationLifetime } from '../lib/location.ts';
import { chatInput, runChat } from '../lib/chat-agent.ts';

test('location rounds device coordinates, expires, and rejects invalid input', () => {
  const location = approximateLocation({ coords: { latitude: 37.804363, longitude: -122.271111 } });
  assert.equal(location.latitude, 37.8);
  assert.equal(location.longitude, -122.27);
  const captured = Date.parse(location.capturedAt);
  assert.deepEqual(currentLocation(location, captured + 1000), location);
  assert.equal(currentLocation(location, captured + locationLifetime), undefined);
  assert.equal(currentLocation(null), undefined);
  assert.equal(currentLocation(location, captured - 1000), undefined);
  for (const invalid of [{ ...location, latitude: 91 }, { ...location, longitude: -181 }, { ...location, capturedAt: 'yesterday' }]) assert.equal(locationSchema.safeParse(invalid).success, false);
  assert.equal(chatInput.safeParse({ question: 'Dinner nearby', profile: { name: 'Alex', priority: 'Friends', values: ['Friends'], weekend: true }, location }).success, true);
});
test('direct agent receives consented coordinates and drops stale location from context', async () => {
  const profile = { name: 'Alex', priority: 'Friends', values: ['Friends'], weekend: true };
  for (const fresh of [true, false]) {
    const location = { latitude: 37.8, longitude: -122.27, capturedAt: new Date(Date.now() - (fresh ? 0 : locationLifetime)).toISOString() };
    let calls = 0;
    await runChat({ question: 'Dinner nearby', profile, location }, { key: 'test', model: 'test' }, undefined, async (_url, options) => {
      const messages = JSON.parse(options.body).messages;
      const context = JSON.parse(messages[1].content);
      assert.deepEqual(context.location, fresh ? location : undefined);
      if (calls === 0) assert.match(messages[0].content, /explicitly requested city or neighborhood always takes precedence/i);
      return Response.json({ choices: [{ message: { content: JSON.stringify(calls++ === 0 ? { searchQuery: null, needsLocation: !fresh } : { message: fresh ? 'What kind of food would you like nearby?' : 'What city should I look in?', sourceIndices: [] }) } }] });
    });
    assert.equal(calls, 2);
  }
});
