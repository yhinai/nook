import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesUserName, searchUsers } from '../lib/user-search.ts';
const users = [
  { id: '1', displayName: 'José Maya', status: 'available' },
  { id: '2', displayName: 'Maya', status: 'connected' },
  { id: '3', displayName: 'Maya Chen', status: 'incoming' },
  { id: '4', displayName: 'Sam', status: 'outgoing' },
];
test('user search handles accents, case, whitespace and multiple words, ranking exact names first', () => {
  assert.equal(matchesUserName('José Maya', '  MAYA   Jose '), true);
  assert.equal(matchesUserName('José Maya', 'Jordan'), false);
  assert.deepEqual(searchUsers(users, 'maya', 'all').map(u => u.id), ['2', '3', '1']);
  assert.deepEqual(searchUsers(users, '', 'connected').map(u => u.id), ['2']);
  assert.deepEqual(searchUsers(users, '', 'requests').map(u => u.id), ['3', '4']);
  assert.deepEqual(searchUsers(users, 'Nobody', 'all'), []);
  assert.equal(users[0].id, '1');
});
