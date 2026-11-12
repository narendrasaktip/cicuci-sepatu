import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';

test('isolated HTTP/service: paid/refunded deletion, existing-order revenue/retained evidence, rollback, roles, idempotency and serialized protections', async () => {
  Object.assign(process.env, { DATABASE_URL: 'mysql://fake:fake@127.0.0.1:1/fake', REDIS_URL: 'redis://127.0.0.1:1', APP_BASE_URL: 'https://store.example', WA_MESSAGE_KEY: 'ab'.repeat(32) });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>; // Test-only in-memory database; no Prisma instance or network integrations.
  const users: Row[] = [{ id: 'owner', role: 'OWNER', isActive: true, archivedAt: null }, { id: 'other', role: 'OWNER', isActive: true, archivedAt: null }, { id: 'staff', role: 'STAFF', isActive: true, archivedAt: null }];
  const customer: Row = { id: 'customer', name: 'Dina', salutation: 'Kak', whatsapp: '+6281234567890', archivedAt: null, notificationConsentAt: new Date() };
  const order: Row = { id: 'order', number: 'CS-TEST', archivedAt: null, customerId: 'customer', customer, items: [], estimatedCompletionAt: new Date('2020-01-01'), payments: [], aggregateStatus: 'RECEIVED', trackingHash: '', trackingSecret: '' };
  const ledgerRows: Row[] = []; let ledgerReads = 0; let failAudit = false; let processingAttempt = false;
  const plan: Row = { id: 'plan', name: 'Reguler', archivedAt: null, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 10000 }] };
  const audits: Row[] = []; const childRows: Record<string, Row[]> = {}; const children = ['photo','inspection','consentDecision','statusHistory']; let failDelete = false; const locks: string[] = []; let signedIn = users[0]!; let event: Row | undefined; let deletedSessions = 0; let attempts = 0;
  const match = (row: Row, where: Row): boolean => Object.entries(where).every(([k, v]) => v === undefined || (k === 'OR' ? (v as Row[]).some(w => match(row, w)) : typeof v === 'object' && v !== null ? 'in' in v ? v.in.includes(row[k]) : row[k] != null && match(row[k], v) : row[k] === v));
  const tables: Row[][] = [];
  function model(rows: Row[]) { tables.push(rows); return {
    findUnique: async ({ where }: Row) => rows.find(r => match(r, where)) ?? null,
    findUniqueOrThrow: async ({ where }: Row) => { const r = rows.find(r => match(r, where)); assert.ok(r); return r; },
    findMany: async ({ where = {} }: Row) => rows.filter(r => match(r, where)),
    count: async ({ where }: Row) => rows.filter(r => match(r, where)).length,
    delete: async ({ where }: Row) => { const i = rows.findIndex(r => match(r, where)); assert.ok(i >= 0); if (failDelete) { const { Prisma } = await import('@prisma/client'); throw new Prisma.PrismaClientKnownRequestError('dependency', { code: 'P2003', clientVersion: 'test' }); } if (rows[i] === order) { if (event && event.orderId === order.id) event.orderId = null; for (const payment of ledgerRows) if (payment.orderId === order.id) payment.orderId = null; } return rows.splice(i, 1)[0]; },
    deleteMany: async () => { rows.splice(0); return { count: 1 }; },
    update: async ({ where, data }: Row) => { const r = rows.find(r => match(r, where)); assert.ok(r); Object.assign(r, data); return r; },
  }; }
  const orderRows = [order];
  const receipts: Row[] = [];
  let queue = Promise.resolve();
  const fake: Row = {
    customer: { ...model([customer]), create: async ({ data }: Row) => ({ id: 'new', salutation: 'Kak', ...data }) }, user: model(users), order: model(orderRows), ratePlan: model([plan]),
    payment: { ...model(ledgerRows), findMany: async ({ where }: Row) => { ledgerReads++; assert.deepEqual(where.order, { isNot: null }); return ledgerRows.filter(p => orderRows.some(o => o.id === p.orderId) && (!where.receivedAt.gte || p.receivedAt >= where.receivedAt.gte) && (!where.receivedAt.lte || p.receivedAt <= where.receivedAt.lte)); }, create: async ({ data }: Row) => { ledgerRows.push({ id: `payment-${ledgerRows.length}`, createdAt: new Date(), ...data }); order.payments.push(ledgerRows.at(-1)); return ledgerRows.at(-1); } },
    orderItem: { count: async () => 0, deleteMany: async () => ({ count: 1 }), findUnique: async () => ({ id: 'item', orderId: order.id, order, assignedUserId: 'staff', status: 'QUEUED', consents: [] }) },
    session: { findUnique: async () => ({ user: signedIn, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) }), deleteMany: async () => { deletedSessions++; return {}; } },
    idempotency: { ...model(receipts), create: async ({ data }: Row) => { receipts.push(data); return data; } },
    auditLog: { count: async () => 0, create: async ({ data }: Row) => { if (failAudit && data.action === 'ORDER_DELETED') throw Error('audit unavailable'); audits.push(data); return data; } },
    storeSettings: { findUnique: async () => ({ waActivation: 'test-only', waTemplates: [] }) },
    notificationEvent: { count: async ({ where }: Row) => event && event.orderId === where.orderId && where.status.in.includes(event.status) ? 1 : 0, findUnique: async () => event, findUniqueOrThrow: async () => ({ ...event, attempts: [], order }), upsert: async ({ create }: Row) => event ??= { id: 'event', generation: 0, ...create }, update: async ({ data }: Row) => { Object.assign(event!, data); return event; } },
    notificationAttempt: { count: async () => Number(processingAttempt), create: async () => { attempts++; return {}; } },
    $queryRaw: async (sql: TemplateStringsArray) => { const text = sql.join('?'); locks.push(text); return text.includes('FROM `Order`') ? (await fake.order.findUnique({ where: { id: order.id } }) ? [{ id: order.id, archivedAt: order.archivedAt }] : []) : [{ id: 'locked' }]; },
    $transaction: (run: (tx: Row) => unknown) => { const result = queue.then(async () => { const snapshots = tables.map(rows => [...rows]); const beforeLedger = structuredClone(ledgerRows); const beforeAudits = structuredClone(audits); const beforeEvent = structuredClone(event); const sessions = deletedSessions; try { return await run(fake); } catch (error) { tables.forEach((rows, i) => rows.splice(0, rows.length, ...snapshots[i]!)); ledgerRows.splice(0, ledgerRows.length, ...beforeLedger); audits.splice(0, audits.length, ...beforeAudits); event = beforeEvent; deletedSessions = sessions; throw error; } }); queue = result.then(() => undefined, () => undefined); return result; },
  };
  for (const child of children) { childRows[child] = [{ id: child, itemId: 'item' }]; fake[child] = model(childRows[child]); }
  const itemRows: Row[] = [{ id: 'item', orderId: 'order' }]; fake.orderItem.deleteMany = model(itemRows).deleteMany;
  Reflect.set(globalThis, Symbol.for('cicuci.deletion.fake'), fake);
  const dbUrl = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("cicuci.deletion.fake")];');
  const controlUrl = 'data:text/javascript,' + encodeURIComponent('export async function notificationBlocker(){return undefined;}');
  const hooks = registerHooks({ resolve(s, ctx, next) {
    if (/(?:^|\/)db\.js$/.test(s)) return { url: dbUrl, shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: controlUrl, shortCircuit: true };
    return next(s, ctx);
  } });
  const express = (await import('express')).default; const { operations, publicApi, operationErrors } = await import('../src/controllers/operations.js');
  const app = express(); app.use(express.json()); app.use('/api/v1', publicApi, operations); app.use(operationErrors); app.use(((error, _req, res, _next) => { res.status(error.name === 'ZodError' ? 400 : 500).json({ error: error.message }); }) as import('express').ErrorRequestHandler);
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, method = 'GET', body?: unknown, key = crypto.randomUUID()) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': 'csrf', 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const confirmed = { confirmed: true, confirmation: 'HAPUS' } as const;
  try {
    const { notify } = await import('../src/services/orders.js');
    const { deleteEntity: deletion } = await import('../src/services/deletions.js'); const { userWrite } = await import('../src/services/catalog.js');
    const { seal, unseal, defaults, renderTemplate, previewValues } = await import('../src/services/whatsapp-templates.js');
    const { hashToken } = await import('../src/lib/security.js');
    const tx = fake as never; const actor = { id: 'owner', role: 'OWNER' } as const;
    for (const salutation of ['Kak', 'Pak', 'Bu']) {
      const result = await call('/customers', 'POST', { name: 'Baru', whatsapp: '081234567890', salutation, notificationConsent: false });
      assert.equal(result.status, 201); assert.equal((await result.json()).salutation, salutation);
      assert.equal((await call('/customers/customer', 'PATCH', { salutation })).status, 200);
      assert.equal(customer.salutation, salutation);
    }
    assert.equal((await (await call('/customers', 'POST', { name: 'Baru', whatsapp: '081234567890', notificationConsent: false })).json()).salutation, 'Kak');
    assert.equal((await call('/customers/customer', 'PATCH', { salutation: 'Dr' })).status, 400);
    const raw = 'cd'.repeat(32); order.trackingHash = hashToken(raw); order.trackingSecret = seal(raw);
    for (const salutation of ['Kak', 'Pak', 'Bu']) {
      customer.salutation = salutation; event = undefined; await notify(tx, 'order', 'ORDER_RECEIVED', 'receipt');
      assert.match((unseal(event!.encryptedMessage) as Row).message, new RegExp(`Halo ${salutation} Dina`));
    }
    const snapshot = event!.encryptedMessage; customer.salutation = 'Pak'; await notify(tx, 'order', 'ORDER_RECEIVED', 'receipt'); assert.equal(event!.encryptedMessage, snapshot);
    const literal = defaults[0]!.body.replace('{sapaan}', 'Kak'); assert.match(renderTemplate(literal, { ...previewValues, sapaan: 'Bu' }), /Halo Kak/);
    for (const role of ['ADMIN', 'STAFF']) {
      signedIn = { ...users[0], role };
      for (const path of ['/customers/customer', '/orders/order', '/pricing/plans/plan', '/users/other']) assert.equal((await call(path, 'DELETE', confirmed)).status, 403);
      await assert.rejects(deletion(tx, 'orders', 'order', confirmed, signedIn as never), /FORBIDDEN/);
    }
    signedIn = users[0]!;
    for (const body of [{ confirmed: true }, { confirmed: false, confirmation: 'HAPUS' }, { confirmed: true, confirmation: 'ARSIPKAN' }]) assert.equal((await call('/orders/order', 'DELETE', body)).status, 400);
    assert.equal((await call('/users/owner', 'DELETE', confirmed)).status, 409);
    assert.equal((await call('/customers/customer', 'DELETE', confirmed)).status, 409);
    order.items = [{ finalPriceIdr: 10000, outcome: 'APPROVED', status: 'QUEUED' }];
    const paymentInput = { amountIdr: 10000, method: 'CASH', reason: '', receivedAt: '2026-11-10T00:00:00.000Z' };
    assert.equal((await call('/orders/order/payments', 'POST', paymentInput)).status, 201);
    assert.equal(ledgerRows[0]!.originalOrderId, 'order'); assert.equal(ledgerRows[0]!.originalOrderNumber, 'CS-TEST');
    assert.equal((await (await call('/dashboard')).json()).activeOrders, 1);
    const ledgerEvidence = structuredClone(ledgerRows);
    const priorAudits = structuredClone(audits);
    const dashboard = async (query = '') => (await (await call('/dashboard' + query)).json());
    assert.equal((await dashboard()).revenueIdr, 10000);
    assert.equal((await dashboard('?from=2026-11-10T00:00:00.000Z&to=2026-11-10T00:00:00.000Z')).revenueIdr, 10000);
    assert.equal((await dashboard('?from=2026-11-11T00:00:00.000Z')).revenueIdr, 0);
    signedIn = users.find(u => u.id === 'staff')!; const reads = ledgerReads;
    assert.equal('revenueIdr' in await dashboard(), false); assert.equal(ledgerReads, reads); signedIn = users[0]!;
    for (const status of ['PENDING', 'PROCESSING']) {
      event!.status = status;
      assert.equal((await call('/orders/order', 'DELETE', confirmed)).status, 409);
    }
    event!.status = 'SENT'; processingAttempt = true;
    assert.equal((await call('/orders/order', 'DELETE', confirmed)).status, 409); processingAttempt = false;
    const evidence = JSON.stringify(event);
    failDelete = true;
    const dependency = await call('/orders/order', 'DELETE', confirmed); assert.equal(dependency.status, 409); assert.equal((await dependency.json()).error.code, 'DELETE_DEPENDENCY');
    assert.ok(await fake.order.findUnique({ where: { id: 'order' } })); assert.equal(itemRows.length, 1); for (const rows of Object.values(childRows)) assert.equal(rows.length, 1); assert.equal(audits.filter(a => a.action === 'ORDER_DELETED').length, 0);
    assert.deepEqual(ledgerRows, ledgerEvidence);
    failDelete = false; failAudit = true;
    assert.equal((await call('/orders/order', 'DELETE', confirmed)).status, 500);
    assert.deepEqual(ledgerRows, ledgerEvidence); assert.equal(event!.orderId, 'order');
    assert.ok(await fake.order.findUnique({ where: { id: 'order' } })); assert.equal(itemRows.length, 1);
    failAudit = false;
    const deletionKey = crypto.randomUUID();
    const concurrent = await Promise.all([call('/orders/order', 'DELETE', confirmed, deletionKey), call('/orders/order', 'DELETE', confirmed)]);
    assert.deepEqual(concurrent.map(r => r.status).sort(), [200, 404]);
    assert.deepEqual(ledgerRows, ledgerEvidence.map(p => ({ ...p, orderId: null })));
    assert.deepEqual(audits.slice(0, priorAudits.length), priorAudits);
    assert.equal((await dashboard()).revenueIdr, 0); assert.equal((await dashboard()).activeOrders, 0);
    assert.equal((await dashboard('?from=2026-11-10T00:00:00.000Z&to=2026-11-10T00:00:00.000Z')).revenueIdr, 0);
    assert.equal((await call('/orders/order/payments', 'POST', paymentInput)).status, 404);
    assert.deepEqual(await (await call('/orders/order', 'DELETE', confirmed, deletionKey)).json(), { id: 'order', deleted: true });
    assert.equal((await call('/orders/order', 'DELETE', { confirmed: true, confirmation: 'HAPUS', extra: true }, deletionKey)).status, 400);
    assert.equal(audits.filter(a => a.action === 'ORDER_DELETED').length, 1);
    assert.equal(await fake.order.findUnique({ where: { id: 'order' } }), null);
    assert.equal((await call('/orders/order')).status, 404); assert.equal((await call('/track/' + raw)).status, 404);
    assert.equal(JSON.stringify({ ...event, orderId: 'order' }), evidence); assert.equal(event!.orderId, null); assert.equal(itemRows.length, 0); for (const rows of Object.values(childRows)) assert.equal(rows.length, 0); assert.equal(attempts, 0);
    // Reinsert an isolated fixture: fully refunded order still deletes, preserving both entries.
    orderRows.push(order); order.payments = [];
    assert.equal((await call('/orders/order/payments', 'POST', paymentInput)).status, 201);
    assert.equal((await call('/orders/order/refunds', 'POST', { ...paymentInput, reason: 'Actual refund', receivedAt: '2026-11-11T00:00:00.000Z' })).status, 201);
    const refundedEvidence = structuredClone(ledgerRows);
    assert.equal((await dashboard()).revenueIdr, 0);
    assert.equal((await dashboard('?to=2026-11-10T00:00:00.000Z')).revenueIdr, 10000);
    assert.equal((await dashboard('?from=2026-11-11T00:00:00.000Z')).revenueIdr, -10000);
    const writesVsDelete = await Promise.all([call('/orders/order', 'DELETE', confirmed), call('/orders/order/payments', 'POST', paymentInput)]);
    assert.equal(writesVsDelete[0]!.status, 200); assert.equal(writesVsDelete[1]!.status, 404);
    assert.deepEqual(ledgerRows, refundedEvidence.map(p => ({ ...p, orderId: null })));
    assert.equal((await dashboard()).revenueIdr, 0);
    assert.equal((await dashboard('?from=2026-11-11T00:00:00.000Z')).revenueIdr, 0);
    assert.equal(audits.filter(a => a.action === 'ORDER_DELETED').length, 2);
    assert.equal((await call('/customers/customer', 'DELETE', confirmed)).status, 200);
    assert.equal((await (await call('/customers')).json()).data.length, 0);
    assert.equal((await call('/pricing/plans/plan', 'DELETE', confirmed)).status, 200);
    assert.equal((await (await call('/pricing/plans')).json()).length, 0);
    audits.push({ actorUserId: 'staff', action: 'LOGIN_SUCCEEDED', occurredAt: new Date() }, { actorUserId: 'staff', action: 'API_ERROR', metadata: { status: 403 } });
    const historicalAudits = structuredClone(audits);
    fake.auditLog.count = async () => audits.filter(a => a.actorUserId === 'staff').length;
    for (const [table, where] of [['orderItem', { assignedUserId: 'staff' }], ['inspection', { actorUserId: 'staff' }], ['statusHistory', { actorUserId: 'staff' }], ['payment', { actorUserId: 'staff' }]] as const) {
      const originalCount = fake[table].count;
      fake[table].count = async (query: Row) => { assert.deepEqual(query.where, where); return 1; };
      try {
        const blocked = await call('/users/staff', 'DELETE', confirmed);
        assert.equal(blocked.status, 409); assert.equal((await blocked.json()).error.code, 'USER_HAS_HISTORY');
        assert.equal(deletedSessions, 0); assert.ok(users.some(u => u.id === 'staff')); assert.deepEqual(audits, historicalAudits);
      } finally { fake[table].count = originalCount; }
    }
    const userDeletionKey = crypto.randomUUID();
    assert.equal((await call('/users/staff', 'DELETE', confirmed, userDeletionKey)).status, 200); assert.equal(deletedSessions, 1); assert.equal(users.some(u => u.id === 'staff'), false);
    assert.deepEqual(audits.slice(0, historicalAudits.length), historicalAudits);
    assert.deepEqual(audits.at(-1), { actorUserId: 'owner', action: 'USER_DELETED', entityType: 'User', entityId: 'staff', metadata: { confirmed: true } });
    const auditCount = audits.length;
    assert.deepEqual(await (await call('/users/staff', 'DELETE', confirmed, userDeletionKey)).json(), { id: 'staff', deleted: true });
    assert.equal(deletedSessions, 1); assert.equal(audits.length, auditCount);
    const results = await Promise.allSettled([
      fake.$transaction((t: never) => deletion(t, 'users', 'other', confirmed, actor)),
      fake.$transaction((t: never) => userWrite(t, { isActive: false }, { id: 'other', role: 'OWNER' }, 'owner')),
    ]);
    assert.equal(results.filter(r => r.status === 'fulfilled').length, 1); assert.match(String((results.find(r => r.status === 'rejected') as PromiseRejectedResult).reason), /LAST_OWNER/);
    assert.ok(locks.some(l => l.includes("role = 'OWNER' ORDER BY id FOR UPDATE")));
    assert.deepEqual(audits.find(a => a.action === 'ORDER_DELETED'), { actorUserId: 'owner', action: 'ORDER_DELETED', entityType: 'Order', entityId: 'order', metadata: { confirmed: true } });
    const eventLock = locks.findIndex(l => l.includes('NotificationEvent') && l.includes('FOR UPDATE'));
    assert.ok(eventLock > 0); assert.match(locks[eventLock - 1]!, /FROM `Order`.*FOR UPDATE/);
    const migration = readFileSync(new URL('../prisma/migrations/202611110012_detached_payment_ledger/migration.sql', import.meta.url), 'utf8');
    assert.match(migration, /ON DELETE SET NULL/); assert.match(migration, /originalOrderNumber.*NOT NULL/);
    assert.doesNotMatch(migration, /SET[^;]*(?:amountIdr|method|reason|actorUserId|receivedAt|createdAt)/);
    const sql = readFileSync(new URL('../prisma/migrations/202611110011_salutation_archives/migration.sql', import.meta.url), 'utf8');
    assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE|DROP|TRUNCATE)\b/); assert.match(sql, /DEFAULT 'Kak'/);
  } finally { await new Promise<void>(r => server.close(() => r())); hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.deletion.fake')); }
});
