import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

test('worker notification audit: skips, retries, claims, submitted, ambiguity, duplicate/history isolation; fake DB/provider only', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  // Parent owns the persistence helper. Resolve its contract to a fake: no DB or Redis I/O.
  const activities: { action: string; metadata?: unknown }[] = [];
  const fakeAuditUrl = 'data:text/javascript,' + encodeURIComponent('export async function recordActivity(data) { globalThis[Symbol.for("cicuci.test.wa.audit")].push(data); }');
  Reflect.set(globalThis, Symbol.for('cicuci.test.wa.audit'), activities);
  const fakeRepositoryUrl = 'data:text/javascript,' + encodeURIComponent('export async function transaction(run) { return run(globalThis[Symbol.for("cicuci.test.wa.tx")]); } export async function lockOrder() { return true; }');
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.endsWith('/lib/audit.js') ? { url: fakeAuditUrl, shortCircuit: true } : specifier.endsWith('/repositories/orders.js') ? { url: fakeRepositoryUrl, shortCircuit: true } : specifier === './orders.js' && context.parentURL?.includes('/services/notifications.') ? { url: 'data:text/javascript,' + encodeURIComponent('export function check(value) { if (!value) throw new Error("NOT_FOUND"); }'), shortCircuit: true } : next(specifier, context); } });
  process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  const { seal } = await import('../src/services/whatsapp-templates.js');
  const { deliverNotification } = await import('../src/services/notifications.js');
  let event: Record<string, unknown>; let sends = 0; let failSend = false; let failPersist = false;
  const tx = {
    $queryRaw: async () => [{ id: 'fake-order' }],
    notificationEvent: {
      findUnique: async () => event, findUniqueOrThrow: async () => event,
      update: async ({ data }: { data: object }) => { Object.assign(event, data); return event; },
    },
    notificationAttempt: { create: async () => ({}), update: async () => { if (failPersist) throw new Error('private db error'); return {}; } },
  };
  Reflect.set(globalThis, Symbol.for('cicuci.test.wa.tx'), tx);
  const reset = () => {
    activities.length = 0;
    event = { id: 'fake-event', orderId: 'fake-order', provider: 'whatsapp-web.js', generation: 0, status: 'PENDING', attempts: [], activation: 'private-activation', optedIn: true, recipient: '+628123456789', encryptedMessage: seal({ message: 'private-message', trackingHash: 'cd'.repeat(32) }), message: '[private]', eventKey: 'private-token', template: 'RECEIVED', order: { trackingHash: 'cd'.repeat(32), aggregateStatus: 'IN_PROGRESS', customer: { notificationConsentAt: new Date(), whatsapp: '+628123456789' } } };
  };
  const provider = { activation: 'private-activation', ready: true, send: async () => { sends++; if (failSend) throw new Error('private provider response'); return { delivery: 'submitted', messageId: 'private-provider-id' }; } };
  try {
    reset(); event!.optedIn = false;
    await deliverNotification('fake-event', 0, provider);
    assert.equal(sends, 0); assert.equal(activities[0]?.action, 'NOTIFICATION_SKIPPED');
    assert.match(JSON.stringify(activities), /NO_CURRENT_OPT_IN/);
    reset(); await assert.rejects(deliverNotification('fake-event', 0, { ...provider, ready: false }), /DELIVERY_RETRY/);
    assert.equal(sends, 0); assert.equal(activities[0]?.action, 'NOTIFICATION_ATTEMPT_FAILED');
    reset(); await deliverNotification('fake-event', 0, provider);
    assert.deepEqual(activities.map(a => a.action), ['NOTIFICATION_ATTEMPT', 'NOTIFICATION_SENT']);
    assert.match(JSON.stringify(activities), /submitted/);
    await deliverNotification('fake-event', 0, provider); assert.equal(sends, 1); assert.equal(activities.length, 2);
    reset(); failSend = true; await deliverNotification('fake-event', 0, provider);
    assert.equal(activities[1]?.action, 'NOTIFICATION_FAILED');
    assert.match(JSON.stringify(activities), /AMBIGUOUS_SEND_MANUAL_REVIEW/);
    assert.match(JSON.stringify(activities), /unknown/);
    assert.doesNotMatch(JSON.stringify(activities), /private|628123456789/);
    reset(); failPersist = true; await deliverNotification('fake-event', 0, provider);
    assert.equal(sends, 3); assert.equal(activities.at(-1)?.action, 'NOTIFICATION_PERSIST_FAILED');
    assert.match(JSON.stringify(activities), /sendMessage/); assert.doesNotMatch(JSON.stringify(activities), /private db error/);
    failPersist = false;
    reset(); event!.order = { ...(event!.order as object), trackingHash: null }; await deliverNotification('fake-event', 0, provider); assert.equal(sends, 3); assert.match(JSON.stringify(activities), /TRACKING_CHANGED/);
    reset(); event!.encryptedMessage = null; await deliverNotification('fake-event', 0, provider); assert.equal(sends, 3); assert.match(JSON.stringify(activities), /MESSAGE_UNAVAILABLE/);
    reset(); event!.provider = 'mock'; await deliverNotification('fake-event', 0, provider);
    assert.equal(activities.length, 0); assert.equal(sends, 3);
    reset(); event!.template = 'READY_FOR_PICKUP'; await deliverNotification('fake-event', 0, provider);
    assert.equal(sends, 3); assert.match(JSON.stringify(activities), /STALE_ORDER/);
    reset(); event!.template = 'READY_FOR_PICKUP'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' };
    await deliverNotification('fake-event', 0, provider); assert.equal(sends, 4);
  } finally { hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.wa.tx')); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.wa.audit')); }
});
