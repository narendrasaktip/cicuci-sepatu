import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('optional shoe details HTTP: create/add normalize; partial edit preserves; brand/type/length guards', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://example.test';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>; // Test-only in-memory Prisma rows.
  const services = new Map<string, Row>([['historical', { id: 'historical', name: 'Unrelated restoration', basePriceIdr: 900000, isActive: true }]]);
  let order: Row = {}; let creates = 0; const role = 'OWNER';
  const cache = new Map<string, Row>();
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date('2100-01-01') }) },
    customer: { count: async () => 1 },
    service: {
      findUnique: async ({ where }: Row) => services.get(where.id),
      upsert: async ({ where, create, update }: Row) => { assert.deepEqual(update, {}); if (!services.has(where.id)) { services.set(where.id, { ...create }); } return services.get(where.id); },
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
      findUnique: async ({ where }: Row) => { const item = order.items.find((i: Row) => i.id === where.id); return item ? { ...item, order } : null; },
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
  Reflect.set(globalThis, Symbol.for('cicuci.optional.test'), fake);
  const hooks = registerHooks({ resolve(s, context, next) {
    if (s.endsWith('/controllers/whatsapp.js')) return { url: 'data:text/javascript,export const whatsapp=(_req,_res,next)=>next();', shortCircuit: true };
    if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.optional.test")];', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw new Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, context);
  } });
  try {
    const { app } = await import('../src/app.js');
    const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
    const address = server.address(); assert.ok(address && typeof address !== 'string');
    const call = (path: string, method = 'GET', input?: object, key = crypto.randomUUID()) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': 'csrf', 'Idempotency-Key': key, 'Content-Type': 'application/json' }, ...(input ? { body: JSON.stringify(input) } : {}) });
    const item = { serviceId: 'historical', brand: 'Nike' };
    const create = (shoe: object) => call('/orders', 'POST', { customerId: 'customer', items: [shoe] });
    try {
      for (const details of [{}, { model: '', color: '' }, { model: '   ', color: '   ' }, { model: 'x'.repeat(100), color: 'y'.repeat(100) }]) {
        let response = await create({ ...item, ...details });
        assert.equal(response.status, 201, JSON.stringify(await response.json()));
        assert.equal(order.items[0].model, details.model?.trim() ?? '');
        assert.equal(order.items[0].color, details.color?.trim() ?? '');
        response = await call(`/orders/${order.id}/items`, 'POST', { ...item, ...details });
        assert.equal(response.status, 201, JSON.stringify(await response.json()));
        assert.equal(order.items[1].model, details.model?.trim() ?? '');
        assert.equal(order.items[1].color, details.color?.trim() ?? '');
      }
      const path = `/items/${order.items[0].id}`;
      assert.equal((await call(path, 'PATCH', { model: 'Air', color: 'White' })).status, 200);
      assert.equal((await call(path, 'PATCH', { brand: 'Adidas' })).status, 200);
      assert.equal(order.items[0].model, 'Air'); assert.equal(order.items[0].color, 'White');
      assert.equal((await call(path, 'PATCH', {})).status, 200);
      assert.equal(order.items[0].model, 'Air'); assert.equal(order.items[0].color, 'White');
      assert.equal((await call(path, 'PATCH', { model: '', color: '' })).status, 200);
      assert.equal(order.items[0].model, ''); assert.equal(order.items[0].color, '');
      for (const key of ['brand', 'model', 'color']) for (const value of [null, 42, {}, [], 'x'.repeat(101), ...(key === 'brand' ? ['', '   '] : [])]) {
        const bad = { ...item, [key]: value };
        assert.equal((await create(bad)).status, 400, `${key}: ${JSON.stringify(value)}`);
        assert.equal((await call(`/orders/${order.id}/items`, 'POST', bad)).status, 400);
        assert.equal((await call(path, 'PATCH', { [key]: value })).status, 400);
      }
      assert.equal((await create({ serviceId: 'historical' })).status, 400);
      assert.equal((await call(`/orders/${order.id}/items`, 'POST', { serviceId: 'historical' })).status, 400);
    } finally { await new Promise<void>(r => server.close(() => r())); }
  } finally { hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.optional.test')); }
});
