import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.APP_BASE_URL = 'http://localhost:5173';

const rows = Array.from({ length: 205 }, (_, i) => ({
  id: `order-${String(i).padStart(3, '0')}`, number: `CS-${i}`, aggregateStatus: 'READY_FOR_PICKUP',
  archivedAt: null, pricing: null, items: [{ finalPriceIdr: 10000 }],
  payments: i < 200 ? [] : [{ kind: 'PAYMENT', amountIdr: i === 204 ? 12000 : 10000 }],
  customer: { name: 'Fixture' }, estimatedCompletionAt: new Date(),
}));
const fake = {
  session: { findUnique: async () => ({ user: { id: 'owner', role: 'OWNER', isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) }) },
  auditLog: { create: async () => ({}) },
  payment: { findMany: async () => [] },
  order: { findMany: async ({ where, cursor, take }: { where: { aggregateStatus?: string | { not: string } }; cursor?: { id: string }; take?: number }) => {
    const filtered = rows.filter(row => !where.aggregateStatus || (typeof where.aggregateStatus === 'string' ? row.aggregateStatus === where.aggregateStatus : row.aggregateStatus !== where.aggregateStatus.not));
    const start = cursor ? filtered.findIndex(row => row.id === cursor.id) + 1 : 0;
    return filtered.slice(start, take === undefined ? undefined : start + take);
  } },
};
Reflect.set(globalThis, Symbol.for('cicuci.status-filter'), fake);
const hook = registerHooks({ resolve(s, context, next) {
  if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.status-filter")]', shortCircuit: true };
  return next(s, context);
} });
const { app } = await import('../src/app.js');
hook.deregister();

test('order status filters separate payment, pickup and refund before pagination across batches', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const list = async (status: string, cursor = '') => {
    const response = await fetch(`http://127.0.0.1:${address.port}/api/v1/orders?status=${status}&limit=2${cursor ? `&cursor=${cursor}` : ''}`, { headers: { cookie: `cicuci_session=${'a'.repeat(64)}` } });
    assert.equal(response.status, 200);
    return response.json() as Promise<{ data: { id: string; balanceIdr: number }[]; page: { nextCursor: string | null } }>;
  };
  try {
    const dashboard = await fetch(`http://127.0.0.1:${address.port}/api/v1/dashboard`, { headers: { cookie: `cicuci_session=${'a'.repeat(64)}` } });
    assert.equal(dashboard.status, 200);
    const metrics = await dashboard.json();
    assert.equal(metrics.readyForPickup, 4);
    assert.equal(metrics.awaitingPayment, 200);
    assert.equal(metrics.activeOrders, 205);
    assert.equal(metrics.inProgress, 0);
    assert.equal((await list('ACTIVE')).data.length, 2);
    const ready = await list('READY_FOR_PICKUP');
    assert.deepEqual(ready.data.map(row => row.id), ['order-200', 'order-201']);
    assert.ok(ready.data.every(row => row.balanceIdr === 0));
    const next = await list('READY_FOR_PICKUP', ready.page.nextCursor!);
    assert.deepEqual(next.data.map(row => row.id), ['order-202', 'order-203']);
    assert.equal(next.page.nextCursor, null);
    const unpaid = await list('AWAITING_PAYMENT');
    assert.ok(unpaid.data.every(row => row.balanceIdr > 0));
    assert.equal(unpaid.data.length, 2);
    const refunds = await list('REFUND_PENDING');
    assert.deepEqual(refunds.data.map(row => row.id), ['order-204']);
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
