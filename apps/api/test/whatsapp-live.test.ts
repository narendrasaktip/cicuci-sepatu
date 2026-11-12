import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test, mock } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { fakeSend } from './helpers/whatsapp.js';
import { randomToken, hashToken } from '../src/lib/security.js';
test('owner/CSRF/Origin boundaries; provider claims, consent, mock isolation and ambiguous dedupe (fake sends only)', { skip: process.env.RUN_WA_TESTS !== '1', timeout: 30000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/cicuci_sepatu_dev');
  const db = new PrismaClient(); const prefix = `wa-test-${randomUUID()}`; const users: string[] = []; const events: string[] = [];
  const { deliverNotification } = await import('../src/services/notifications.js');
  const base = 'http://127.0.0.1:3000/api/v1'; const origin = new URL(process.env.APP_BASE_URL!).origin;
  let orderId = ''; let customerId = ''; let calls = 0;
  try {
    for (const role of ['OWNER', 'ADMIN', 'STAFF'] as const) {
      const user = await db.user.create({ data: { email: `${prefix}-${role}@example.test`, name: prefix, role, passwordHash: 'unused' } }); users.push(user.id);
      const raw = randomToken(); const csrf = randomToken();
      await db.session.create({ data: { userId: user.id, tokenHash: hashToken(raw), csrfToken: csrf, expiresAt: new Date(Date.now() + 60000) } });
      const headers = { Cookie: `cicuci_session=${raw}`, Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf, 'Idempotency-Key': randomUUID() };
      const get = await fetch(`${base}/whatsapp/status`, { headers }); assert.equal(get.status, role === 'OWNER' ? 200 : 403); assert.match(get.headers.get('cache-control')!, /no-store/);
      for (const command of ['start', 'disconnect', 'activate', 'deactivate']) {
        if (role === 'OWNER') {
          assert.equal((await fetch(`${base}/whatsapp/${command}`, { method: 'POST', headers: { ...headers, 'X-CSRF-Token': '' }, body: '{}' })).status, 403);
          assert.equal((await fetch(`${base}/whatsapp/${command}`, { method: 'POST', headers: { ...headers, Origin: 'https://evil.test' }, body: '{}' })).status, 403);
        } else assert.equal((await fetch(`${base}/whatsapp/${command}`, { method: 'POST', headers, body: '{}' })).status, 403);
      }
    }
    const customer = await db.customer.create({ data: { name: prefix, whatsapp: '+628123456789', notificationConsentAt: new Date() } }); customerId = customer.id;
    const order = await db.order.create({ data: { number: prefix, customerId, estimatedCompletionAt: new Date(), pickupInstructions: '' } }); orderId = order.id;
    const activation = randomUUID();
    const real = { activation, ready: true, send: async () => { calls++; return fakeSend(); } };
    async function event(provider: string, extra: object = {}) {
      const e = await db.notificationEvent.create({ data: { eventKey: randomUUID(), orderId, recipient: customer.whatsapp, optedIn: true, template: 'TEST', message: 'fake only', provider, activation, nextAttemptAt: new Date(Date.now() + 3600000), ...extra } }); events.push(e.id); return e;
    }
    // Readiness is injected in this process only; no worker commands or real activation.
    const { controlRedis, sign } = await import('../src/lib/whatsapp-control.js');
    const { notify } = await import('../src/services/orders.js');
    const redis = controlRedis();
    let payload = JSON.stringify({ ready:true, realSendEnabled:true, activation, updatedAt:Date.now() });
    const get = mock.method(redis, 'get', async () => JSON.stringify({payload,signature:await sign(payload)}));
    const exists = mock.method(redis, 'exists', async () => 1);
    const rollback = new Error('ROLLBACK_TEST_ONLY');
    try {
      await assert.rejects(db.$transaction(async tx => {
        await tx.storeSettings.upsert({where:{id:1},create:{waActivation:null},update:{waActivation:null}});
        const blocked = await notify(tx, orderId, 'TEST', randomUUID());
        assert.equal(blocked.provider,'whatsapp-web.js'); assert.equal(blocked.status,'SKIPPED');
        const attempt = await tx.notificationAttempt.findFirstOrThrow({where:{eventId:blocked.id}});
        assert.deepEqual(attempt.response,{reason:'NOT_ENABLED',generation:0,actualOutbound:false,delivery:'skipped'});
        await tx.storeSettings.update({where:{id:1},data:{waActivation:activation}});
        const queued = await notify(tx, orderId, 'TEST', randomUUID()); assert.equal(queued.status,'PENDING'); assert.equal(queued.activation,activation);
        payload = JSON.stringify({ready:false,realSendEnabled:false,activation,updatedAt:Date.now()});
        const disconnected = await notify(tx, orderId, 'TEST', randomUUID()); assert.equal(disconnected.status,'SKIPPED');
        assert.equal((await tx.notificationAttempt.findFirstOrThrow({where:{eventId:disconnected.id}})).response && JSON.stringify((await tx.notificationAttempt.findFirstOrThrow({where:{eventId:disconnected.id}})).response).includes('PROVIDER_NOT_READY'),true);
        throw rollback;
      }), error => error === rollback);
    } finally { get.mock.restore(); exists.mock.restore(); await redis.quit(); }
    const historical = await event('mock'); await deliverNotification(historical.id, 0, real); assert.equal(calls, 0); assert.equal((await db.notificationEvent.findUniqueOrThrow({ where: { id: historical.id } })).status, 'PENDING'); assert.equal(await db.notificationAttempt.count({where:{eventId:historical.id}}),0);
    const simulated = await event('mock', {status:'SIMULATED'}); const before = await db.notificationEvent.findUniqueOrThrow({where:{id:simulated.id},include:{attempts:true}}); await deliverNotification(simulated.id,0,real); assert.deepEqual(await db.notificationEvent.findUniqueOrThrow({where:{id:simulated.id},include:{attempts:true}}),before);
    const old = await event('whatsapp-web.js', { activation: 'old' }); await deliverNotification(old.id, 0, real); assert.equal(calls, 0);
    const stale = await event('whatsapp-web.js'); await db.customer.update({ where: { id: customerId }, data: { notificationConsentAt: null } }); await deliverNotification(stale.id, 0, real); assert.equal(calls, 0);
    await db.customer.update({ where: { id: customerId }, data: { notificationConsentAt: new Date() } });
    const success = await event('whatsapp-web.js'); await Promise.all([deliverNotification(success.id, 0, real), deliverNotification(success.id, 0, real)]); assert.equal(calls, 1); assert.equal((await db.notificationEvent.findUniqueOrThrow({ where: { id: success.id } })).status, 'SENT');
    const ambiguous = await event('whatsapp-web.js'); await deliverNotification(ambiguous.id, 0, { ...real, send: async () => { calls++; throw new Error('secret provider payload'); } }); await deliverNotification(ambiguous.id, 0, real); assert.equal(calls, 2);
    const attempt = await db.notificationAttempt.findFirstOrThrow({ where: { eventId: ambiguous.id } }); assert.equal(attempt.status, 'FAILED'); assert.ok(!JSON.stringify(attempt.response).includes('secret')); assert.equal((attempt.response as { retryable: boolean }).retryable, false);
    const notReady = await event('whatsapp-web.js'); await assert.rejects(deliverNotification(notReady.id, 0, { ...real, ready: false }), /DELIVERY_RETRY/); assert.equal(calls, 2);
    assert.equal((await db.notificationAttempt.findFirstOrThrow({ where: { eventId: notReady.id } })).status, 'FAILED');
  } finally {
    await db.notificationAttempt.deleteMany({ where: { eventId: { in: events } } }); await db.notificationEvent.deleteMany({ where: { id: { in: events } } });
    if (orderId) await db.order.delete({ where: { id: orderId } }); if (customerId) await db.customer.delete({ where: { id: customerId } });
    await db.session.deleteMany({ where: { userId: { in: users } } }); await db.auditLog.deleteMany({ where: { actorUserId: { in: users } } }); await db.user.deleteMany({ where: { id: { in: users } } }); await db.$disconnect();
  }
});
