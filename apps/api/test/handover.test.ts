import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handoverInput, handoverPreference, preferenceInput } from '../src/services/handover.js';

test('handover validates methods, location and customer-visible note', () => {
  for (const method of ['STORE', 'PICKUP', 'MEETUP', 'COURIER']) {
    assert.equal(handoverInput.safeParse({ method, location: method === 'STORE' ? '' : ' Jakarta ', note: ' note ' }).success, true);
    if (method !== 'STORE') assert.equal(handoverInput.safeParse({ method, location: '  ', note: '' }).success, false);
  }
  assert.deepEqual(handoverInput.parse({ method: 'COURIER', location: ' Jakarta ', note: ' note ' }), { method: 'COURIER', location: 'Jakarta', note: 'note' });
  assert.equal(handoverInput.safeParse({ method: 'OTHER', location: 'x', note: '' }).success, false);
  assert.equal(handoverInput.safeParse({ method: 'STORE', location: '', note: '', extra: true }).success, false);
  assert.equal(handoverInput.safeParse({ method: 'STORE', location: '', note: 'x'.repeat(4001) }).success, false);
});

test('preference excludes appointment note and clears store location', () => {
  assert.deepEqual(handoverPreference(handoverInput.parse({ method: 'MEETUP', location: ' Jakarta ', note: 'tomorrow at 3' })), { preferredHandoverMethod: 'MEETUP', preferredHandoverLocation: 'Jakarta' });
  assert.deepEqual(handoverPreference(handoverInput.parse({ method: 'STORE', location: 'old location', note: 'tomorrow' })), { preferredHandoverMethod: 'STORE', preferredHandoverLocation: null });
});

test('customer preference validation requires location and excludes notes', () => {
  assert.deepEqual(preferenceInput.parse({ method: 'PICKUP', location: ' Jakarta ' }), { method: 'PICKUP', location: 'Jakarta' });
  assert.equal(preferenceInput.safeParse({ method: 'COURIER', location: ' ' }).success, false);
  assert.equal(preferenceInput.safeParse({ method: 'STORE', location: '', note: 'private' }).success, false);
  assert.equal(preferenceInput.safeParse({ method: 'INVALID', location: '' }).success, false);
  assert.equal(preferenceInput.safeParse({ method: 'STORE', location: 'x'.repeat(4001) }).success, false);
});
