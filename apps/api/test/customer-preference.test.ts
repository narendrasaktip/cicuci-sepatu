import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerWrite } from '../src/services/catalog.js';
import type { Tx } from '../src/repositories/orders.js';

test('customer preference changes preserve notes and order snapshots; omission and clear differ', async () => {
  const customer = { id: 'c1', archivedAt: null, notes: 'private', preferredHandoverMethod: 'PICKUP' as string | null, preferredHandoverLocation: 'Jakarta' as string | null };
  const order = { handoverMethod: 'PICKUP', handoverLocation: 'Jakarta', handoverNote: 'tomorrow' };
  const tx = { $queryRaw: async () => [], customer: { findUnique: async () => customer, update: async ({ data }: { data: object }) => Object.assign(customer, data) }, auditLog: { create: async () => ({}) } } as unknown as Tx;
  const actor = { id: 'u', role: 'ADMIN' as const };
  await customerWrite(tx, { name: 'Ayu' }, actor, 'c1');
  assert.equal(customer.preferredHandoverLocation, 'Jakarta');
  await customerWrite(tx, { handoverPreference: { method: 'STORE', location: 'ignored' } }, actor, 'c1');
  assert.equal(customer.preferredHandoverMethod, 'STORE'); assert.equal(customer.preferredHandoverLocation, null);
  await customerWrite(tx, { handoverPreference: null }, actor, 'c1');
  assert.equal(customer.preferredHandoverMethod, null); assert.equal(customer.preferredHandoverLocation, null);
  assert.equal(customer.notes, 'private'); assert.deepEqual(order, { handoverMethod: 'PICKUP', handoverLocation: 'Jakarta', handoverNote: 'tomorrow' });
});
