import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

test('inspection pricing: automatic staff provenance, legacy eligibility, frozen evidence, risk and stale guards; isolated model', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s.endsWith('/lib/config.js')) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://example.test"};', shortCircuit: true };
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db={};', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, c);
  } });
  try {
    const { handoverOrder, inspect, transition, reprice, requireVerifiedPricing, ledger } = await import('../src/services/orders.js');
    const { initialPricing, calculatePricing } = await import('../src/services/pricing.js');
    const owner = { id: 'fixture-owner', role: 'OWNER' as const };
    const make = (id: string) => ({ id, orderId: 'order', status: 'RECEIVED', outcome: null as string | null, assignedUserId: null, quotedPriceIdr: 50000, finalPriceIdr: 0, inspection: null as { actorUserId: string } | null, photos: [{ kind: 'BEFORE', customerVisible: true }], consents: [] as { decision: string; consumedAt: Date | null }[] });
    const items = [make('a'), make('b'), make('c')];
    const audits: { action: string; metadata?: unknown }[] = [], histories: object[] = [], events: object[] = [];
    const order = { id: 'order', number: 'CS-FIXTURE', pricing: initialPricing('NORMAL', 'service', 3), customer: { notificationConsentAt: null, whatsapp: '+620000000' }, items, payments: [] as object[] };
    const fake = {
      $queryRaw: async () => [{ id: order.id }],
      order: { findUnique: async () => order, findUniqueOrThrow: async () => order, update: async ({ data }: { data: object }) => Object.assign(order, data) },
      orderItem: {
        findUnique: async ({ where }: { where: { id: string } }) => { const i = items.find(i => i.id === where.id); return i ? { ...i, order } : null; },
        findMany: async () => items,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(items.find(i => i.id === where.id)!, data),
      },
      inspection: { create: async ({ data }: { data: { itemId: string; actorUserId: string } }) => { items.find(i => i.id === data.itemId)!.inspection = data; } },
      auditLog: { create: async ({ data }: { data: typeof audits[number] }) => { audits.push(data); } },
      statusHistory: { create: async ({ data }: { data: object }) => { histories.push(data); return { id: String(histories.length) }; } },
      storeSettings: { findUnique: async () => null },
      notificationEvent: { findUnique: async () => null, upsert: async ({ create }: { create: object }) => { events.push(create); return { id: String(events.length) }; } },
      payment: { create: async ({ data }: { data: object }) => { order.payments.push(data); } },
    };
    const tx = fake as unknown as Tx;
    await reprice(tx, order.id);
    await inspect(tx, 'a', { outcome: 'APPROVED', notes: '', risk: '' }, owner);
    assert.equal(order.pricing.stage, 'ESTIMATE'); assert.equal(items[0]!.finalPriceIdr, 0);
    const frozenPrice = items[0]!.quotedPriceIdr;
    await transition(tx, 'a', { toStatus: 'WASHING', reason: '' }, owner);
    assert.equal(items[0]!.finalPriceIdr, frozenPrice);
    await inspect(tx, 'b', { outcome: 'REJECTED', notes: '', risk: '' }, owner);
    await inspect(tx, 'c', { outcome: 'APPROVED', notes: '', risk: '' }, owner);
    assert.equal(order.pricing.stage, 'FINAL'); assert.equal(order.pricing.pairs, 2); assert.equal(items[0]!.finalPriceIdr, frozenPrice);
    assert.equal(order.pricing.verifiedBy, owner.id); assert.ok(order.pricing.verifiedAt); assert.equal(order.pricing.lockedAt, null);
    assert.equal(order.pricing.agreedTotalIdr, undefined); assert.equal(items[1]!.finalPriceIdr, 0);
    assert.equal(audits.filter(a => a.action === 'PRICING_STAFF_VERIFIED').length, 1);
    assert.equal(audits.some(a => a.action === 'PRICING_CONFIRMED'), false);
    const count = audits.length; await reprice(tx, order.id, owner.id); assert.equal(audits.length, count);
    items[0]!.status = 'QUEUED';
    const automatic = structuredClone(order.pricing);
    for (const role of ['OWNER', 'ADMIN'] as const) {
      // Old FINAL snapshot: eligibility derived, no fabricated approval or backfill.
      delete order.pricing.verifiedAt; delete order.pricing.verifiedBy;
      const old = structuredClone(order.pricing);
      await transition(tx, 'a', { toStatus: 'WASHING', reason: '' }, { id: role, role });
      assert.equal(items[0]!.assignedUserId, null); assert.deepEqual(order.pricing, old);
      await assert.rejects(transition(tx, 'a', { toStatus: 'WASHING', reason: '' }, owner), /INVALID_TRANSITION/);
      items[0]!.status = 'QUEUED';
    }
    await assert.rejects(transition(tx, 'a', { toStatus: 'WASHING', reason: '' }, { id: 'staff', role: 'STAFF' }), /FORBIDDEN/);
    items[0]!.status = 'WASHING';
    for (const patch of [{ status: 'INSPECTION' }, { status: 'AWAITING_CONSENT', outcome: 'NEEDS_CONSENT' }, { inspection: null }]) {
      const original = { ...items[2]! }; Object.assign(items[2]!, patch);
      await assert.rejects(requireVerifiedPricing(tx, order.id), /PRICE_NOT_FINAL/); Object.assign(items[2]!, original);
    }
    items[2]!.outcome = 'NEEDS_CONSENT';
    await assert.rejects(requireVerifiedPricing(tx, order.id), /PRICE_NOT_FINAL/);
    items[2]!.consents.push({ decision: 'APPROVE', consumedAt: null });
    await assert.rejects(requireVerifiedPricing(tx, order.id), /PRICE_NOT_FINAL/);
    items[2]!.consents[0]!.consumedAt = new Date(); await requireVerifiedPricing(tx, order.id);
    items[2]!.outcome = 'APPROVED';
    items[0]!.finalPriceIdr++; await assert.rejects(requireVerifiedPricing(tx, order.id), /PRICE_CHANGED/); items[0]!.finalPriceIdr--;
    order.pricing.totalIdr++; await assert.rejects(requireVerifiedPricing(tx, order.id), /PRICE_CHANGED/); order.pricing.totalIdr--;
    await ledger(tx, order.id, { kind: 'PAYMENT', amountIdr: 50000, method: 'CASH', reason: '', receivedAt: new Date().toISOString() }, owner);
    assert.equal(order.payments.length, 1);
    order.pricing = { ...automatic, stage: 'LOCKED', lockedAt: '2026-01-01T00:00:00Z', agreedTotalIdr: 100000, agreedAllocations: { ...automatic.allocations } };
    const agreement = structuredClone(order.pricing); const payments = structuredClone(order.payments);
    await reprice(tx, order.id, owner.id); assert.deepEqual(order.pricing, agreement);
    items[2]!.outcome = 'DECLINED'; items[2]!.status = 'RETURN_PENDING'; await reprice(tx, order.id, owner.id);
    assert.equal(order.pricing.totalIdr, frozenPrice); assert.equal(items[2]!.finalPriceIdr, 0);
    assert.deepEqual(order.pricing.agreedAllocations, agreement.agreedAllocations); assert.equal(order.pricing.agreedTotalIdr, agreement.agreedTotalIdr); assert.deepEqual(order.payments, payments);
    items[0]!.outcome = 'REJECTED'; items[0]!.status = 'RETURN_PENDING'; await reprice(tx, order.id, owner.id);
    assert.equal(order.pricing.totalIdr, 0); assert.equal(order.pricing.pairs, 0); assert.ok(items.every(i => i.finalPriceIdr === 0));
    const frozen = calculatePricing(automatic, [{ id: 'a', outcome: 'APPROVED', status: 'QUEUED' }, { id: 'b', outcome: 'REJECTED', status: 'RETURN_PENDING' }, { id: 'c', outcome: 'DECLINED', status: 'RETURN_PENDING' }]);
    assert.equal(frozen.totalIdr, 50000); assert.equal(frozen.verifiedAt, automatic.verifiedAt);
    items[2]!.status = 'QUEUED'; await assert.rejects(handoverOrder(tx, order.id, owner), /ORDER_NOT_READY/);
    items[0]!.status = 'READY_FOR_PICKUP'; items[1]!.status = 'RETURN_PENDING'; items[2]!.status = 'READY_FOR_PICKUP'; order.payments.push({ kind: 'PAYMENT', amountIdr: 999999 });
    await handoverOrder(tx, order.id, owner);
    assert.deepEqual(items.map(item => item.status), ['HANDED_OVER', 'RETURNED', 'HANDED_OVER']);
  } finally { hooks.deregister(); }
});
