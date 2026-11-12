import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import { packageRates, packageTotal } from '../src/services/pricing.js';

test('smart intake HTTP: canonical identity, omitted service, explicit validation, replay, legacy, roles; isolated persistence', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://example.test';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>; // Test-only in-memory Prisma rows.
  const services = new Map<string, Row>([['historical', { id: 'historical', name: 'Unrelated restoration', basePriceIdr: 900000, isActive: true }]]);
  const historical = structuredClone(services.get('historical'));
  let order: Row = {}; let creates = 0; let serviceCreates = 0; let role = 'OWNER';
  const cache = new Map<string, Row>();
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date('2100-01-01') }) },
    customer: { count: async () => 1 },
    service: {
      findUnique: async ({ where }: Row) => services.get(where.id),
      upsert: async ({ where, create, update }: Row) => { assert.deepEqual(update, {}); if (!services.has(where.id)) { serviceCreates++; services.set(where.id, { ...create }); } return services.get(where.id); },
      update: async ({ where, data }: Row) => Object.assign(services.get(where.id)!, data),
    },
    storeSettings: { findUnique: async () => null },
    order: {
      create: async ({ data }: Row) => { creates++; order = { ...data, id: `order-${creates}`, customer: { notificationConsentAt: null, whatsapp: '+620000000' }, items: [], payments: [] }; return order; },
      findUnique: async () => order, findUniqueOrThrow: async () => order,
      update: async ({ data }: Row) => Object.assign(order, data),
    },
    orderItem: {
      create: async ({ data }: Row) => { const item = { ...data, id: `item-${order.items.length}`, status: 'RECEIVED', outcome: null, finalPriceIdr: 0 }; order.items.push(item); return item; },
      findMany: async () => order.items,
      update: async ({ where, data }: Row) => Object.assign(order.items.find((i: Row) => i.id === where.id), data),
    },
    statusHistory: { create: async () => ({}) }, auditLog: { create: async () => ({}) },
    notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event', status: 'SKIPPED' }) },
    notificationAttempt: { findFirst: async () => ({ response: { reason: 'NO_CURRENT_OPT_IN' } }) },
    idempotency: {
      findUnique: async ({ where }: Row) => cache.get(where.id),
      create: async ({ data }: Row) => { cache.set(data.id, data); return data; },
      update: async ({ where, data }: Row) => Object.assign(cache.get(where.id)!, data),
    },
    $queryRaw: async () => [{ id: order.id }],
    $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  Reflect.set(globalThis, Symbol.for('cicuci.internal.test'), fake);
  const hooks = registerHooks({ resolve(s, context, next) {
    if (s.endsWith('/controllers/whatsapp.js')) return { url: 'data:text/javascript,export const whatsapp=(_req,_res,next)=>next();', shortCircuit: true };
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.internal.test")];', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, context);
  } });
  try {
    const { app } = await import('../src/app.js');
    const { cleaningService } = await import('../src/services/orders.js');
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = (path: string, method = 'GET', input?: object, key = crypto.randomUUID()) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': 'csrf', 'Idempotency-Key': key, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const item = { brand: 'Nike', model: 'Air', color: 'White' };
    const body = { customerId: 'customer', rateMode: 'PROMO', items: [item, item, item] };
    try {
      const key = crypto.randomUUID();
      const response = await call('/orders', 'POST', body, key); assert.equal(response.status, 201);
      const saved = await response.json();
      assert.equal(saved.pricing.serviceId, cleaningService.id); assert.equal(saved.totalIdr, 130000);
      assert.ok(saved.items.every((i: Row) => i.serviceId === cleaningService.id && i.serviceName === cleaningService.name));
      assert.equal(serviceCreates, 1); assert.equal(creates, 1);
      assert.deepEqual(await (await call('/orders', 'POST', body, key)).json(), saved); assert.equal(creates, 1);
      assert.equal((await call('/orders', 'POST', { ...body, rateMode: 'NORMAL', packageServiceId: cleaningService.id, items: [{ ...item, serviceId: cleaningService.id }] })).status, 201);
      assert.equal(serviceCreates, 1); assert.equal(order.pricing.totalIdr, 50000);
      for (const bad of [
        { ...body, packageServiceId: 'historical' },
        { ...body, items: [{ ...item, serviceId: 'historical' }] },
        { ...body, items: [{ ...item, quotedPriceIdr: 1 }] },
      ]) assert.equal((await call('/orders', 'POST', bad)).status, 409);
      assert.equal((await call('/orders', 'POST', { ...body, packageServiceId: '' })).status, 400);
      assert.equal((await call('/orders', 'POST', { ...body, items: [{ ...item, serviceId: 42 }] })).status, 400);
      assert.equal((await call('/orders', 'POST', { customerId: 'customer', items: [item] })).status, 409);
      assert.equal((await call('/orders', 'POST', { customerId: 'customer', items: [{ ...item, serviceId: 'historical', quotedPriceIdr: 12345 }] })).status, 201);
      assert.equal(order.pricing, undefined); assert.equal(order.items[0].quotedPriceIdr, 12345);
      assert.deepEqual(services.get('historical'), historical);
      assert.equal((await call(`/services/${cleaningService.id}`, 'PATCH', { name: 'Changed' })).status, 409);
      const canonical = services.get(cleaningService.id)!;
      for (const change of [{ isActive: false }, { name: 'Other' }, { basePriceIdr: 1 }]) {
        Object.assign(canonical, cleaningService, change);
        const before: number = creates;
        assert.equal((await call('/orders', 'POST', body)).status, 409); assert.equal(creates, before);
        assert.deepEqual(canonical, { ...cleaningService, ...change });
      }
      Object.assign(canonical, cleaningService);
      const rates = await (await call('/pricing/rates')).json(); assert.deepEqual(rates, packageRates());
      for (const row of rates) { const count = parseInt(row.pairs); assert.equal(row.promoIdr * (row.perPair ? count : 1), packageTotal(count, 'PROMO')); }
      for (const nextRole of ['ADMIN', 'STAFF']) {
        role = nextRole;
        assert.equal((await call('/pricing/rates')).status, 200);
        assert.equal((await call('/orders', 'POST', body)).status, role === 'ADMIN' ? 201 : 403);
        assert.equal((await call('/services/historical', 'PATCH', { name: 'Changed' })).status, 403);
      }
    } finally { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
  } finally { hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.internal.test')); }
});
