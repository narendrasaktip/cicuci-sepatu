import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { PrismaClient } from '@prisma/client';
import { randomToken, hashToken } from '../src/lib/security.js';
test('actual worker Chromium creates owner-only QR without scan or send', { skip: process.env.RUN_WA_QR_TEST !== '1', timeout: 120000 }, async () => {
  assert.equal(new URL(process.env.DATABASE_URL!).pathname, '/cicuci_sepatu_dev');
  const db = new PrismaClient(); const prefix = `qr-test-${randomUUID()}`;
  const owner = await db.user.create({ data: { email: `${prefix}@example.test`, name: prefix, role: 'OWNER', passwordHash: 'unused' } });
  const raw = randomToken(); const csrf = randomToken(); const base = 'http://127.0.0.1:3000/api/v1/whatsapp';
  await db.session.create({ data: { userId: owner.id, tokenHash: hashToken(raw), csrfToken: csrf, expiresAt: new Date(Date.now() + 180000) } });
  const headers = { Cookie: `cicuci_session=${raw}`, Origin: new URL(process.env.APP_BASE_URL!).origin, 'Content-Type': 'application/json', 'X-CSRF-Token': csrf };
  async function command(name: string) { const response = await fetch(`${base}/${name}`, { method: 'POST', headers: { ...headers, 'Idempotency-Key': randomUUID() }, body: '{}' }); assert.equal(response.status, 202); }
  try {
    await command('start');
    let found = false;
    for (let n = 0; n < 100; n++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const response = await fetch(`${base}/status`, { headers }); assert.equal(response.status, 200);
      const status = await response.json() as { state: string; error?: string; qrImage?: string; qr?: string; realSendEnabled: boolean };
      assert.equal(status.realSendEnabled, false); assert.equal(status.qr, undefined);
      if (status.state === 'error') assert.fail(`Chromium initialization failed: ${status.error}`);
      if (status.qrImage) { assert.match(status.qrImage, /^data:image\/png;base64,/); found = true; break; }
    }
    assert.equal(found, true, 'QR must be generated; never print QR contents');
  } finally {
    await command('disconnect');
    for (let n = 0; n < 20; n++) { await new Promise(resolve => setTimeout(resolve, 500)); const s = await (await fetch(`${base}/status`, { headers })).json(); if (s.state === 'stopped') break; }
    const { access } = await import('node:fs/promises');
    await assert.rejects(access(new URL('../../../var/whatsapp/', import.meta.url)), { code: 'ENOENT' });
    await db.session.deleteMany({ where: { userId: owner.id } }); await db.auditLog.deleteMany({ where: { actorUserId: owner.id } }); await db.user.delete({ where: { id: owner.id } }); await db.$disconnect();
  }
});
