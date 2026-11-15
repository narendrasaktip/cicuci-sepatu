import assert from 'node:assert/strict';
import { test } from 'node:test';
import { customerWrite } from '../src/services/catalog.js';
import type { Tx } from '../src/repositories/orders.js';

const actor = { id: 'u', role: 'ADMIN' as const };
test('customer duplicate precheck excludes self and concurrent unique violation fails closed', async () => {
  let duplicate = true; let race = false;
  const tx = { $queryRaw: async () => [], customer: {
    findUnique: async () => ({ id: 'c1', archivedAt: null }),
    findFirst: async ({ where }: { where: { id?: { not: string } } }) => duplicate && where.id?.not !== 'c1' ? { id: 'c1' } : null,
    create: async () => { if (race) throw { code: 'P2002' }; return { id: 'c2' }; },
    update: async () => ({ id: 'c1' }),
  }, auditLog: { create: async () => ({}) } } as unknown as Tx;
  const input = { whatsapp: '+628123456789' };
  await assert.rejects(customerWrite(tx, input, actor), { code: 'CUSTOMER_PHONE_DUPLICATE' });
  await customerWrite(tx, input, actor, 'c1');
  duplicate = false; race = true;
  await assert.rejects(customerWrite(tx, input, actor), { code: 'CUSTOMER_PHONE_DUPLICATE' });
});
