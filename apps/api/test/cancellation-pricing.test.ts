import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

// Hooks installed before importing any service/controller: no configuration, DB or WhatsApp access.
test('new cancellation reprices snapshot rules; historic reads, evidence, payments remain intact', async () => {
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s.endsWith('/lib/config.js')) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://example.test"};', shortCircuit: true };
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db={};', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, c);
  } });
  try {
    const { calculatePricing, initialPricing, planPricing, publicPricing, pricingSnapshot } = await import('../src/services/pricing.js');
    const { defaultRules, previewPricing } = await import('../src/services/rate-rules.js');
    const { reprice, change, decide, inspect, requireVerifiedPricing, getOrder } = await import('../src/services/orders.js');
    for (const mode of ['NORMAL', 'PROMO'] as const) for (const version of [1, 2]) for (const count of [3, 4, 6]) for (const stage of ['FINAL', 'LOCKED'] as const) {
      const items = Array.from({ length: count }, (_, n) => ({ id: `shoe${n}`, orderId: 'order', status: 'QUEUED' as const, outcome: 'APPROVED' as string | null, inspection: { actorUserId: 'staff' }, photos: [{ kind: 'BEFORE' }], consents: [], quotedPriceIdr: 0, finalPriceIdr: 0 }));
      const initial = version === 1 ? initialPricing(mode, 'service', count) : planPricing({ id: 'plan', name: mode, revision: 4, rules: defaultRules(mode) }, 'service', count);
      const final = calculatePricing(initial, items);
      const pricing = { ...final, stage, verifiedAt: '2026-01-01T00:00:00Z', verifiedBy: 'private-staff', ...(stage === 'LOCKED' ? { lockedAt: '2026-01-02T00:00:00Z', agreedTotalIdr: final.totalIdr, agreedAllocations: { ...final.allocations } } : {}) };
      items.forEach(i => { i.quotedPriceIdr = i.finalPriceIdr = pricing.allocations[i.id]!; });
      const payments = [{ kind: 'PAYMENT', amountIdr: final.totalIdr }, { kind: 'REFUND', amountIdr: 1 }];
      const order = { id: 'order', number: 'FIXTURE', pricing: pricingSnapshot.parse(pricing), items, payments, customer: { notificationConsentAt: null }, trackingHash: null };
      const saved = structuredClone(order.pricing), ledger = structuredClone(payments);
      const audits: { action: string }[] = [];
      const fake = {
        $queryRaw: async () => [{ id: 'order' }],
        order: { findUnique: async () => order, findUniqueOrThrow: async () => order, update: async ({ data }: { data: object }) => Object.assign(order, data) },
        orderItem: { findMany: async () => items, findUnique: async ({ where }: { where: { id: string } }) => ({ ...items.find(i => i.id === where.id)!, order }), update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(items.find(i => i.id === where.id)!, data) },
        inspection: { create: async () => ({}) },
        statusHistory: { create: async () => ({ id: 'history' }) },
        auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data); } },
        storeSettings: { findUnique: async () => null },
        notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event' }) },
        consentDecision: { findFirst: async () => ({ id: 'consent', itemId: items[0]!.id, item: items[0], consumedAt: null, expiresAt: new Date('2099-01-01'), quotedPriceIdr: 999 }), update: async () => ({}) },
      };
      const tx = fake as unknown as Tx;
      await reprice(tx, 'order'); assert.deepEqual(order.pricing, saved); // no historical backfill
      // Today's plan could differ; no ratePlan repository exists in fake. Only saved rules can work.
      if (count === 3) {
        items[0]!.status = 'AWAITING_CONSENT' as 'QUEUED'; items[0]!.outcome = 'NEEDS_CONSENT';
        await decide(tx, 'tracking-fixture', items[0]!.id, 'DECLINE');
      } else {
        items[0]!.outcome = 'DECLINED';
        await change(tx, { ...items[0]! }, 'RETURN_PENDING', 'owner', 'Cancellation');
      }
      const expected = previewPricing(defaultRules(mode), count - 1);
      assert.equal(order.pricing.totalIdr, expected.totalIdr);
      assert.equal(items[0]!.finalPriceIdr, 0);
      assert.equal(order.pricing.initialTotalIdr, saved.initialTotalIdr);
      assert.deepEqual(order.pricing.cancellation?.originalAllocations, saved.allocations);
      assert.deepEqual(order.pricing.agreedAllocations, saved.agreedAllocations);
      assert.equal(order.pricing.agreedTotalIdr, saved.agreedTotalIdr);
      assert.equal(order.pricing.lockedAt, saved.lockedAt);
      assert.equal(order.pricing.verifiedAt, saved.verifiedAt);
      assert.deepEqual(payments, ledger);
      await requireVerifiedPricing(tx, 'order');
      const projected = publicPricing(order.pricing, items);
      assert.deepEqual(projected.breakdown, expected.breakdown);
      assert.equal(projected.originalPairs, count); assert.equal(projected.excludedPairs, 1);
      assert.equal(projected.basis, 'CANCELLATION');
      for (const secret of ['verifiedBy', 'private-staff', 'originalAllocations', 'agreedAllocations', 'serviceId', 'planId', 'rules']) assert.ok(!JSON.stringify(projected).includes(secret));
      const stable = structuredClone(order.pricing), auditCount = audits.length;
      await reprice(tx, 'order'); await reprice(tx, 'order', 'owner', true);
      assert.deepEqual(order.pricing, stable); assert.equal(audits.length, auditCount);
      const totals = await getOrder(tx, 'order');
      assert.equal(totals.paidIdr, saved.totalIdr - 1);
      assert.equal(totals.refundDueIdr, Math.max(0, saved.totalIdr - 1 - expected.totalIdr));
      assert.equal(totals.balanceIdr, expected.totalIdr - saved.totalIdr + 1);
      for (const i of items.slice(1)) {
        i.outcome = 'REJECTED'; i.status = 'RECEIVED' as 'QUEUED';
        await inspect(tx, i.id, { outcome: 'REJECTED', notes: '', risk: '' }, { id: 'owner', role: 'OWNER' });
      }
      assert.equal(order.pricing.totalIdr, 0); assert.equal(order.pricing.pairs, 0);
      assert.ok(items.every(i => i.finalPriceIdr === 0)); assert.deepEqual(payments, ledger);
      assert.equal((await getOrder(tx, 'order')).refundDueIdr, saved.totalIdr - 1);
    }
    // Mixed-stage public decline: frozen zero allocation stays zero, last decision finalizes.
    const mixed = [
      { id: 'a', orderId: 'mixed', status: 'PACKING', outcome: 'APPROVED', inspection: { actorUserId: 'inspector' }, consents: [], quotedPriceIdr: 0, finalPriceIdr: 0 },
      { id: 'b', orderId: 'mixed', status: 'QUEUED', outcome: 'APPROVED', inspection: { actorUserId: 'inspector' }, consents: [], quotedPriceIdr: 1, finalPriceIdr: 0 },
      { id: 'c', orderId: 'mixed', status: 'AWAITING_CONSENT', outcome: 'NEEDS_CONSENT', inspection: { actorUserId: 'inspector' }, consents: [], quotedPriceIdr: 1, finalPriceIdr: 0 },
    ];
    const mixedPricing = planPricing({ id: 'plan', name: 'Fixture', revision: 1, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 1 }] }, 's', 3);
    const mixedOrder = { id: 'mixed', pricing: { ...mixedPricing, allocations: { a: 0, b: 1, c: 1 }, totalIdr: 2 }, items: mixed, payments: [], customer: { notificationConsentAt: null }, trackingHash: null };
    const consent = { id: 'consent', itemId: 'c', item: mixed[2]!, consumedAt: null as Date | null, decision: null as string | null, expiresAt: new Date('2099-01-01'), quotedPriceIdr: 1 };
    const mixedFake = {
      $queryRaw: async () => [{ id: 'mixed' }],
      order: { findUnique: async () => mixedOrder, findUniqueOrThrow: async () => mixedOrder, update: async ({ data }: { data: object }) => Object.assign(mixedOrder, data) },
      orderItem: { findMany: async () => mixed, update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(mixed.find(i => i.id === where.id)!, data) },
      statusHistory: { create: async () => ({ id: 'history' }) }, auditLog: { create: async () => ({}) },
      storeSettings: { findUnique: async () => null }, notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event' }) },
      consentDecision: { findFirst: async () => consent.consumedAt ? null : consent, update: async ({ data }: { data: object }) => Object.assign(consent, data) },
    };
    const mixedTx = mixedFake as unknown as Tx;
    await decide(mixedTx, 'tracking-fixture', 'c', 'DECLINE');
    assert.equal(consent.decision, 'DECLINE'); assert.ok(consent.consumedAt);
    assert.equal(mixed[2]!.status, 'RETURN_PENDING'); assert.equal(mixed[2]!.finalPriceIdr, 0);
    assert.equal(mixedOrder.pricing.stage, 'FINAL'); assert.equal(mixedOrder.pricing.pairs, 2);
    assert.deepEqual(mixedOrder.pricing.allocations, { a: 0, b: 1, c: 0 });
    assert.equal(mixedOrder.pricing.totalIdr, 1); assert.equal(mixedOrder.pricing.verifiedBy, 'inspector');
    await requireVerifiedPricing(mixedTx, 'mixed');
    await assert.rejects(decide(mixedTx, 'tracking-fixture', 'c', 'DECLINE'), { code: 'TOKEN_INVALID' });
    mixedOrder.pricing.pairs = 3;
    await assert.rejects(requireVerifiedPricing(mixedTx, 'mixed'), { code: 'PRICE_CHANGED' });
    mixedOrder.pricing.pairs = 2;
    mixed[0]!.outcome = 'DECLINED'; mixed[0]!.finalPriceIdr = 5;
    await change(mixedTx, { ...mixed[0]!, status: 'PACKING' as const }, 'RETURN_PENDING', 'owner', 'Cancellation');
    assert.equal(mixed[0]!.finalPriceIdr, 0); assert.equal(mixedOrder.pricing.allocations.a, 0);
    assert.equal(mixedOrder.pricing.pairs, 1); assert.equal(mixedOrder.pricing.totalIdr, 1);
    const custom = calculatePricing(planPricing({ id: 'saved', name: 'Custom', revision: 1, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 73000 }, { kind: 'PACKAGE', minPairs: 3, maxPairs: 3, priceIdr: 180000 }] }, 's', 3), [{ id: 'a', outcome: 'APPROVED', status: 'QUEUED' }, { id: 'b', outcome: 'APPROVED', status: 'QUEUED' }, { id: 'c', outcome: 'DECLINED', status: 'RETURN_PENDING' }]);
    assert.equal(custom.totalIdr, 146000);
    // Historical partial allocation cannot be presented as a currently eligible package.
    const historic = { ...custom, stage: 'LOCKED' as const, pairs: 2, totalIdr: 120000 };
    assert.deepEqual(publicPricing(historic, []).breakdown, []);
  } finally { hooks.deregister(); }
});
