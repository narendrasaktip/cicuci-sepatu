import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
test('running BullMQ worker skips unactivated outbox; never sends', { skip: process.env.RUN_QUEUE_TESTS !== '1', timeout: 20000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/cicuci_sepatu_dev');
  const db = new PrismaClient();
  const event = await db.notificationEvent.create({ data: { eventKey: `queue-test-${randomUUID()}`, recipient: '+628123456789', template: 'QUEUE_CHECK', message: 'No activation; must not send', provider:'whatsapp-web.js', optedIn: true } });
  try {
    let current = event;
    for (let n = 0; n < 100 && current.status === 'PENDING'; n++) { await new Promise(resolve => setTimeout(resolve, 100)); current = await db.notificationEvent.findUniqueOrThrow({ where: { id: event.id } }); }
    assert.equal(current.status, 'SKIPPED');
    const attempts = await db.notificationAttempt.findMany({ where: { eventId: event.id } });
    assert.equal(attempts.length, 1); assert.equal(attempts[0]?.status, 'SKIPPED'); assert.equal((attempts[0]?.response as { actualOutbound: boolean }).actualOutbound, false);
  } finally { await db.notificationAttempt.deleteMany({ where: { eventId: event.id } }); await db.notificationEvent.delete({ where: { id: event.id } }); await db.$disconnect(); }
});
