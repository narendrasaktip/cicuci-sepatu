import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

test('ready notifications omit final item when the final bill is queued', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/lib/config.js')) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://localhost:5173"}', shortCircuit: true };
    if (specifier.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){return "NOT_ENABLED"}', shortCircuit: true };
    if (specifier.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db={}', shortCircuit: true };
    return next(specifier, context);
  } });
  const previous = process.env.WA_MESSAGE_KEY;
  process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  try {
    const { change, notify, ledger } = await import('../src/services/orders.js');
    const { defaults, seal, unseal, templateWrite } = await import('../src/services/whatsapp-templates.js');
    const { hashToken } = await import('../src/lib/security.js');
    const token = 'a'.repeat(64);
    const editable = { ...defaults.find(t => t.event === 'ITEM_READY_FOR_PICKUP')!, body: 'Cicuci Sepatu: {sepatu} selesai QC dan pengemasan. {url_tracking}' };
    assert.deepEqual(templateWrite.parse(editable), editable);
    for (const count of [1, 2, 3]) {
      const items = Array.from({ length: count }, (_, i) => ({ id: `shoe-${i}`, orderId: 'order', status: 'DRYING', brand: `Brand${i}`, model: '', color: '', finalPriceIdr: 100, outcome: 'APPROVED' }));
      const payments: { id: string; kind: string; amountIdr: number }[] = [];
      const order = { id: 'order', number: 'TEST', items, payments, pricing: null, trackingSecret: seal(token), trackingHash: hashToken(token), customer: { name: 'Test [SALDO_SAAT_KLAIM]', whatsapp: '+620000000', notificationConsentAt: null } };
      const events = new Map<string, { id: string; eventKey: string; template: string; itemId?: string; expectedStatus?: string; encryptedMessage?: string }>();
      let history = 0;
      const fake = {
        $queryRaw: async () => [{ id: 'order', archivedAt: null }],
        payment: { create: async ({ data }: { data: { kind: string; amountIdr: number } }) => { const payment = { ...data, id: `payment-${payments.length + 1}` }; payments.push(payment); return payment; } },
        orderItem: { update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(items.find(i => i.id === where.id)!, data), findMany: async () => items },
        order: { findUnique: async () => order, findUniqueOrThrow: async () => order, update: async () => order },
        statusHistory: { create: async () => ({ id: `history-${++history}` }) },
        auditLog: { create: async () => ({}) },
        storeSettings: { findUnique: async () => ({ waTemplates: [editable] }) },
        notificationEvent: {
          findUnique: async ({ where }: { where: { eventKey: string } }) => events.get(where.eventKey) ?? null,
          upsert: async ({ where, create }: { where: { eventKey: string }; create: typeof events extends Map<string, infer V> ? V : never }) => {
            if (!events.has(where.eventKey)) events.set(where.eventKey, { ...create, id: where.eventKey });
            return events.get(where.eventKey)!;
          },
        },
      };
      const tx = fake as unknown as Tx;
      for (let i = 0; i < count; i++) {
        await change(tx, items[i] as never, 'READY_FOR_PICKUP', 'owner', 'QC');
        assert.equal([...events.values()].filter(e => e.template === 'ITEM_READY_FOR_PICKUP').length, Math.min(i + 1, count - 1));
        assert.equal([...events.values()].filter(e => e.template === 'READY_FOR_PICKUP').length, 0);
        assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_UNPAID').length, i === count - 1 ? 1 : 0);
        const event = events.get(`history-${i + 1}`);
        if (i === count - 1) assert.equal(event, undefined);
        else {
          assert.ok(event); assert.equal(event.itemId, `shoe-${i}`); assert.equal(event.expectedStatus, 'READY_FOR_PICKUP');
          assert.match((unseal(event.encryptedMessage!) as { message: string }).message, new RegExp(`Brand${i} selesai QC`));
          await notify(tx, order.id, 'ITEM_READY_FOR_PICKUP', event.eventKey, event.itemId, event.expectedStatus);
          assert.equal(events.get(event.eventKey), event);
        }
      }
      assert.equal(events.size, count);
      assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_UNPAID').length, 1);
      const payload = unseal([...events.values()].find(e => e.template === 'PICKUP_BILL_UNPAID')!.encryptedMessage!) as { message: string; balanceMarker: string };
      assert.match(payload.message, /Test \[SALDO_SAAT_KLAIM\]/); assert.ok(payload.message.includes(payload.balanceMarker)); assert.notEqual(payload.balanceMarker, '[SALDO_SAAT_KLAIM]');
      assert.doesNotMatch(payload.message, /Brand\d+ {2}/);
      assert.match(payload.message, /dikonfirmasi secara manual/);
      items[0]!.outcome = 'REJECTED';
      const rejected = await notify(tx, order.id, 'PICKUP_BILL_UNPAID', 'rejected-test');
      assert.match((unseal(rejected.encryptedMessage!) as { message: string }).message, /tidak dicuci, biaya pencucian Rp0/);
      events.delete('rejected-test'); items[0]!.outcome = 'APPROVED';
      const pay = (amountIdr: number) => ledger(tx, order.id, { kind: 'PAYMENT', amountIdr, method: 'CASH', reason: '', receivedAt: new Date().toISOString() }, { id: 'owner', role: 'OWNER' });
      const refund = (amountIdr: number) => ledger(tx, order.id, { kind: 'REFUND', amountIdr, method: 'CASH', reason: 'Koreksi', receivedAt: new Date().toISOString() }, { id: 'owner', role: 'OWNER' });
      await pay(count * 100 - 1);
      assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_PAID').length, 0);
      await pay(1);
      assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_PAID').length, 1);
      await refund(1);
      assert.equal(events.get('pickup-refund:payment-3')?.template, 'PICKUP_BILL_UNPAID');
      await refund(1);
      assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_UNPAID').length, 2);
      await pay(2);
      items[0]!.status = 'DRYING';
      await change(tx, items[0] as never, 'READY_FOR_PICKUP', 'owner', 'QC');
      assert.equal([...events.values()].filter(e => e.template === 'PICKUP_BILL_PAID').length, 3);
    }
  } finally {
    if (previous === undefined) delete process.env.WA_MESSAGE_KEY; else process.env.WA_MESSAGE_KEY = previous;
    hooks.deregister();
  }
});
