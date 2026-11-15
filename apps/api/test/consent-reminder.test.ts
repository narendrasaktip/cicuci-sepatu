import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('consent reminder is delayed, guarded and claimed once without outbound traffic', async () => {
  const state = globalThis as typeof globalThis & { reminderTx?: unknown };
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (specifier.endsWith('/repositories/orders.js')) return { url: 'data:text/javascript,export const transaction=fn=>fn(globalThis.reminderTx);export const lockOrder=async()=>true;export const audit=async()=>{};export const detail={};export const lockItem=async()=>true;', shortCircuit: true };
    if (specifier.endsWith('/lib/audit.js')) return { url: 'data:text/javascript,export const recordActivity=async()=>{};export const safeMetadata=x=>x;', shortCircuit: true };
    return next(specifier, context);
  } });
  process.env.DATABASE_URL ??= 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL ??= 'redis://127.0.0.1:1';
  process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  try {
    const { deliverNotification } = await import('../src/services/notifications.js');
    const { seal } = await import('../src/services/whatsapp-templates.js');
    const order = { id: 'order', aggregateStatus: 'AWAITING_CONSENT', trackingHash: 'hash', customer: { whatsapp: '+62000', notificationConsentAt: new Date() } };
    const initial = { status: 'SENT', updatedAt: new Date(Date.now() - 25 * 3600000), attempts: [{ status: 'SENT' }] };
    const event = { id: 'reminder', eventKey: 'consent-reminder:c1', orderId: 'order', itemId: 'shoe', expectedStatus: 'AWAITING_CONSENT', provider: 'whatsapp-web.js', activation: 'active', generation: 0, status: 'PENDING', nextAttemptAt: new Date(0), optedIn: true, recipient: '+62000', template: 'CONSENT_REQUEST', encryptedMessage: seal({ message: 'test', trackingHash: 'hash' }), attempts: [] as object[], order };
    const consent = { itemId: 'shoe', consumedAt: null as Date | null, expiresAt: new Date(Date.now() + 3600000) };
    const attempts: { data: { status: string; response: object } }[] = [];
    const tx = { $queryRaw: async () => [], notificationEvent: { findUnique: async ({ where }: { where: { id?: string } }) => where.id ? event : initial, findUniqueOrThrow: async () => event, update: async ({ data }: { data: object }) => Object.assign(event, data) }, orderItem: { findUnique: async () => ({ status: 'AWAITING_CONSENT' }) }, consentDecision: { findUnique: async () => consent }, notificationAttempt: { create: async (args: { data: { status: string; response: object } }) => { attempts.push(args); } } };
    state.reminderTx = tx;
    const provider = { activation: 'active', ready: false, send: async () => { throw new Error('outbound forbidden'); } };
    initial.updatedAt = new Date();
    await deliverNotification('reminder', 0, provider);
    assert.equal(attempts.length, 0); assert.ok(event.nextAttemptAt.getTime() > Date.now() + 23 * 3600000);
    event.nextAttemptAt = new Date(0); initial.updatedAt = new Date(Date.now() - 25 * 3600000); consent.consumedAt = new Date();
    await deliverNotification('reminder', 0, provider);
    assert.equal(event.status, 'SKIPPED'); assert.equal((attempts[0]!.data.response as { reason: string }).reason, 'STALE_CONSENT');
    event.status = 'PENDING'; consent.consumedAt = null; consent.expiresAt = new Date(0);
    await deliverNotification('reminder', 0, provider);
    assert.equal((attempts[1]!.data.response as { reason: string }).reason, 'STALE_CONSENT');
    event.status = 'PENDING'; consent.expiresAt = new Date(Date.now() + 3600000); order.customer.notificationConsentAt = null as unknown as Date;
    await deliverNotification('reminder', 0, provider);
    assert.equal((attempts[2]!.data.response as { reason: string }).reason, 'NO_CURRENT_OPT_IN');
    await deliverNotification('reminder', 0, provider); assert.equal(attempts.length, 3);
  } finally { delete state.reminderTx; hooks.deregister(); }
});
