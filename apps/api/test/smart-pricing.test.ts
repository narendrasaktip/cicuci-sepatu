import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { calculatePricing, initialPricing, packageTotal } from '../src/services/pricing.js';
import type { Tx } from '../src/repositories/orders.js';

test('package table: integer IDR, all boundaries, deterministic allocation, no tier splitting', () => {
  const counts = [0, 1, 2, 3, 4, 5, 6, 9, 10, 11];
  for (const [mode, expected] of [['PROMO', [0, 45000, 90000, 130000, 175000, 210000, 246000, 369000, 400000, 440000]], ['NORMAL', [0, 50000, 100000, 145000, 195000, 225000, 270000, 405000, 430000, 473000]]] as const) {
    counts.forEach((n, index) => {
      assert.equal(packageTotal(n, mode), expected[index]);
      const items = Array.from({ length: n }, (_, i) => ({ id: String(i), outcome: 'APPROVED', status: 'QUEUED' }));
      const priced = calculatePricing(initialPricing(mode, 'service', n), items);
      assert.equal(Object.values(priced.allocations).reduce((a, b) => a + b, 0), expected[index]);
      assert.ok(Object.values(priced.allocations).every(Number.isInteger));
      assert.deepEqual(calculatePricing(initialPricing(mode, 'service', n), items.reverse()), priced);
    });
  }
  for (const n of [-1, 1.5, 51, NaN]) assert.throws(() => packageTotal(n, 'PROMO'));
});

test('smart workflow boundaries: estimate, pending risk, 5 to 4/3, explicit lock/retry, frozen prices, refund due, legacy; no DB/WhatsApp', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://example.test';
  const hooks = registerHooks({ resolve(s, context, next) {
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db={};', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, context);
  } });
  try {
    const { confirmPricing, reprice, transition, getOrder, inspect, addItem, finances } = await import('../src/services/orders.js');
    const actor = { id: 'owner', role: 'OWNER' as const };
    const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), orderId: 'order', serviceId: 'service', status: 'RECEIVED', outcome: null as string | null, quotedPriceIdr: 42000, finalPriceIdr: 0, photos: [{ kind: 'BEFORE', customerVisible: true }], consents: [] as { decision: string }[], inspection: null as object | null }));
    const order = { id: 'order', pricing: initialPricing('PROMO', 'service', 5) as object | null, items, payments: [{ kind: 'PAYMENT', amountIdr: 210000 }], customer: { notificationConsentAt: null, whatsapp: '+620000000' } };
    const audits: { action: string }[] = [];
    const fake = {
      $queryRaw: async () => [{ id: order.id }],
      order: { findUnique: async () => order, findUniqueOrThrow: async () => order, update: async ({ data }: { data: object }) => Object.assign(order, data) },
      orderItem: {
        findMany: async () => items,
        findUnique: async ({ where }: { where: { id: string } }) => { const item = items.find(i => i.id === where.id); return item ? { ...item, order } : null; },
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(items.find(i => i.id === where.id)!, data),
      },
      inspection: { create: async ({ data }: { data: { itemId: string } }) => { items.find(i => i.id === data.itemId)!.inspection = data; } },
      auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data); } },
      statusHistory: { create: async () => ({ id: 'history' }) },
      storeSettings: { findUnique: async () => null },
      notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event' }) },
    };
    const tx = fake as unknown as Tx;
    assert.equal((await getOrder(tx, 'order')).totalIdr, 210000);
    await assert.rejects(confirmPricing(tx, 'order', 210000, actor.id), /PRICE_NOT_FINAL/);
    await assert.rejects(inspect(tx, '0', { outcome: 'APPROVED', notes: '', risk: '', quotedPriceIdr: 1 }, actor), /SMART_PRICE_AUTOMATIC/);
    await inspect(tx, '0', { outcome: 'APPROVED', notes: 'safe', risk: '' }, actor);
    await transition(tx, '0', { toStatus: 'WASHING', reason: '' }, actor);
    assert.equal(items[0]!.status, 'WASHING');
    assert.equal(items[1]!.status, 'RECEIVED');
    await transition(tx, '0', { toStatus: 'DRYING', reason: '' }, actor);
    await transition(tx, '0', { toStatus: 'PACKING', reason: '' }, actor);
    items[0]!.photos.push({ kind: 'AFTER', customerVisible: true });
    await transition(tx, '0', { toStatus: 'READY_FOR_PICKUP', reason: '', qcPassed: true, dryConfirmed: true, finishingConfirmed: true }, actor);
    await assert.rejects(transition(tx, '0', { toStatus: 'HANDED_OVER', reason: '' }, actor), /PRICE_NOT_FINAL/);
    items[0]!.status = 'QUEUED'; items[0]!.finalPriceIdr = 0;
    items.forEach(i => { i.outcome = 'APPROVED'; i.status = 'QUEUED'; });
    items[4]!.outcome = 'REJECTED'; items[4]!.status = 'RETURN_PENDING';
    await reprice(tx, 'order'); assert.equal((await getOrder(tx, 'order')).totalIdr, 175000);
    items[3]!.outcome = 'NEEDS_CONSENT'; items[3]!.status = 'AWAITING_CONSENT';
    await reprice(tx, 'order'); await assert.rejects(confirmPricing(tx, 'order', 175000, actor.id), /PRICE_NOT_FINAL/);
    items[3]!.outcome = 'DECLINED'; items[3]!.status = 'RETURN_PENDING';
    await reprice(tx, 'order'); assert.equal((await getOrder(tx, 'order')).totalIdr, 130000);
    await assert.rejects(confirmPricing(tx, 'order', 175000, actor.id), /PRICE_CHANGED/);
    await confirmPricing(tx, 'order', 130000, actor.id);
    const locked = structuredClone(order.pricing);
    await confirmPricing(tx, 'order', 130000, actor.id); assert.deepEqual(order.pricing, locked);
    assert.equal(audits.filter(a => a.action === 'PRICING_CONFIRMED').length, 1);
    await assert.rejects(addItem(tx, 'order', { serviceId: 'service', brand: '', model: '', color: '', initialNotes: '' }, actor), /PRICING_LOCKED/);
    const before = items[1]!.finalPriceIdr;
    items[0]!.outcome = 'DECLINED'; items[0]!.status = 'RETURN_PENDING';
    await reprice(tx, 'order'); assert.equal(items[0]!.finalPriceIdr, 0); assert.equal(items[1]!.finalPriceIdr, before);
    const current = await getOrder(tx, 'order'); assert.equal(current.refundDueIdr, 210000 - current.totalIdr);
    assert.deepEqual(order.payments, [{ kind: 'PAYMENT', amountIdr: 210000 }]);
    await reprice(tx, 'order'); assert.equal((await getOrder(tx, 'order')).totalIdr, current.totalIdr);
    order.pricing = null; const legacy = structuredClone(items); await reprice(tx, 'order'); assert.deepEqual(items, legacy);
    assert.equal((await getOrder(tx, 'order')).totalIdr, finances(items, order.payments).totalIdr);
    assert.equal(finances([{ finalPriceIdr: 0 }], order.payments).refundDueIdr, 210000);
  } finally { hooks.deregister(); }
});
