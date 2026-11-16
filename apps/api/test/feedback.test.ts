import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import type { Tx } from '../src/repositories/orders.js';

process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
process.env.REDIS_URL = 'redis://127.0.0.1:1';
process.env.APP_BASE_URL = 'http://localhost:5173';
process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
const raw = 'a'.repeat(64);
let role = 'OWNER', authenticated = false;
let saved: { id: string; orderId: string; rating: number; review: string; createdAt: Date } | null = null;
let order: Record<string, unknown>;
let history = 0, locks = 0, rotateOnLock = false;
const events = new Map<string, Record<string, unknown>>();
const audits: Record<string, unknown>[] = [];
const fake = {
  session: { findUnique: async () => authenticated ? { user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) } : null },
  order: {
    findUnique: async ({ where }: { where: { trackingHash?: string } }) => where.trackingHash && where.trackingHash !== order.trackingHash ? null : order,
    findUniqueOrThrow: async () => order,
    update: async ({ data }: { data: object }) => Object.assign(order, data),
  },
  orderItem: {
    findMany: async () => order.items,
    update: async ({ where, data }: { where: { id: string }; data: object }) => Object.assign((order.items as { id: string }[]).find(i => i.id === where.id)!, data),
  },
  feedback: {
    findUnique: async () => saved,
    create: async ({ data }: { data: { orderId: string; rating: number; review: string } }) => {
      assert.equal(saved, null); saved = { id: 'feedback', ...data, createdAt: new Date() };
      return { rating: saved.rating, review: saved.review, createdAt: saved.createdAt };
    },
    findMany: async () => saved ? [{ id: saved.id, rating: saved.rating, review: saved.review, createdAt: saved.createdAt, order: { number: order.number, customer: { name: 'Private customer' } } }] : [],
  },
  storeSettings: { findUnique: async () => ({}) },
  statusHistory: { create: async () => ({ id: `history-${++history}` }) },
  notificationEvent: {
    findUnique: async ({ where }: { where: { eventKey: string } }) => events.get(where.eventKey) ?? null,
    upsert: async ({ where, create }: { where: { eventKey: string }; create: Record<string, unknown> }) => {
      if (!events.has(where.eventKey)) events.set(where.eventKey, { id: where.eventKey, ...create });
      return events.get(where.eventKey);
    },
  },
  auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { audits.push(data); return {}; } },
  $queryRaw: async () => { locks++; if (rotateOnLock) order.trackingHash = null; return [{ id: 'order', archivedAt: order.archivedAt }]; },
  $transaction: async (run: (tx: unknown) => unknown) => run(fake),
};
Reflect.set(globalThis, Symbol.for('cicuci.feedback'), fake);
const hook = registerHooks({ resolve(s, context, next) {
  if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.feedback")]', shortCircuit: true };
  if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export async function notificationBlocker(){return "NOT_ENABLED"}; export const controlQueue=()=>{throw new Error("NO_LIVE_QUEUE")}; export const controlRedis=controlQueue; export const lockKey="fake"; export const sign=controlQueue; export const workerSnapshot=controlQueue;', shortCircuit: true };
  return next(s, context);
} });
const { app } = await import('../src/app.js');
const { hashToken } = await import('../src/lib/security.js');
const { change, notify } = await import('../src/services/orders.js');
const { feedbackEligible, feedbackInput, submitFeedback } = await import('../src/services/feedback.js');
const { defaults, seal, unseal } = await import('../src/services/whatsapp-templates.js');
hook.deregister();
function reset(statuses = ['HANDED_OVER', 'RETURNED']) {
  saved = null; events.clear(); audits.length = 0; rotateOnLock = false;
  order = { id: 'order', number: 'CS-TEST', archivedAt: null, pricing: null, aggregateStatus: 'COMPLETED', trackingHash: hashToken(raw), trackingSecret: seal(raw), payments: [], items: statuses.map((status, i) => ({ id: `item-${i}`, orderId: 'order', brand: 'Shoe', model: '', color: '', status, finalPriceIdr: 0, consents: [], history: [], photos: [] })), customer: { name: 'Private customer', whatsapp: '+620000000', notificationConsentAt: null } };
}

test('strict feedback input and physical completion include rejected returns, not ready/pending/empty', async () => {
  assert.deepEqual(feedbackInput.parse({ rating: 1, review: ' good ' }), { rating: 1, review: 'good', publicationConsent: false });
  for (const rating of [0, 6, 2.5, '5', null]) assert.equal(feedbackInput.safeParse({ rating, review: 'good' }).success, false);
  for (const review of ['', '  ', 'x'.repeat(1001)]) assert.equal(feedbackInput.safeParse({ rating: 5, review }).success, false);
  assert.equal(feedbackInput.safeParse({ rating: 5, review: 'good', orderId: 'other' }).success, false);
  for (const statuses of [[], ['READY_FOR_PICKUP'], ['HANDED_OVER', 'RETURN_PENDING'], ['HANDED_OVER', 'WASHING']]) {
    reset(statuses); assert.equal(feedbackEligible(order as never), false);
    await assert.rejects(submitFeedback(fake as unknown as Tx, raw, { rating: 5, review: 'good' }), { code: 'ORDER_NOT_COMPLETED' });
  }
  reset(['RETURNED', 'RETURNED']); assert.equal(feedbackEligible(order as never), true);
  order.archivedAt = new Date(); assert.equal(feedbackEligible(order as never), false);
  reset(); rotateOnLock = true;
  await assert.rejects(submitFeedback(fake as unknown as Tx, raw, { rating: 5, review: 'good' }), { code: 'TOKEN_INVALID' });
});

test('HTTP feedback token isolation, validation, duplicate requests, private owner/admin list, rate limit and safe audit', async () => {
  reset(); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, body?: unknown) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method: body ? 'POST' : 'GET', headers: { 'Content-Type': 'application/json', ...(authenticated ? { Cookie: `cicuci_session=${raw}` } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  try {
    assert.equal((await call('/feedback')).status, 401);
    assert.equal((await call(`/track/${'b'.repeat(64)}/feedback`, { rating: 5, review: 'good' })).status, 404);
    assert.equal((await call(`/track/${raw}/feedback`, { rating: 1.5, review: 'good' })).status, 400);
    const first = await call(`/track/${raw}`), before = await first.json();
    assert.equal(before.feedbackEligible, true); assert.equal(before.feedback, null);
    assert.equal(JSON.stringify(before).includes('Private customer'), false);
    const responses = await Promise.all([call(`/track/${raw}/feedback`, { rating: 5, review: ' good ' }), call(`/track/${raw}/feedback`, { rating: 4, review: 'duplicate' })]);
    assert.deepEqual(responses.map(r => r.status).sort(), [201, 409]);
    const after = await (await call(`/track/${raw}`)).json(); assert.equal(after.feedbackEligible, false); assert.equal(after.feedback.review, 'good');
    assert.ok(locks > 0); assert.equal(audits.filter(a => a.action === 'FEEDBACK_SUBMITTED').length, 1);
    authenticated = true; role = 'STAFF'; assert.equal((await call('/feedback')).status, 403);
    for (role of ['OWNER', 'ADMIN']) {
      const list = await call('/feedback?limit=1'); assert.equal(list.status, 200);
      const result = await list.json(); assert.equal(result.data[0].order.customer.name, 'Private customer');
      assert.equal(JSON.stringify(result).includes('+620000000'), false);
    }
    assert.equal((await call('/feedback', {})).status, 403); // existing session CSRF boundary
    authenticated = false;
    for (let i = 0; i < 90; i++) { const response = await call(`/track/${raw}`); if (response.status === 429) break; }
    assert.equal((await call(`/track/${raw}/feedback`, { rating: 5, review: 'limited' })).status, 429);
    await new Promise(r => setTimeout(r, 10));
    assert.equal(JSON.stringify(audits).includes(raw), false); assert.equal(JSON.stringify(audits).includes('good'), false);
  } finally { authenticated = false; await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
});

test('whole-order handover exact template, final physical item only, mixed/all rejected, dedup and immutable snapshots', async () => {
  const expected = 'Halo {sapaan} {nama_pelanggan} 👋,\n\nSeluruh sepatu pada nomor pesanan _{nomor_pesanan}_ telah berhasil diserahkan kepada Anda.\n\nTerima kasih telah mempercayakan perawatan sepatu Anda kepada *Cicuci Sepatu*! 💛\n\nKami ingin mendengar pendapat Anda mengenai hasil perawatan dan pelayanan kami.\n\nSilakan berikan rating ⭐ 1–5 dan ulasan singkat melalui halaman berikut:\n- {url_ulasan}\n\n_Masukan Anda sangat berarti untuk membantu kami meningkatkan kualitas pelayanan ke depannya. 😊_\n\nSampai jumpa di perawatan sepatu berikutnya! 👟\n\n_Salam hangat,_\n*Cicuci Sepatu*';
  assert.equal(defaults.find(t => t.event === 'ORDER_HANDED_OVER')!.body, expected);
  for (const statuses of [['READY_FOR_PICKUP', 'RETURN_PENDING'], ['RETURN_PENDING', 'RETURN_PENDING'], ['READY_FOR_PICKUP', 'READY_FOR_PICKUP']]) {
    reset(statuses); const items = order.items as { id: string; orderId: string; status: string }[];
    await change(fake as unknown as Tx, items[0] as never, statuses[0] === 'READY_FOR_PICKUP' ? 'HANDED_OVER' : 'RETURNED', 'owner', '');
    assert.equal([...events.values()].filter(e => e.template === 'ORDER_HANDED_OVER').length, 0);
    await change(fake as unknown as Tx, items[1] as never, statuses[1] === 'READY_FOR_PICKUP' ? 'HANDED_OVER' : 'RETURNED', 'owner', '');
    const event = events.get('order-handover:order')!; assert.ok(event); assert.equal(event.itemId, undefined);
    const message = (unseal(event.encryptedMessage as string) as { message: string }).message;
    assert.match(message, /Seluruh sepatu/); assert.match(message, /rating ⭐ 1–5/); assert.match(message, new RegExp(`/feedback/${raw}`));
    await notify(fake as unknown as Tx, 'order', 'ORDER_HANDED_OVER', 'order-handover:order');
    assert.equal(events.get('order-handover:order'), event);
    assert.equal([...events.values()].filter(e => e.template === 'ORDER_HANDED_OVER').length, 1);
    assert.equal([...events.values()].filter(e => e.template === 'HANDED_OVER').length, 0);
    assert.equal((unseal(event.encryptedMessage as string) as { message: string }).message, message);
  }
});
