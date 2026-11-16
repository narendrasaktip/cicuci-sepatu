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
  const hooks = registerHooks({ resolve(specifier, context, next) { return specifier.endsWith('/lib/audit.js') ? { url: fakeAuditUrl, shortCircuit: true } : specifier.endsWith('/repositories/orders.js') ? { url: fakeRepositoryUrl, shortCircuit: true } : specifier === './orders.js' && context.parentURL?.includes('/services/notifications.') ? { url: 'data:text/javascript,' + encodeURIComponent('export function physicallyCompleted(items) { return items.length > 0 && items.every(item => ["HANDED_OVER", "RETURNED"].includes(item.status)); } export function check(value) { if (!value) throw new Error("NOT_FOUND"); } export async function getOrder(tx) { return { balanceIdr: tx.balance, totalIdr: tx.total }; }'), shortCircuit: true } : next(specifier, context); } });
  process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  const { seal } = await import('../src/services/whatsapp-templates.js');
  const { deliverNotification } = await import('../src/services/notifications.js');
  const { QrPreparationError } = await import('../src/integrations/whatsapp/web.js');
  let event: Record<string, unknown>; let sends = 0; let failSend = false; let failPersist = false;
  let savedResponse: unknown;
  let others: { status: string; attempts: { status: string; response: object }[] }[] = [];
  const tx = {
    balance: 50000, total: 50000,
    $queryRaw: async () => [{ id: 'fake-order' }],
    notificationEvent: {
      findUnique: async () => event, findUniqueOrThrow: async () => event, findMany: async () => others,
      update: async ({ data }: { data: object }) => { Object.assign(event, data); return event; },
    },
    notificationAttempt: { create: async () => ({}), update: async ({ data }: { data: { response: unknown } }) => { if (failPersist) throw new Error('private db error'); savedResponse = data.response; return {}; } },
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
    reset(); event!.template = 'PICKUP_BILL_UNPAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' };
    const balanceMarker = '[SALDO_12345678-1234-1234-1234-123456789abc]';
    event!.encryptedMessage = seal({ message: `Pelanggan [SALDO_SAAT_KLAIM], sisa ${balanceMarker} dan ${balanceMarker}`, balanceMarker, trackingHash: 'cd'.repeat(32) });
    tx.balance = 25000;
    let delivered: { message: string; qr?: boolean } | undefined;
    await deliverNotification('fake-event', 0, { ...provider, send: async input => { delivered = input; return {}; } });
    assert.equal(delivered?.qr, true); assert.match(delivered!.message, /Pelanggan \[SALDO_SAAT_KLAIM\], sisa Rp25\.000 dan Rp25\.000/); assert.match(delivered!.message, /Total pesanan: Rp50\.000.*saat pengiriman.*konfirmasi ke toko/s);
    reset(); event!.template = 'PICKUP_BILL_UNPAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' };
    event!.encryptedMessage = seal({ message: 'Sisa [SALDO_SAAT_KLAIM]', trackingHash: 'cd'.repeat(32) });
    await deliverNotification('fake-event', 0, provider); assert.equal(event!.status, 'SKIPPED'); assert.match(JSON.stringify(activities), /MESSAGE_UNAVAILABLE/);
    reset(); event!.template = 'PICKUP_BILL_UNPAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' }; tx.balance = 0;
    await deliverNotification('fake-event', 0, provider); assert.equal(event!.status, 'SKIPPED'); assert.match(JSON.stringify(activities), /STALE_BALANCE/);
    reset(); event!.template = 'PICKUP_BILL_PAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' };
    await deliverNotification('fake-event', 0, { ...provider, send: async input => { delivered = input; return {}; } });
    assert.equal(delivered?.qr, undefined); assert.equal(event!.status, 'SENT');
    reset(); event!.template = 'PICKUP_BILL_PAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' }; tx.balance = 1000;
    await deliverNotification('fake-event', 0, provider); assert.equal(event!.status, 'SKIPPED');
    reset(); event!.template = 'PICKUP_BILL_UNPAID'; event!.order = { ...(event!.order as object), aggregateStatus: 'READY_FOR_PICKUP' }; tx.balance = 1000;
    event!.encryptedMessage = seal({ message: `Sisa ${balanceMarker}`, balanceMarker, trackingHash: 'cd'.repeat(32) });
    await deliverNotification('fake-event', 0, { ...provider, send: async () => { throw new QrPreparationError(); } });
    assert.deepEqual(savedResponse, { generation: 0, actualOutbound: false, error: 'QR_PREPARATION_FAILED', retryable: false, stage: 'send', errorType: 'Error', diagnosticCode: 'QR_PREPARATION_FAILED', operation: 'sendMessage', sendPhase: 'unknown' });
    assert.match(JSON.stringify(activities), /QR_PREPARATION_FAILED/);
    // Interleave a financial claim with a payment notification while send is unresolved.
    failSend = false;
    reset(); event!.template = 'PICKUP_BILL_UNPAID'; event!.order = { ...(event!.order as object), id: 'fake-order', aggregateStatus: 'READY_FOR_PICKUP' };
    event!.encryptedMessage = seal({ message: `Sisa ${balanceMarker}`, balanceMarker, trackingHash: 'cd'.repeat(32) }); tx.balance = 1000;
    let release!: () => void; let started!: () => void;
    const sending = new Promise<void>(resolve => { started = resolve; });
    const paused = new Promise<void>(resolve => { release = resolve; });
    const first = deliverNotification('fake-event', 0, { ...provider, send: async () => { started(); await paused; throw new Error('ambiguous'); } });
    await sending; const unpaid = event!; assert.equal(unpaid.status, 'PROCESSING');
    reset(); event!.template = 'PICKUP_BILL_PAID'; event!.order = { ...(event!.order as object), id: 'fake-order', aggregateStatus: 'READY_FOR_PICKUP' }; tx.balance = 0;
    const paid = event!; others = [{ status: 'PROCESSING', attempts: [] }];
    await deliverNotification('paid', 0, provider); assert.equal(paid.status, 'PENDING');
    event = unpaid; release(); await first; assert.equal(unpaid.status, 'FAILED');
    assert.deepEqual(savedResponse, { generation: 0, actualOutbound: 'unknown', error: 'AMBIGUOUS_SEND_MANUAL_REVIEW', retryable: false, stage: 'send', errorType: 'Error', diagnosticCode: 'UNKNOWN', operation: 'sendMessage', sendPhase: 'unknown' });
    event = paid; others = [{ status: 'FAILED', attempts: [{ status: 'FAILED', response: { actualOutbound: 'unknown' } }] }];
    await deliverNotification('paid', 0, provider); assert.equal(paid.status, 'PENDING');
    others = []; await deliverNotification('paid', 0, provider); assert.equal(paid.status, 'SENT');
  } finally { hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.wa.tx')); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.wa.audit')); }
});
