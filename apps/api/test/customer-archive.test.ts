import assert from 'node:assert/strict';
import { test } from 'node:test';
import { archiveCustomer } from '../src/services/deletions.js';
import { customerSearchWhere, customerWrite } from '../src/services/catalog.js';
import type { Tx } from '../src/repositories/orders.js';

const owner = { id: 'owner', role: 'OWNER' as const };
test('archive preserves customer and orders, audits, reserves phone and enforces owner', async () => {
  const customer = { id: 'c', archivedAt: null as Date | null, whatsapp: '+628123456789' };
  const orders = [{ id: 'order', customerId: 'c' }];
  const audits: unknown[] = [];
  const tx = { $queryRaw: async () => [], customer: {
    findUnique: async () => customer,
    findFirst: async () => ({ id: customer.id }),
    update: async ({ data }: { data: { archivedAt: Date } }) => { customer.archivedAt = data.archivedAt; return customer; },
  }, auditLog: { create: async ({ data }: { data: unknown }) => { audits.push(data); } } } as unknown as Tx;
  await assert.rejects(archiveCustomer(tx, 'c', { confirmed: true }, { id: 'admin', role: 'ADMIN' }), { code: 'FORBIDDEN' });
  assert.deepEqual(await archiveCustomer(tx, 'c', { confirmed: true }, owner), { id: 'c', archived: true });
  assert.ok(customer.archivedAt instanceof Date);
  assert.deepEqual(orders, [{ id: 'order', customerId: 'c' }]);
  assert.equal(audits.length, 1);
  assert.deepEqual(customerSearchWhere(undefined), { archivedAt: null });
  await assert.rejects(customerWrite(tx, { whatsapp: customer.whatsapp }, owner), { code: 'CUSTOMER_PHONE_DUPLICATE' });
  await assert.rejects(archiveCustomer(tx, 'c', { confirmed: true }, owner), { code: 'ARCHIVED' });
});
