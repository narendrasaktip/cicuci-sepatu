import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

test('inspection HTTP: optional private risk photo; required BEFORE/findings/risk, private notes and explicit consent; isolated DB', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://localhost:5173';
  const item = { id: 'shoe', orderId: 'order', status: 'RECEIVED', outcome: null as string | null, quotedPriceIdr: 50000, finalPriceIdr: 0, photos: [{ kind: 'BEFORE', customerVisible: true }, { kind: 'INSPECTION', customerVisible: false }], consents: [], inspection: null as { notes: string } | null };
  const order = { id: 'order', createdAt: new Date('2026-11-11T10:00:00Z'), customer: { notificationConsentAt: null }, items: [item], payments: [] };
  const consents: { id: string; itemId: string; findings?: string | null; customerNote?: string | null; risk: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null; decision: string | null }[] = [];
  const histories: { reason: string }[] = [];
  const fake = {
    user: { findUnique: async () => ({ id: 'owner', role: 'OWNER', isActive: true }) },
    session: { findUnique: async () => ({ user: { id: 'owner', role: 'OWNER', isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) }) },
    idempotency: { findUnique: async () => null, create: async () => ({}), update: async () => ({}) },
    orderItem: { findUnique: async () => ({ ...item, order }), findMany: async () => [item], update: async ({ data }: { data: object }) => Object.assign(item, data) },
    order: { findUnique: async () => order, findUniqueOrThrow: async () => order, findMany: async () => [order], update: async () => order },
    payment: { findMany: async () => [] },
    inspection: { create: async ({ data }: { data: { notes: string } }) => { item.inspection = data; } },
    consentDecision: {
      create: async ({ data }: { data: Omit<typeof consents[number], 'id' | 'consumedAt' | 'decision'> }) => { const consent = { ...data, id: String(consents.length + 1), consumedAt: null, decision: null }; consents.push(consent); Object.assign(item, { consents }); return consent; },
      updateMany: async () => { for (const c of consents) if (!c.consumedAt) Object.assign(c, { consumedAt: new Date(), decision: 'REISSUED' }); },
      findFirst: async ({ where }: { where: { itemId: string; consumedAt: null } }) => { const consent = consents.find(c => c.itemId === where.itemId && !c.consumedAt); return consent ? { ...consent, item } : null; },
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(consents.find(c => c.id === where.id)!, data),
    },
    statusHistory: { create: async ({ data }: { data: { reason: string } }) => { histories.push(data); return { id: String(histories.length) }; } },
    storeSettings: { findUnique: async () => null },
    auditLog: { create: async () => ({}) },
    notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event' }) },
    $queryRaw: async () => [{ id: order.id }], $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  const key = Symbol.for('cicuci.inspection.notes'); Reflect.set(globalThis, key, fake);
  const hook = registerHooks({ resolve(s, context, next) {
    if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.inspection.notes")];', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js') && context.parentURL?.endsWith('/services/orders.ts')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Unexpected WhatsApp access");}', shortCircuit: true };
    return next(s, context);
  } });
  const { app } = await import('../src/app.js'); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (body: object, action = 'inspection') => fetch(`http://127.0.0.1:${address.port}/api/v1/items/shoe/${action}`, { method: 'POST', headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': 'csrf', 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const input = { outcome: 'APPROVED', quotedPriceIdr: 50000 };
  try {
    // Tracking allowlist: old internal notes/history never become public; only existing public risk and safe creation time.
    Object.assign(item, { inspection: { notes: 'PRIVATE_INSPECTION', risk: 'Public risk' }, history: [{ toStatus: 'RECEIVED', createdAt: new Date('2026-11-11T10:00:00Z'), reason: 'PRIVATE_HISTORY', actorUserId: 'PRIVATE_ACTOR' }], initialNotes: 'PRIVATE_INTAKE' });
    const tracking = await fetch(`http://127.0.0.1:${address.port}/api/v1/track/${'b'.repeat(64)}`);
    assert.equal(tracking.status, 200);
    const publicResult = await tracking.json();
    assert.equal(publicResult.createdAt, '2026-11-11T10:00:00.000Z');
    assert.equal(publicResult.items[0].risk, 'Public risk');
    assert.deepEqual(publicResult.items[0].timeline, [{ status: 'RECEIVED', at: '2026-11-11T10:00:00.000Z' }]);
    assert.ok(!JSON.stringify(publicResult).includes('PRIVATE_'));
    for (const notes of [undefined, '', 'x'.repeat(4000)]) {
      item.status = 'RECEIVED'; item.inspection = null;
      const response = await call({ ...input, ...(notes === undefined ? {} : { notes }) });
      assert.equal(response.status, 200, JSON.stringify(await response.json()));
      assert.equal((item.inspection as { notes: string } | null)?.notes, notes ?? ''); assert.equal(histories.at(-1)?.reason, notes ?? ''); assert.equal(item.status, 'QUEUED');
    }
    item.status = 'RECEIVED'; item.inspection = null;
    for (const notes of ['x'.repeat(4001), null, 1]) assert.equal((await call({ ...input, notes })).status, 400);
    for (const risk of [undefined, '', '   ']) {
      const response = await call({ ...input, outcome: 'NEEDS_CONSENT', ...(risk === undefined ? {} : { risk }) });
      assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    }
    item.photos = [{ kind: 'BEFORE', customerVisible: true }];
    let response: Response;
    for (const field of ['findings', 'risk', 'customerNote']) for (const value of [null, 1, 'x'.repeat(3001)]) {
      assert.equal((await call({ ...input, outcome: 'NEEDS_CONSENT', findings: 'Bagian atas kelupas', risk: 'Tidak akan bersih', [field]: value })).status, 400);
    }
    for (const field of ['findings', 'risk']) for (const value of ['', '  ', 'ab', '...']) assert.equal((await call({ ...input, outcome: 'NEEDS_CONSENT', findings: 'Bagian atas kelupas', risk: 'Tidak akan bersih', [field]: value })).status, 400);
    item.photos = []; response = await call({ ...input, outcome: 'NEEDS_CONSENT', findings: 'Warna rapuh', risk: 'Luntur' }); assert.equal((await response.json()).error.code, 'BEFORE_PHOTO_REQUIRED');
    assert.equal(item.inspection, null);
    item.status = 'QUEUED'; item.outcome = 'NEEDS_CONSENT';
    response = await call({ toStatus: 'WASHING' }, 'transition'); assert.equal((await response.json()).error.code, 'CONSENT_REQUIRED');
    // Exact UI payload passes the real HTTP validator, generated enum and transition service.
    item.status = 'DRYING'; item.outcome = 'APPROVED';
    response = await call({ toStatus: 'PACKING', reason: '' }, 'transition');
    assert.equal(response.status, 200, JSON.stringify(await response.json()));
    assert.equal(item.status, 'PACKING');
    const dashboard = await fetch(`http://127.0.0.1:${address.port}/api/v1/dashboard`, { headers: { Cookie: `cicuci_session=${'a'.repeat(64)}` } });
    assert.equal(dashboard.status, 200); assert.equal((await dashboard.json()).inProgress, 1);
    const historyCount = histories.length;
    response = await call({ toStatus: 'PACKING', reason: '' }, 'transition');
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'INVALID_TRANSITION');
    response = await call({ toStatus: 'NOT_A_STATUS', reason: '' }, 'transition');
    assert.equal(response.status, 400);
    const invalidStatus = await response.json();
    assert.equal(invalidStatus.error.code, 'VALIDATION_ERROR'); assert.equal(invalidStatus.error.details[0].path, 'toStatus');
    response = await call({ toStatus: 'PACKING', reason: '', unexpected: true }, 'transition');
    assert.equal(response.status, 400); assert.equal((await response.json()).error.code, 'VALIDATION_ERROR');
    assert.equal(item.status, 'PACKING'); assert.equal(histories.length, historyCount);
    item.status = 'DRYING';
    response = await call({ toStatus: 'READY_FOR_PICKUP', reason: '' }, 'transition');
    assert.equal(response.status, 409); assert.equal((await response.json()).error.code, 'INVALID_TRANSITION');
    assert.equal(item.status, 'DRYING'); assert.equal(histories.length, historyCount);
    console.info('PACKING_HTTP_CONTRACT', { accepted: 200, duplicate: 409, invalidEnum: 400, invalidField: 'toStatus', directReady: 409, dashboardInProgress: 1 });
    const { issueConsent, decide } = await import('../src/services/orders.js');
    const actor = { id: 'owner', role: 'OWNER' as const }; const tx = fake as unknown as Tx;
    const capability = await fetch(`http://127.0.0.1:${address.port}/api/v1/settings/inspection-capabilities`, { headers: { Cookie: `cicuci_session=${'a'.repeat(64)}` } });
    assert.equal(capability.status, 200); assert.deepEqual(await capability.json(), { structuredRiskConsent: true });
    for (const decision of ['APPROVE', 'DECLINE'] as const) {
      item.status = 'RECEIVED'; item.inspection = null; item.photos = [{ kind: 'BEFORE', customerVisible: true }, ...(decision === 'DECLINE' ? [{ kind: 'INSPECTION', customerVisible: false }] : [])];
      response = await call({ ...input, outcome: 'NEEDS_CONSENT', findings: '  Bagian atas kelupas  ', risk: '  Tidak akan bersih  ', customerNote: decision === 'APPROVE' ? ' Coba semaksimal mungkin ' : '   ', notes: 'PRIVATE_INSPECTION' });
      assert.equal(response.status, 200); await response.json();
      const original = structuredClone(consents.at(-1)!);
      assert.equal(original.findings, 'Bagian atas kelupas'); assert.equal(original.risk, 'Tidak akan bersih'); assert.equal(original.customerNote, decision === 'APPROVE' ? 'Coba semaksimal mungkin' : null);
      const publicResult = await (await fetch(`http://127.0.0.1:${address.port}/api/v1/track/${'b'.repeat(64)}`)).json();
      assert.equal(publicResult.items[0].findings, original.findings); assert.equal(publicResult.items[0].consents.at(-1).findings, original.findings); assert.ok(!JSON.stringify(publicResult).includes('PRIVATE_'));
      assert.ok(publicResult.items[0].photos.every((photo: { kind: string }) => photo.kind !== 'INSPECTION'));
      assert.equal(item.status, 'AWAITING_CONSENT'); assert.equal(item.finalPriceIdr, 0);
      await assert.rejects(decide(tx, 'b'.repeat(64), 'other-shoe', decision), /TOKEN_INVALID/);
      consents.at(-1)!.expiresAt = new Date(0);
      await assert.rejects(decide(tx, 'b'.repeat(64), 'shoe', decision), /TOKEN_EXPIRED/);
      consents.at(-1)!.expiresAt = original.expiresAt;
      const publicDecision: Response = await fetch(`http://127.0.0.1:${address.port}/api/v1/track/${'b'.repeat(64)}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: 'shoe', decision }) });
      assert.equal(publicDecision.status, 200); assert.deepEqual(await publicDecision.json(), { decision });
      assert.equal(item.status, decision === 'APPROVE' ? 'QUEUED' : 'RETURN_PENDING'); assert.equal(item.finalPriceIdr, decision === 'APPROVE' ? 50000 : 0);
      await assert.rejects(decide(tx, 'b'.repeat(64), 'shoe', decision), /TOKEN_INVALID/);
      assert.equal(consents.at(-1)!.findings, original.findings);
    }
    item.status = 'AWAITING_CONSENT';
    Object.assign(item.inspection!, { findings: null, customerNote: null, risk: 'Original legacy description' });
    await issueConsent(tx, 'shoe', actor);
    assert.equal(consents.at(-1)!.findings, null); assert.equal(consents.at(-1)!.risk, 'Original legacy description');
    const legacy = structuredClone(consents.at(-1)!);
    Object.assign(item.inspection!, { findings: 'Temuan baru', customerNote: 'Catatan baru', risk: 'Risiko baru' });
    await issueConsent(tx, 'shoe', actor);
    assert.equal(consents.at(-2)!.risk, legacy.risk); assert.equal(consents.at(-2)!.decision, 'REISSUED'); assert.equal(consents.at(-1)!.findings, 'Temuan baru');
  } finally { await new Promise<void>(r => server.close(() => r())); hook.deregister(); Reflect.deleteProperty(globalThis, key); }
});
