import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

test('broadcast owner/CSRF/strict input, readiness, preview, durable dedup, current consent and ambiguous delivery', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  let role = 'OWNER'; let readiness = true; let version: number | undefined = 1; let activation: string | null = 'active'; let snapshots = 0;
  const customer = { id: 'customer', name: 'Pelanggan Uji', whatsapp: '+6281234567890', notificationConsentAt: new Date(), archivedAt: null };
  const customers = [customer, { ...customer, id: 'customer-2', name: 'Pelanggan Kedua', whatsapp: '+6281234567891' }];
  const audits: Record<string, unknown>[] = []; const events: Record<string, unknown>[] = []; const cache = new Map<string, Record<string, unknown>>();
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) => Object.entries(where).every(([k, v]) => row[k] === v);
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) }) },
    user: { findUnique: async () => ({ role, isActive: true }) },
    storeSettings: { findUnique: async () => ({ waActivation: activation }) },
    customer: { findMany: async ({ where }: { where: unknown }) => { assert.deepEqual(where, { archivedAt: null, notificationConsentAt: { not: null } }); return customers; }, findUnique: async ({ where }: { where: { id: string } }) => customers.find(c => c.id === where.id) },
    idempotency: { findUnique: async ({ where }: { where: { id: string } }) => cache.get(where.id), create: async ({ data }: { data: Record<string, unknown> }) => { cache.set(String(data.id), data); }, update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(cache.get(where.id)!, data) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return data; }, findFirst: async ({ where }: { where: Record<string, unknown> }) => audits.find(a => matches(a, where)), findMany: async () => [] },
    notificationEvent: {
      create: async ({ data }: { data: Record<string, unknown> }) => { assert.ok(!events.some(e => e.eventKey === data.eventKey)); const event = { id: `e${events.length}`, generation: 0, nextAttemptAt: new Date(0), order: null, attempts: [], ...data }; events.push(event); return event; },
      findUnique: async ({ where }: { where: { id: string } }) => events.find(e => e.id === where.id), findUniqueOrThrow: async ({ where }: { where: { id: string } }) => events.find(e => e.id === where.id)!,
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(events.find(e => e.id === where.id)!, data), findMany: async () => events,
    },
    notificationAttempt: {
      create: async ({ data }: { data: Record<string, unknown> }) => { (events.find(e => e.id === data.eventId)!.attempts as object[]).push(data); },
      update: async ({ where, data }: { where: { eventId_attemptNo: { eventId: string; attemptNo: number } }; data: object }) => { const attempts = events.find(e => e.id === where.eventId_attemptNo.eventId)!.attempts as { attemptNo: number }[]; Object.assign(attempts.find(a => a.attemptNo === where.eventId_attemptNo.attemptNo)!, data); },
    },
    $queryRaw: async () => [], $executeRaw: async () => 1, $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  Reflect.set(globalThis, Symbol.for('broadcast.db'), fake);
  Reflect.set(globalThis, Symbol.for('broadcast.ready'), () => { snapshots++; return { ready: readiness, realSendEnabled: readiness, activation: 'active', broadcastVersion: version }; });
  const hook = registerHooks({ resolve(s, c, next) {
    if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("broadcast.db")];', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,' + encodeURIComponent('export const workerSnapshot=async()=>globalThis[Symbol.for("broadcast.ready")](); export const notificationBlocker=async()=>"NOT_ENABLED"; export const controlQueue=()=>{throw Error("LIVE_QUEUE_FORBIDDEN")}; export const controlRedis=controlQueue; export const sign=controlQueue; export const lockKey="fixture";'), shortCircuit: true };
    return next(s, c);
  } });
  const { app } = await import('../src/app.js'); const { deliverNotification } = await import('../src/services/notifications.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (suffix: string, body?: unknown, csrf = 'csrf', key = crypto.randomUUID()) => fetch(`http://127.0.0.1:${address.port}/api/v1/whatsapp-broadcasts${suffix}`, { method: body ? 'POST' : 'GET', headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const input = { message: 'Halo {customer_name}, toko tutup sementara untuk pemeliharaan.', scope: 'SERVICE_INFORMATION' };
  try {
    assert.equal((await call('/preview', input, 'bad')).status, 403);
    for (role of ['STAFF', 'ADMIN']) { assert.equal((await call('/preview', input)).status, 403); assert.equal((await call('')).status, 403); }
    role = 'OWNER'; assert.equal((await call('/preview', { ...input, extra: true })).status, 400);
    assert.equal((await call('/preview', { ...input, scope: 'PROMOTION' })).status, 400);
    assert.equal((await call('/preview', { ...input, message: 'Halo {order_number}' })).status, 400);
    activation = null; readiness = false;
    const response = await call('/preview', input); assert.equal(response.status, 201); const preview = await response.json();
    assert.equal(preview.recipients.length, 2); assert.equal(events.length, 0); assert.equal(snapshots, 0);
    for (const [index, recipient] of customers.entries()) assert.equal(preview.recipients[index].message, input.message.replace('{customer_name}', recipient.name));
    const confirmation = { previewId: preview.id, confirmed: true, serviceOnly: true };
    const disabled = await call('/confirm', confirmation); assert.equal(disabled.status, 409); assert.equal((await disabled.json()).error.code, 'NOT_ENABLED');
    assert.equal(events.length, 0); assert.equal(snapshots, 0);
    activation = 'active'; assert.equal((await call('/confirm', confirmation)).status, 503); assert.equal(events.length, 0);
    readiness = true; version = undefined; assert.equal((await call('/confirm', confirmation)).status, 503); assert.equal(events.length, 0); version = 1;
    assert.equal((await call('/confirm', { ...confirmation, confirmed: false })).status, 400);
    const { previewBroadcast, confirmBroadcast } = await import('../src/services/whatsapp-broadcasts.js');
    const { seal, unseal } = await import('../src/services/whatsapp-templates.js');
    const previewMetadata = audits.find(a => a.entityId === preview.id)!.metadata as { sealed: string };
    assert.equal('activation' in (unseal(previewMetadata.sealed) as object), false);
    const old = await previewBroadcast(fake as unknown as Parameters<typeof previewBroadcast>[0], input as Parameters<typeof previewBroadcast>[1], 'owner');
    const oldMetadata = audits.find(a => a.entityId === old.id)!.metadata as { sealed: string };
    oldMetadata.sealed = seal({ ...(unseal(oldMetadata.sealed) as object), activation: 'old-activation' });
    await assert.rejects(confirmBroadcast(fake as unknown as Parameters<typeof confirmBroadcast>[0], { previewId: old.id, confirmed: true, serviceOnly: true }, 'owner'), /ACTIVATION_CHANGED/);
    assert.equal(events.length, 0);
    const expired = await previewBroadcast(fake as unknown as Parameters<typeof previewBroadcast>[0], input as Parameters<typeof previewBroadcast>[1], 'owner');
    const expiredRecord = audits.find(a => a.entityId === expired.id)!;
    const metadata = expiredRecord.metadata as { sealed: string };
    metadata.sealed = seal({ ...(unseal(metadata.sealed) as object), expiresAt: 0 });
    await assert.rejects(confirmBroadcast(fake as unknown as Parameters<typeof confirmBroadcast>[0], { previewId: expired.id, confirmed: true, serviceOnly: true }, 'owner'), /BROADCAST_PREVIEW_EXPIRED/);
    assert.equal(events.length, 0);
    const originalNumber = customer.whatsapp; customer.whatsapp = '+6280000000000';
    assert.equal((await call('/confirm', confirmation)).status, 409); assert.equal(events.length, 0); customer.whatsapp = originalNumber;
    const consentAt = customer.notificationConsentAt; customer.notificationConsentAt = null as unknown as Date;
    assert.equal((await call('/confirm', confirmation)).status, 409); assert.equal(events.length, 0); customer.notificationConsentAt = consentAt;
    const key = crypto.randomUUID(); assert.equal((await call('/confirm', confirmation, 'csrf', key)).status, 202);
    assert.equal((await call('/confirm', confirmation, 'csrf', key)).status, 202);
    assert.equal((await call('/confirm', confirmation)).status, 202); assert.equal(events.length, 2);
    for (const [index, recipient] of customers.entries()) {
      const queued = events[index]!;
      assert.equal(queued.eventKey, `broadcast:${preview.id}:${recipient.id}`);
      assert.equal(queued.recipient, recipient.whatsapp); assert.equal(queued.status, 'PENDING'); assert.equal(queued.activation, 'active');
      assert.deepEqual(unseal(String(queued.encryptedMessage)), { kind: 'SERVICE_BROADCAST', campaignId: preview.id, customerId: recipient.id, message: preview.recipients[index].message });
      assert.ok(!queued.orderId); assert.doesNotMatch(String(queued.encryptedMessage), /pemeliharaan/);
    }
    const event = events[0]!; let sends = 0;
    const provider = { activation: 'active', ready: true, send: async () => { sends++; return { messageId: 'fake' }; } };
    customer.notificationConsentAt = null as unknown as Date;
    await deliverNotification(String(event.id), 0, provider); assert.equal(event.status, 'SKIPPED'); assert.equal(sends, 0);
    assert.equal(((event.attempts as { response: { reason: string } }[])[0]!.response).reason, 'NO_CURRENT_OPT_IN');
    customer.notificationConsentAt = new Date(); event.status = 'PENDING'; customer.whatsapp = '+6280000000000';
    await deliverNotification(String(event.id), 0, provider); assert.equal(event.status, 'SKIPPED'); assert.equal(sends, 0);
    event.status = 'PENDING'; customer.whatsapp = originalNumber;
    await deliverNotification(String(event.id), 0, provider); assert.equal(event.status, 'SENT'); assert.equal(sends, 1);
    await deliverNotification(String(event.id), 0, provider); assert.equal(sends, 1);
    event.status = 'PENDING'; event.attempts = [];
    await deliverNotification(String(event.id), 0, { ...provider, send: async () => { sends++; throw new Error('ambiguous fake'); } });
    assert.equal(event.status, 'FAILED'); assert.equal((event.attempts as { response: { actualOutbound: string } }[])[0]!.response.actualOutbound, 'unknown');
    await deliverNotification(String(event.id), 0, provider); assert.equal(sends, 2);
    const report = await call(`/${preview.id}`); assert.equal(report.status, 200); assert.equal((await report.json()).recipients[0].status, 'FAILED');
  } finally { await new Promise<void>(r => server.close(() => r())); hook.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('broadcast.db')); Reflect.deleteProperty(globalThis, Symbol.for('broadcast.ready')); }
});
