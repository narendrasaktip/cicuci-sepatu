import assert from 'node:assert/strict';
import { test } from 'node:test';
import { equalToken, hashToken, randomToken, randomTrackingToken, sessionCookie } from '../src/lib/security.js';
import { fakeSend } from './helpers/whatsapp.js';
test('session tokens are random, hashed, isolated from CSRF', () => {
  const token = randomToken();
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.notEqual(token, randomToken());
  assert.notEqual(token, hashToken(token));
  assert.match(randomTrackingToken(), /^[A-Za-z0-9_-]{22}$/);
  assert.equal(equalToken(token, token), true);
  assert.equal(equalToken('', token), false);
  assert.equal(equalToken('é', 'a'), false);
  assert.equal(sessionCookie(`other=1; cicuci_session=${token}; last=2`), token);
  assert.equal(sessionCookie(undefined), undefined);
});
test('test-only sender requires no network', async () => { assert.equal((await fakeSend()).delivery, 'submitted'); });
