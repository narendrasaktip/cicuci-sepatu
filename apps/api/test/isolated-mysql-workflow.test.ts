import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';

test('isolated MySQL: work during estimate, consent decisions and final package prices', { skip: process.env.RUN_ISOLATED_MYSQL_TESTS !== '1' }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.pathname, '/cicuci_fixture_test');
  assert.ok(url.searchParams.get('socket')?.includes('/opencode/mysql-isolated-20261116/'));
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw Error("Unexpected outbound access")}', shortCircuit: true };
    return next(s, c);
  } });
  const db = new PrismaClient();
  try {
    const { inspect, transition, decide, ledger, handoverOrder, getOrder } = await import('../src/services/orders.js');
    const { initialPricing } = await import('../src/services/pricing.js');
    await db.$transaction(async tx => {
      const customer = await tx.customer.create({ data: { name: 'Fixture', whatsapp: '+620000001' } });
      const service = await tx.service.create({ data: { name: 'Fixture', basePriceIdr: 50000 } });
      const actor = { id: 'fixture-owner', role: 'OWNER' as const };
      for (const outcome of ['APPROVE', 'DECLINE', 'REJECTED'] as const) {
        const token = `fixture-${outcome}`;
        const { hashToken } = await import('../src/lib/security.js');
        const order = await tx.order.create({ data: { number: `FIXTURE-${outcome}`, customerId: customer.id, pricing: initialPricing('NORMAL', service.id, 2), trackingHash: hashToken(token), estimatedCompletionAt: new Date(), pickupInstructions: '' } });
        const shoes = await Promise.all([0, 1].map(i => tx.orderItem.create({ data: { orderId: order.id, serviceId: service.id, serviceName: 'Fixture', brand: `Shoe ${i}`, model: '', color: '', initialNotes: '', quotedPriceIdr: 50000 } })));
        for (const shoe of shoes) await tx.photo.create({ data: { itemId: shoe.id, kind: 'BEFORE', customerVisible: true, mime: 'image/png', content: Buffer.from('fixture') } });
        await inspect(tx, shoes[0]!.id, { outcome: 'APPROVED' }, actor);
        await transition(tx, shoes[0]!.id, { toStatus: 'WASHING', reason: '' }, actor);
        assert.equal((await getOrder(tx, order.id)).pricing && (await getOrder(tx, order.id)).items[0]!.finalPriceIdr, 0);
        await assert.rejects(ledger(tx, order.id, { kind: 'PAYMENT', amountIdr: 1, method: 'CASH', reason: '', receivedAt: new Date().toISOString() }, actor), /PRICE_NOT_FINAL/);
        await assert.rejects(handoverOrder(tx, order.id, actor), /ORDER_NOT_READY/);
        if (outcome === 'REJECTED') await inspect(tx, shoes[1]!.id, { outcome: 'REJECTED' }, actor);
        else {
          await inspect(tx, shoes[1]!.id, { outcome: 'NEEDS_CONSENT', findings: 'Fixture findings', risk: 'Fixture risk' }, actor);
          await assert.rejects(transition(tx, shoes[1]!.id, { toStatus: 'WASHING', reason: '' }, actor), /INVALID_TRANSITION/);
          await assert.rejects(ledger(tx, order.id, { kind: 'PAYMENT', amountIdr: 1, method: 'CASH', reason: '', receivedAt: new Date().toISOString() }, actor), /PRICE_NOT_FINAL/);
          await decide(tx, token, shoes[1]!.id, outcome);
        }
        const result = await getOrder(tx, order.id);
        assert.equal(result.totalIdr, outcome === 'APPROVE' ? 100000 : 50000);
        assert.equal(result.items.reduce((sum, shoe) => sum + shoe.finalPriceIdr, 0), result.totalIdr);
        if (outcome !== 'APPROVE') assert.equal(result.items.find(shoe => shoe.id === shoes[1]!.id)!.finalPriceIdr, 0);
      }
      throw new Error('FIXTURE_ROLLBACK');
    }, { timeout: 30000 }).catch(error => { if (error.message !== 'FIXTURE_ROLLBACK') throw error; });
  } finally { await db.$disconnect(); hooks.deregister(); }
});
