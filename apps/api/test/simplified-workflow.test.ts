import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

test('simplified workflow: independent shoes, evidence, risk, zero fees, direct audited ready, legacy, duplicate rejection; isolated fixtures', async () => {
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/lib/config.js')) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://example.test"};', shortCircuit: true };
    if (specifier.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Unexpected WhatsApp access");}', shortCircuit: true };
    if (specifier.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db={};', shortCircuit: true };
    return next(specifier, context);
  } });
  try {
    const { inspect, transition, aggregate } = await import('../src/services/orders.js');
    const actor = { id: 'fixture-owner', role: 'OWNER' as const };
    const make = (id: string, status = 'RECEIVED') => ({ id, orderId: 'fixture-order', order: { pricing: null as unknown }, status, outcome: null as string | null, assignedUserId: null as string | null, photos: [] as { kind: string; customerVisible: boolean }[], consents: [] as { decision: string; consumedAt: Date | null }[], inspection: null as object | null, finalPriceIdr: 0 });
    const items = [make('a'), make('b'), make('c')];
    const histories: { itemId: string; fromStatus: string; toStatus: string }[] = [];
    const events: { eventKey: string; expectedStatus: string; template: string }[] = [];
    const audits: string[] = [];
    const order = { id: 'fixture-order', customer: { notificationConsentAt: null, whatsapp: '+620000000' }, items, payments: [], aggregateStatus: '' };
    const fake = {
      $queryRaw: async () => [{ id: order.id }],
      orderItem: {
        findUnique: async ({ where }: { where: { id: string } }) => items.find(i => i.id === where.id),
        findMany: async () => items,
        update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(items.find(i => i.id === where.id)!, data),
      },
      order: { findUnique: async () => order, findUniqueOrThrow: async () => order, update: async ({ data }: { data: object }) => Object.assign(order, data) },
      storeSettings: { findUnique: async () => null },
      statusHistory: { create: async ({ data }: { data: typeof histories[number] }) => { histories.push(data); return { id: String(histories.length) }; } },
      auditLog: { create: async ({ data }: { data: { action: string } }) => { audits.push(data.action); } },
      inspection: { create: async ({ data }: { data: { itemId: string } }) => { items.find(i => i.id === data.itemId)!.inspection = data; } },
      notificationEvent: { findUnique: async () => null, upsert: async ({ create }: { create: typeof events[number] }) => { events.push(create); return { id: String(events.length) }; } },
    };
    const tx = fake as unknown as Tx;
    const inspection = { outcome: 'APPROVED' as const, notes: 'safe', risk: '', quotedPriceIdr: 50000 };
    await assert.rejects(inspect(tx, 'a', inspection, actor), /BEFORE_PHOTO_REQUIRED/);
    assert.equal(histories.length, 0); assert.equal(events.length, 0);
    items[0]!.photos.push({ kind: 'BEFORE', customerVisible: true });
    await inspect(tx, 'a', inspection, actor);
    assert.equal(items[0]!.status, 'QUEUED'); assert.equal(items[1]!.status, 'RECEIVED');
    assert.deepEqual(histories.map(h => h.toStatus), ['QUEUED']);
    await assert.rejects(inspect(tx, 'a', inspection, actor), /INVALID_TRANSITION/);
    items[1]!.photos.push({ kind: 'BEFORE', customerVisible: true });
    await assert.rejects(inspect(tx, 'b', { ...inspection, outcome: 'NEEDS_CONSENT', findings: 'Warna rapuh', risk: '' }, actor), /Minimal 3 karakter bermakna/);
    items[1]!.status = 'QUEUED'; items[1]!.outcome = 'NEEDS_CONSENT';
    await assert.rejects(transition(tx, 'b', { toStatus: 'WASHING', reason: '' }, actor), /CONSENT_REQUIRED/);
    items[2]!.photos.push({ kind: 'BEFORE', customerVisible: true });
    await inspect(tx, 'c', { ...inspection, outcome: 'REJECTED' }, actor);
    assert.equal(items[2]!.finalPriceIdr, 0); assert.equal(items[2]!.status, 'RETURN_PENDING');
    // Assignment is optional for OWNER/ADMIN, never for another/unassigned STAFF item.
    const start = { toStatus: 'WASHING' as const, reason: '' };
    const staff = { id: 'fixture-staff', role: 'STAFF' as const };
    const shoe = items[0]!;
    const effects = () => [histories.length, events.length, audits.length];
    const beforeDenied = effects();
    await assert.rejects(transition(tx, 'a', start, staff), /FORBIDDEN/);
    shoe.assignedUserId = 'another-staff';
    await assert.rejects(transition(tx, 'a', start, staff), /FORBIDDEN/);
    shoe.assignedUserId = null;
    for (const outcome of [null, 'NEEDS_CONSENT', 'REJECTED', 'DECLINED']) {
      shoe.outcome = outcome;
      await assert.rejects(transition(tx, 'a', start, actor), /CONSENT_REQUIRED/);
    }
    shoe.outcome = 'APPROVED';
    shoe.status = 'INSPECTION';
    await assert.rejects(transition(tx, 'a', start, actor), /INVALID_TRANSITION/);
    shoe.status = 'QUEUED';
    assert.deepEqual(effects(), beforeDenied);
    // Smart pricing eligibility covered by verified-pricing.test.ts (isolated full order model).
    for (const role of ['OWNER', 'ADMIN'] as const) {
      const before = effects();
      await transition(tx, 'a', start, { id: `fixture-${role}`, role });
      assert.equal(shoe.status, 'WASHING'); assert.equal(shoe.assignedUserId, null);
      assert.deepEqual(effects(), [before[0]! + 1, before[1]! + 1, before[2]! + 2]);
      await assert.rejects(transition(tx, 'a', start, actor), /INVALID_TRANSITION/);
      shoe.status = 'QUEUED';
    }
    shoe.order.pricing = null;
    shoe.assignedUserId = staff.id;
    const scoped = await transition(tx, 'a', start, staff);
    assert.equal(scoped.customer, undefined); assert.equal(scoped.payments, undefined);
    assert.deepEqual(scoped.items.map(i => i.id), ['a']);
    shoe.assignedUserId = null;
    await transition(tx, 'a', { toStatus: 'DRYING', reason: '' }, actor);
    const ready = { toStatus: 'READY_FOR_PICKUP' as const, reason: 'checked', qcPassed: true, dryConfirmed: true, finishingConfirmed: true };
    const before = events.length;
    await assert.rejects(transition(tx, 'a', ready, actor), /QC_PHOTO_REQUIRED/);
    items[0]!.photos.push({ kind: 'AFTER', customerVisible: false });
    await assert.rejects(transition(tx, 'a', ready, actor), /QC_PHOTO_REQUIRED/);
    items[0]!.photos.push({ kind: 'AFTER', customerVisible: true });
    for (const missing of ['dryConfirmed', 'finishingConfirmed', 'qcPassed'] as const) await assert.rejects(transition(tx, 'a', { ...ready, [missing]: false }, actor));
    shoe.outcome = 'NEEDS_CONSENT';
    await assert.rejects(transition(tx, 'a', ready, actor), /CONSENT_REQUIRED/);
    shoe.outcome = 'APPROVED';
    assert.equal(items[0]!.status, 'DRYING'); assert.equal(events.length, before);
    await transition(tx, 'a', ready, actor);
    assert.equal(events.length, before); assert.equal(order.aggregateStatus, 'IN_PROGRESS');
    assert.equal(events.filter(e => e.template === 'READY_FOR_PICKUP').length, 0);
    assert.ok(audits.includes('READY_DRY_FINISHING_QC_CONFIRMED'));
    assert.deepEqual(histories.filter(h => h.itemId === 'a').map(h => h.toStatus), ['QUEUED', 'WASHING', 'WASHING', 'WASHING', 'DRYING', 'READY_FOR_PICKUP']);
    shoe.assignedUserId = staff.id;
    await assert.rejects(transition(tx, 'a', { toStatus: 'HANDED_OVER', reason: '' }, staff), /FORBIDDEN/);
    shoe.assignedUserId = null;
    const beforeHandover = effects();
    await assert.rejects(transition(tx, 'a', { toStatus: 'HANDED_OVER', reason: '' }, actor), /PAYMENT_REQUIRED/);
    assert.equal(shoe.status, 'READY_FOR_PICKUP');
    assert.deepEqual(effects(), beforeHandover);
    await assert.rejects(transition(tx, 'a', ready, actor), /INVALID_TRANSITION/);
    assert.equal(events.length, before);
    for (const legacy of ['PACKING', 'FINISHING', 'QC']) { items[0]!.status = legacy; await transition(tx, 'a', ready, actor); }
    items[0]!.status = 'QC'; await transition(tx, 'a', { toStatus: 'REWORK', reason: 'stain', qcPassed: false }, actor);
    await transition(tx, 'a', { toStatus: 'WASHING', reason: 'repeat' }, actor);
    items[1]!.inspection = {}; items[1]!.consents.push({ decision: 'APPROVE', consumedAt: new Date() }); await transition(tx, 'b', { toStatus: 'WASHING', reason: '' }, actor);
    assert.equal(items[2]!.status, 'RETURN_PENDING');
    // Last rejection or risk decline can complete an otherwise ready order.
    for (const previous of ['RECEIVED', 'AWAITING_CONSENT']) {
      items[0]!.status = 'READY_FOR_PICKUP'; items[1]!.status = previous;
      const count = events.filter(e => e.template === 'READY_FOR_PICKUP').length;
      const { change } = await import('../src/services/orders.js');
      await change(tx, items[1] as never, 'RETURN_PENDING', actor.id, 'fixture');
      assert.equal(events.filter(e => e.template === 'READY_FOR_PICKUP').length, count + 1);
      assert.equal(order.aggregateStatus, 'READY_FOR_PICKUP');
    }
    await assert.rejects(transition(tx, 'c', { toStatus: 'RETURNED', reason: 'returned' }, actor), /INVALID_TRANSITION/);
    assert.equal(aggregate(items.map(i => i.status)), 'READY_FOR_PICKUP');
    assert.equal(order.payments.length, 0);
  } finally { hooks.deregister(); }
});
