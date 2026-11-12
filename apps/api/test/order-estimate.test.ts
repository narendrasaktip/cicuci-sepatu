import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

// All persistence and WhatsApp control are replaced before importing application modules.
test('automatic estimate: calendar boundaries, server creation clock, legacy validation, replay and edit', async t => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  let order: Record<string, unknown> = {}; let creates = 0; let histories = 0; let events = 0;
  const cache = new Map<string, object>();
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role: 'OWNER', isActive: true }, csrfToken: 'csrf', expiresAt: new Date('2100-01-01') }) },
    customer: { count: async () => 1 },
    service: { findUnique: async () => ({ name: 'Clean', isActive: true, basePriceIdr: 50000 }) },
    storeSettings: { findUnique: async () => null },
    order: {
      create: async ({ data }: { data: object }) => { creates++; order = { ...data, id: `order-${creates}`, customer: { notificationConsentAt: null, whatsapp: '+620000000' }, items: [], payments: [] }; return order; },
      findUnique: async () => order, findUniqueOrThrow: async () => order,
      update: async ({ data }: { data: object }) => Object.assign(order, data),
    },
    orderItem: { create: async () => ({ id: 'shoe' }), findMany: async () => [{ status: 'RECEIVED' }] },
    statusHistory: { create: async () => { histories++; return {}; } },
    auditLog: { create: async () => ({}) },
    notificationEvent: { findUnique: async () => null, upsert: async () => { events++; return { id: 'event', status: 'SKIPPED' }; } },
    notificationAttempt: { findFirst: async () => ({ response: { reason: 'NO_CURRENT_OPT_IN' } }) },
    idempotency: {
      findUnique: async ({ where }: { where: { id: string } }) => cache.get(where.id),
      create: async ({ data }: { data: { id: string } }) => { cache.set(data.id, data); return data; },
      update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign(cache.get(where.id)!, data),
    },
    $queryRaw: async () => [{ id: order.id }],
    $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  Reflect.set(globalThis, Symbol.for('cicuci.estimate.test'), fake);
  const hook = registerHooks({ resolve(s, context, next) {
    if (s.endsWith('/controllers/whatsapp.js')) return { url: 'data:text/javascript,export const whatsapp=(_req,_res,next)=>next();', shortCircuit: true };
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.estimate.test")];', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, context);
  } });
  try {
    const { completionEstimate } = await import('../src/services/orders.js');
    const cases = [
      ['2026-11-10T11:59:00+07:00', '2026-11-14'],
      ['2026-11-10T11:59:59.999+07:00', '2026-11-14'],
      ['2026-11-10T12:00:00+07:00', '2026-11-15'],
      ['2026-11-10T23:59:59+07:00', '2026-11-15'],
      ['2026-11-11T00:00:00+07:00', '2026-11-15'],
      ['2026-01-29T11:59:00+07:00', '2026-02-02'],
      ['2026-12-29T12:00:00+07:00', '2027-01-03'],
      ['2028-02-25T11:59:00+07:00', '2028-02-29'],
      ['2028-02-25T12:00:00+07:00', '2028-03-01'],
      ['2027-02-25T11:59:00+07:00', '2027-03-01'],
      ['2026-11-09T21:59:00-07:00', '2026-11-14'],
      ['2026-11-10T05:00:00Z', '2026-11-15'],
    ];
    const originalTZ = process.env.TZ;
    try {
      for (const timezone of ['UTC', 'America/Los_Angeles', 'Asia/Jakarta']) {
        process.env.TZ = timezone;
        for (const [input, date] of [
          ['2026-11-09T16:59:00+07:00', '2026-11-10'],
          ['2026-11-09T17:00:00+07:00', '2026-11-10'],
          ['2026-11-09T17:00:00.001+07:00', '2026-11-11'],
          ['2026-11-09T23:59:59.999+07:00', '2026-11-11'],
          ['2026-11-10T00:00:00+07:00', '2026-11-11'],
          ['2026-01-31T17:00:00+07:00', '2026-02-01'],
          ['2026-12-31T17:00:00.001+07:00', '2027-01-02'],
          ['2028-02-28T17:00:00+07:00', '2028-02-29'],
          ['2028-02-28T17:00:00.001+07:00', '2028-03-01'],
          ['2027-02-28T17:00:00+07:00', '2027-03-01'],
          ['2026-11-13T17:00:00+07:00', '2026-11-14'],
          ['2026-11-14T17:00:00+07:00', '2026-11-15'],
          ['2026-11-09T10:00:00Z', '2026-11-10'],
          ['2026-11-09T02:00:00-08:00', '2026-11-10'],
        ]) {
          const created = new Date(input!); const before = created.getTime();
          assert.equal(completionEstimate(created, 'FAST').toISOString(), `${date}T10:00:00.000Z`, `${timezone}: ${input}`);
          assert.equal(created.getTime(), before);
        }
        for (const [input, date] of cases) {
          const created = new Date(input!); const before = created.getTime();
          assert.equal(completionEstimate(created).toISOString(), `${date}T16:59:59.999Z`, `${timezone}: ${input}`);
          assert.equal(created.getTime(), before);
        }
      }
    } finally { if (originalTZ === undefined) delete process.env.TZ; else process.env.TZ = originalTZ; }
    const { app } = await import('../src/app.js');
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const body = { customerId: 'customer', items: [{ serviceId: 'service', brand: 'Nike', model: 'Air', color: 'White' }] };
    const call = (method: string, input: object, key = crypto.randomUUID(), suffix = '') => fetch(`http://127.0.0.1:${address.port}/api/v1/orders${suffix}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': 'csrf', 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-10T04:59:00Z') });
    try {
      const key = crypto.randomUUID();
      const response = await call('POST', body, key); assert.equal(response.status, 201);
      const saved = await response.json();
      assert.equal(saved.createdAt, '2026-11-10T04:59:00.000Z'); assert.equal(saved.estimatedCompletionAt, '2026-11-14T16:59:59.999Z');
      assert.equal(saved.notification.actualOutbound, false);
      t.mock.timers.setTime(new Date('2026-11-10T05:00:00Z').getTime());
      const replay = await call('POST', body, key); assert.equal(replay.status, 201); assert.deepEqual(await replay.json(), saved);
      assert.equal(creates, 1); assert.equal(histories, 1); assert.equal(events, 1);
      const legacy = { ...body, estimatedCompletionAt: '2000-01-01T00:00:00.000Z' };
      const after = await call('POST', legacy); assert.equal(after.status, 201);
      assert.equal((await after.json()).estimatedCompletionAt, '2026-11-15T16:59:59.999Z');
      assert.equal((await call('POST', { ...body, estimatedCompletionAt: 'invalid' })).status, 400);
      assert.equal((await call('POST', legacy, key)).status, 409);
      const edited = await call('PATCH', { estimatedCompletionAt: '2026-12-01T10:00:00.000Z' }, crypto.randomUUID(), '/order-2');
      assert.equal(edited.status, 200); assert.equal((await edited.json()).estimatedCompletionAt, '2026-12-01T10:00:00.000Z');
    } finally { t.mock.timers.reset(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  } finally { hook.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.estimate.test')); }
});
