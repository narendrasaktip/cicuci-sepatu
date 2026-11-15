import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deleteCustomer } from '../src/services/deletions.js';
import type { Tx } from '../src/repositories/orders.js';

const owner = { id: 'owner', role: 'OWNER' as const };
const input = { confirmed: true as const, confirmation: 'HAPUS' as const };
type Event = { orderId: string | null; template: string; eventKey: string; status: string; attempts: { status: string; response: unknown }[] };
function fixture(options: { pending?: boolean; ambiguous?: boolean; orders?: string[]; events?: Event[] } = {}) {
  const calls: string[] = [];
  const remove = (name: string) => ({ deleteMany: async () => { calls.push(name); }, delete: async () => { calls.push(name); } });
  const tx = {
    $queryRaw: async () => [],
    customer: { findUnique: async () => ({ id: 'customer', whatsapp: '+628123456789' }), ...remove('customer') },
    order: { findMany: async () => (options.orders ?? ['order']).map(id => ({ id })), findUnique: async () => ({ id: 'order' }), ...remove('order') },
    notificationEvent: { count: async () => options.pending ? 1 : 0, findMany: async () => options.events ?? (options.pending || options.ambiguous ? [{ orderId: null, template: 'LEGACY', eventKey: 'unknown', status: options.pending ? 'PENDING' : 'FAILED', attempts: options.ambiguous ? [{ status: 'FAILED', response: { actualOutbound: 'unknown' } }] : [] }] : []) },
    notificationAttempt: { count: async () => 0, findMany: async () => options.ambiguous ? [{ response: { actualOutbound: 'unknown' } }] : [] },
    photo: remove('photo'), inspection: remove('inspection'), consentDecision: remove('consent'), statusHistory: remove('history'), orderItem: remove('item'),
    auditLog: { create: async ({ data }: { data: { action: string } }) => { calls.push(data.action); } },
  } as unknown as Tx;
  return { tx, calls };
}
test('owner deletes orders first and audits both without touching ledger', async () => {
  const { tx, calls } = fixture();
  assert.deepEqual(await deleteCustomer(tx, 'customer', input, owner), { id: 'customer', deleted: true });
  assert.deepEqual(calls, ['photo', 'inspection', 'consent', 'history', 'item', 'order', 'ORDER_DELETED', 'customer', 'CUSTOMER_DELETED']);
});
test('refuses non-owner, pending or ambiguous sends before deletion', async () => {
  for (const options of [{ pending: true }, { ambiguous: true }]) {
    const { tx, calls } = fixture(options);
    await assert.rejects(deleteCustomer(tx, 'customer', input, owner), /NOTIFICATION_IN_PROGRESS/);
    assert.deepEqual(calls, []);
  }
  const { tx, calls } = fixture();
  await assert.rejects(deleteCustomer(tx, 'customer', input, { id: 'admin', role: 'ADMIN' }), /FORBIDDEN/);
  assert.deepEqual(calls, []);
});

test('same phone does not transfer ownership; unknown ownership remains fenced', async () => {
  const campaign = '12345678-1234-1234-1234-123456789abc';
  const event = (overrides: Partial<Event>): Event => ({ orderId: null, template: 'SERVICE_BROADCAST', eventKey: `broadcast:${campaign}:other`, status: 'PROCESSING', attempts: [], ...overrides });
  for (const other of [event({}), event({ orderId: 'other-order', template: 'ORDER_RECEIVED', eventKey: 'other-event' })]) {
    const { tx, calls } = fixture({ orders: [], events: [other] });
    await deleteCustomer(tx, 'customer', input, owner);
    assert.deepEqual(calls, ['customer', 'CUSTOMER_DELETED']);
  }
  for (const blocked of [
    event({ eventKey: `broadcast:${campaign}:customer` }),
    event({ template: 'LEGACY', eventKey: 'unknown' }),
    event({ eventKey: 'malformed', status: 'FAILED', attempts: [{ status: 'FAILED', response: null }] }),
    event({ eventKey: `broadcast:${campaign}:customer`, status: 'FAILED', attempts: [{ status: 'FAILED', response: { actualOutbound: 'unknown' } }] }),
    event({ eventKey: `broadcast:${campaign}:customer`, status: 'SENT', attempts: [{ status: 'PROCESSING', response: { actualOutbound: false } }] }),
  ]) {
    const { tx, calls } = fixture({ orders: [], events: [blocked] });
    await assert.rejects(deleteCustomer(tx, 'customer', input, owner), /NOTIFICATION_IN_PROGRESS/);
    assert.deepEqual(calls, []);
  }
  const { tx } = fixture({ orders: [], events: [event({ eventKey: `broadcast:${campaign}:customer`, status: 'FAILED', attempts: [{ status: 'FAILED', response: { actualOutbound: false } }] })] });
  await deleteCustomer(tx, 'customer', input, owner);
});
