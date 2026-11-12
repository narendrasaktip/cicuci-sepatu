import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { Prisma } from '@prisma/client';
import { defaultRules, previewPricing, rateRules, planWrite, type RateRule } from '../src/services/rate-rules.js';
import { calculatePricing, packageTotal, planPricing, pricingSnapshot } from '../src/services/pricing.js';

test('default rules equal legacy totals n=0..50; breakdown reconciles; order independent', () => {
  for (const mode of ['PROMO', 'NORMAL'] as const) for (let n = 0; n <= 50; n++) {
    const rules = defaultRules(mode); const result = previewPricing(rules, n);
    assert.equal(result.totalIdr, packageTotal(n, mode));
    assert.equal(result.breakdown.reduce((sum, b) => sum + b.totalIdr, 0), result.totalIdr);
    assert.equal(result.breakdown.reduce((sum, b) => sum + b.quantity * b.pairs, 0), n);
    assert.deepEqual(previewPricing([...rules].reverse(), n), result);
  }
});
const pack = (n: number, priceIdr: number): RateRule => ({ kind: 'PACKAGE', minPairs: n, maxPairs: n, priceIdr });
test('minimum exact package combination, deterministic tie, range precedence, missing package baseline rejects', () => {
  const rules = [pack(1, 100), pack(3, 200), pack(4, 290)];
  assert.equal(previewPricing(rules, 6).totalIdr, 400);
  assert.equal(previewPricing(rules, 8).totalIdr, 580);
  assert.deepEqual(previewPricing(rules, 6), previewPricing([...rules].reverse(), 6));
  assert.equal(previewPricing([...rules, { kind: 'PER_PAIR', minPairs: 6, maxPairs: null, priceIdr: 200 }], 6).totalIdr, 1200);
  const baseline: RateRule = { kind: 'PER_PAIR', minPairs: 1, maxPairs: 1, priceIdr: 100 };
  assert.throws(() => previewPricing([baseline, pack(3, 200)], 4), /Single-pair PACKAGE baseline required/);
  assert.throws(() => previewPricing([{ ...baseline, maxPairs: null }], 50), /Single-pair PACKAGE baseline required/);
  const bounded = [pack(1, 100), { ...baseline, minPairs: 2, maxPairs: 3, priceIdr: 10 }];
  assert.equal(previewPricing(bounded, 3).totalIdr, 30);
  assert.equal(previewPricing(bounded, 4).totalIdr, 400);
  assert.equal(previewPricing([pack(1, 1)], 50).totalIdr, 50);
  for (const kind of ['PACKAGE', 'PER_PAIR'] as const) assert.equal(rateRules.safeParse([pack(1, 1), { kind, minPairs: 2, maxPairs: 2, priceIdr: 0 }]).success, false);
});
test('strict rules/name/bounds validation and safe signed Int totals', () => {
  const valid = defaultRules('PROMO');
  for (const rules of [[], [pack(2, 1)], [pack(1, 1), pack(1, 2)], [{ ...pack(1, 1), maxPairs: null }], [pack(1, -1)], [pack(1.5, 1)], [pack(1, 1), pack(51, 1)], [pack(1, 100000001)], [pack(1, 100000000)], [...valid, { kind: 'PER_PAIR', minPairs: 8, maxPairs: 12, priceIdr: 1 }], [...valid, pack(6, 1)], [pack(1, 1), { kind: 'PER_PAIR', minPairs: 3, maxPairs: 2, priceIdr: 1 }], [{ ...pack(1, 1), extra: true }]]) assert.equal(rateRules.safeParse(rules).success, false, JSON.stringify(rules));
  for (const name of ['', ' '.repeat(3), 'x'.repeat(101)]) assert.equal(planWrite.safeParse({ name, isActive: true, rules: valid }).success, false);
  for (const n of [-1, 0.1, 51, NaN]) assert.throws(() => previewPricing(valid, n));
});
test('v2 snapshot immutable across catalog edits, accepted 5 to 4, pending consent, locked cancellation', () => {
  const plan = { id: 'plan', name: 'Christmast', revision: 1, rules: defaultRules('PROMO') };
  const snapshot = planPricing(plan, 'internal', 5);
  plan.name = 'Edited'; plan.rules[0]!.priceIdr = 1;
  const items = Array.from({ length: 5 }, (_, i) => ({ id: String(i), status: 'QUEUED', outcome: 'APPROVED' }));
  items[4]!.outcome = 'REJECTED';
  const final = calculatePricing(snapshot, items); assert.equal(final.totalIdr, 175000); assert.equal(final.stage, 'FINAL');
  assert.equal(final.version === 2 && final.name, 'Christmast');
  items[3]!.status = 'AWAITING_CONSENT'; assert.equal(calculatePricing(final, items).stage, 'ESTIMATE');
  const locked = { ...final, stage: 'LOCKED' as const, agreedTotalIdr: final.totalIdr, agreedAllocations: final.allocations };
  items[0]!.outcome = 'DECLINED'; const cancelled = calculatePricing(locked, items);
  assert.equal(cancelled.allocations['0'], 0); assert.equal(cancelled.allocations['1'], locked.allocations['1']); assert.equal(cancelled.agreedTotalIdr, 175000);
});

test('named catalog + intake HTTP isolated: roles/CSRF/validation, revision lock, retry, snapshots and deactivation', async t => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://example.test';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type Row = Record<string, any>; // Isolated Prisma fixture, never live DB.
  let role = 'OWNER'; let order: Row = {}; let orderCreates = 0; let planCreates = 0; let updates = 0; let locks = 0;
  const plans = new Map<string, Row>(); const cache = new Map<string, Row>(); const services = new Map<string, Row>(); const audits: Row[] = [];
  const duplicate = () => { throw new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6' }); };
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date('2100-01-01') }) },
    customer: { count: async () => 1 },
    user: { findUnique: async () => ({ isActive: true, role }) },
    ratePlan: {
      findMany: async () => [...plans.values()], findUnique: async ({ where }: Row) => plans.get(where.id), findUniqueOrThrow: async ({ where }: Row) => plans.get(where.id),
      create: async ({ data }: Row) => { if ([...plans.values()].some(p => p.name.toLowerCase() === data.name.toLowerCase())) duplicate(); const p = { ...structuredClone(data), id: `plan-${++planCreates}`, revision: 1 }; plans.set(p.id, p); return p; },
      updateMany: async ({ where, data }: Row) => { const p = plans.get(where.id); if (!p || p.revision !== where.revision) return { count: 0 }; updates++; Object.assign(p, structuredClone(data), { revision: p.revision + 1 }); return { count: 1 }; },
    },
    service: { findUnique: async ({ where }: Row) => services.get(where.id), upsert: async ({ where, create }: Row) => { if (!services.has(where.id)) services.set(where.id, create); return services.get(where.id); } },
    storeSettings: { findUnique: async () => null },
    order: { create: async ({ data }: Row) => { order = { ...structuredClone(data), id: `order-${++orderCreates}`, customer: { notificationConsentAt: null }, items: [], payments: [] }; return order; }, findUnique: async () => order, findUniqueOrThrow: async () => order, update: async ({ data }: Row) => Object.assign(order, data) },
    orderItem: { create: async ({ data }: Row) => { const i = { ...data, id: `item-${order.items.length}`, status: 'RECEIVED', outcome: null, finalPriceIdr: 0, consents: [], photos: [], history: [] }; order.items.push(i); return i; }, findMany: async () => order.items, findUnique: async ({ where }: Row) => ({ ...order.items.find((i: Row) => i.id === where.id), order }), update: async ({ where, data }: Row) => Object.assign(order.items.find((i: Row) => i.id === where.id), data) },
    statusHistory: { create: async () => ({}) }, auditLog: { create: async ({ data }: Row) => { audits.push(structuredClone(data)); return {}; } },
    notificationEvent: { findUnique: async () => null, upsert: async () => ({ id: 'event', status: 'SKIPPED' }) }, notificationAttempt: { findFirst: async () => null },
    idempotency: { findUnique: async ({ where }: Row) => cache.get(where.id), create: async ({ data }: Row) => { cache.set(data.id, data); return data; }, update: async ({ where, data }: Row) => Object.assign(cache.get(where.id)!, data) },
    $queryRaw: async (sql: TemplateStringsArray) => { if (sql.join('').includes('RatePlan')) locks++; return [{ id: 'locked' }]; },
    $transaction: async (run: (tx: unknown) => unknown) => { const saved = structuredClone(cache); try { return await run(fake); } catch (e) { cache.clear(); saved.forEach((v, k) => cache.set(k, v)); throw e; } },
  };
  Reflect.set(globalThis, Symbol.for('cicuci.plans.test'), fake);
  const hooks = registerHooks({ resolve(s, c, next) {
    if (s.endsWith('/lib/config.js')) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://example.test",NODE_ENV:"test"};', shortCircuit: true };
    if (s.endsWith('/lib/db.js')) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.plans.test")];', shortCircuit: true };
    if (s.endsWith('/controllers/whatsapp.js')) return { url: 'data:text/javascript,export const whatsapp=(_q,_s,n)=>n();', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){throw Error("Forbidden WhatsApp access");}', shortCircuit: true };
    return next(s, c);
  } });
  const { app } = await import('../src/app.js'); const { reprice, confirmPricing, transition } = await import('../src/services/orders.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, method = 'GET', body?: unknown, key = crypto.randomUUID(), csrf = 'csrf') => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    assert.deepEqual(await (await call('/pricing/plans')).json(), []); assert.equal(planCreates, 0);
    const input = { name: ' Christmast ', isActive: true, rules: defaultRules('PROMO') };
    for (const r of ['STAFF', 'ADMIN']) { role = r; assert.equal((await call('/pricing/plans', 'POST', input)).status, 403); assert.equal((await call('/pricing/plans/none', 'PATCH', { ...input, revision: 1 })).status, 403); assert.equal((await call('/pricing/plans')).status, 200); }
    role = 'OWNER'; assert.equal((await call('/pricing/plans', 'POST', input, crypto.randomUUID(), 'bad')).status, 403);
    assert.equal((await call('/pricing/plans', 'POST', { ...input, extra: 1 })).status, 400);
    const key = crypto.randomUUID(); const created = await call('/pricing/plans', 'POST', input, key); assert.equal(created.status, 201); const plan = await created.json(); assert.equal(plan.name, 'Christmast');
    assert.deepEqual(await (await call('/pricing/plans', 'POST', input, key)).json(), plan); assert.equal(planCreates, 1);
    assert.equal((await call('/pricing/plans', 'POST', { ...input, name: 'christmast' })).status, 409);
    const preview = await call('/pricing/preview', 'POST', { rules: input.rules, pairs: 4 }); assert.equal(preview.status, 200); assert.equal((await preview.json()).totalIdr, 175000);
    assert.equal((await call('/pricing/preview', 'POST', { rules: [], pairs: 4 })).status, 400);
    const body = { customerId: 'customer', ratePlanId: plan.id, items: Array.from({ length: 5 }, () => ({ brand: 'Nike', model: 'Air', color: 'White' })) };
    const orderKey = crypto.randomUUID(); const response = await call('/orders', 'POST', body, orderKey); assert.equal(response.status, 201); const saved = await response.json(); assert.equal(saved.totalIdr, 210000); assert.equal(saved.pricing.version, 2); assert.equal(saved.pricing.planId, plan.id); assert.ok(saved.items.every((i: Row) => i.serviceName === 'Christmast' && i.serviceId === 'cicuci-cleaning-v1'));
    const changed = { name: 'Updated', isActive: true, revision: 1, rules: defaultRules('NORMAL') }; const updateKey = crypto.randomUUID(); assert.equal((await call(`/pricing/plans/${plan.id}`, 'PATCH', changed, updateKey)).status, 200);
    assert.equal((await call(`/pricing/plans/${plan.id}`, 'PATCH', changed, updateKey)).status, 200); assert.equal(updates, 1);
    assert.equal((await call(`/pricing/plans/${plan.id}`, 'PATCH', changed)).status, 409);
    assert.equal((await call(`/pricing/plans/${plan.id}`, 'PATCH', { name: 'Incomplete', revision: 2 })).status, 400);
    assert.deepEqual(await (await call('/orders', 'POST', body, orderKey)).json(), saved); assert.equal(orderCreates, 1);
    const originalOrder = order;
    const newer = await (await call('/orders', 'POST', body)).json(); assert.equal(newer.totalIdr, 225000); assert.equal(newer.pricing.name, 'Updated'); assert.equal(newer.pricing.revision, 2);
    order = originalOrder;
    order.items.forEach((i: Row) => { i.outcome = 'APPROVED'; i.status = 'QUEUED'; }); order.items[4].outcome = 'REJECTED';
    const tx = fake as unknown as Parameters<typeof reprice>[0]; await reprice(tx, order.id); assert.equal(order.pricing.totalIdr, 175000); assert.equal(order.pricing.name, 'Christmast');
    order.items[3].status = 'AWAITING_CONSENT'; await assert.rejects(confirmPricing(tx, order.id, 175000, 'owner'), /PRICE_NOT_FINAL/);
    order.items[3].status = 'QUEUED'; await confirmPricing(tx, order.id, 175000, 'owner'); await confirmPricing(tx, order.id, 175000, 'owner'); assert.equal(audits.filter(a => a.action === 'PRICING_CONFIRMED').length, 1);
    assert.equal((await call(`/pricing/plans/${plan.id}`, 'PATCH', { ...changed, revision: 2, isActive: false })).status, 200);
    assert.equal((await call('/orders', 'POST', body)).status, 409);
    assert.equal((await call('/orders', 'POST', { ...body, rateMode: 'PROMO' })).status, 400);
    const competing = await Promise.all([1, 2].map(n => call(`/pricing/plans/${plan.id}`, 'PATCH', { ...changed, name: `Concurrent ${n}`, revision: 3, isActive: false })));
    assert.deepEqual(competing.map(r => r.status).sort(), [200, 409]); assert.equal(plans.get(plan.id)!.revision, 4);
    assert.equal(audits.filter(a => a.action === 'RATE_PLAN_CREATED').length, 1); assert.equal(audits.filter(a => a.action === 'RATE_PLAN_UPDATED').length, 3); assert.ok(locks >= 5);
    order.items[0].outcome = 'DECLINED'; await reprice(tx, order.id); assert.equal(order.pricing.allocations['item-0'], 0); assert.equal(order.pricing.allocations['item-1'], 43750);
    order.items[1].outcome = 'NEEDS_CONSENT'; order.items[1].consents = []; await assert.rejects(transition(tx, 'item-1', { toStatus: 'WASHING', reason: '' }, { id: 'owner', role: 'OWNER' }), /PRICE_NOT_FINAL/);
    const fastInput = { name: 'Fast', isActive: true, turnaroundPolicy: 'FAST', rules: [pack(1, 80000)] };
    assert.equal((await call('/pricing/plans', 'POST', { ...fastInput, turnaroundPolicy: 'UNKNOWN' })).status, 400);
    const fast = await (await call('/pricing/plans', 'POST', fastInput)).json();
    for (const pairs of [1, 5, 50]) assert.equal((await (await call('/pricing/preview', 'POST', { rules: fast.rules, pairs })).json()).totalIdr, 80000 * pairs);
    t.mock.timers.enable({ apis: ['Date'], now: new Date('2026-11-09T10:00:00Z') });
    try {
      const fastBody = { ...body, ratePlanId: fast.id }; const retryKey = crypto.randomUUID();
      const result = await call('/orders', 'POST', fastBody, retryKey); assert.equal(result.status, 201);
      const savedFast = await result.json();
      assert.equal(savedFast.createdAt, '2026-11-09T10:00:00.000Z');
      assert.equal(savedFast.estimatedCompletionAt, '2026-11-10T10:00:00.000Z');
      assert.equal(savedFast.totalIdr, 400000); assert.equal(savedFast.pricing.turnaroundPolicy, 'FAST');
      assert.equal((await call(`/pricing/plans/${fast.id}`, 'PATCH', { ...fastInput, name: 'Renamed', isActive: false, turnaroundPolicy: 'REGULAR', rules: [pack(1, 1)], revision: 1 })).status, 200);
      t.mock.timers.setTime(new Date('2026-11-09T10:00:00.001Z').getTime());
      assert.deepEqual(await (await call('/orders', 'POST', fastBody, retryKey)).json(), savedFast);
      order.items.forEach((i: Row) => { i.outcome = 'APPROVED'; i.status = 'QUEUED'; }); order.items[4].outcome = 'REJECTED';
      await reprice(tx, order.id); assert.equal(order.pricing.totalIdr, 320000); assert.equal(order.pricing.allocations['item-4'], 0);
      assert.equal(order.pricing.name, 'Fast'); assert.equal(order.pricing.turnaroundPolicy, 'FAST');
      assert.equal(order.estimatedCompletionAt.toISOString(), savedFast.estimatedCompletionAt);
      const tracked = await call(`/track/${'a'.repeat(64)}`); assert.equal(tracked.status, 200);
      const publicBody = await tracked.json();
      assert.equal(publicBody.pricing.name, 'Fast');
      assert.equal(publicBody.pricing.pairs, 4);
      assert.equal(publicBody.pricing.breakdown[0].quantity, 4);
      assert.equal(publicBody.pricing.breakdown[0].priceIdr, 80000);
      assert.equal(publicBody.pricing.breakdown[0].totalIdr, publicBody.totalIdr);
      for (const key of ['verifiedBy', 'verifiedAt', 'rules', 'serviceId', 'planId', 'allocations', 'agreedAllocations']) assert.equal(key in publicBody.pricing, false);
      for (const key of ['customer', 'payments', 'trackingHash', 'trackingSecret']) assert.equal(key in publicBody, false);
    } finally { t.mock.timers.reset(); }
  } finally { await new Promise<void>(r => server.close(() => r())); hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.plans.test')); }
});


test('Fast migration seed is insert-only; old snapshot policy defaults regular', () => {
  const sql = readFileSync(new URL('../prisma/migrations/202611110010_fast_turnaround/migration.sql', import.meta.url), 'utf8');
  assert.match(sql, /WHERE NOT EXISTS/); assert.doesNotMatch(sql, /UPDATE |DELETE |DROP |TRUNCATE /);
  const price = Number(sql.match(/'priceIdr',(\d+)/)![1]);
  for (const n of [1, 5, 50]) assert.equal(previewPricing([pack(1, price)], n).totalIdr, 80000 * n);
  const old = planPricing({ id: 'old', name: 'Fast', revision: 1, rules: [pack(1, 1)] }, 'internal', 1);
  const { turnaroundPolicy: _policy, ...withoutPolicy } = old.version === 2 ? old : (() => { throw Error('Expected v2'); })();
  assert.equal(_policy, 'REGULAR');
  const parsed = pricingSnapshot.parse(withoutPolicy);
  assert.equal(parsed.version === 2 && parsed.turnaroundPolicy, 'REGULAR');
});
