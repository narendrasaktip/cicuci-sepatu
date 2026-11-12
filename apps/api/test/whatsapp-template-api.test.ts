import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';

test('template HTTP: authorized reads/preview, owner writes, CSRF, sanitized audit and settings persistence', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://localhost:5173';
  let role = 'OWNER'; let stored: unknown = null; const writes: Record<string, unknown>[] = [];
  const fake = {
    session: { findUnique: async () => ({ user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) }) },
    storeSettings: { findUnique: async () => ({ waTemplates: stored }), findUniqueOrThrow: async () => ({ waTemplates: stored }), upsert: async () => ({}), update: async ({ data }: { data: { waTemplates: unknown } }) => { stored = data.waTemplates; return {}; } },
    user: { findUnique: async () => ({ role, isActive: true }) },
    idempotency: { findUnique: async () => null, create: async () => ({}), update: async () => ({}) },
    auditLog: { create: async ({ data }: { data: Record<string, unknown> }) => { writes.push(data); return {}; } },
    $queryRaw: async () => [], $executeRaw: async () => 1, $transaction: async (run: (tx: unknown) => unknown) => run(fake),
  };
  Reflect.set(globalThis, Symbol.for('cicuci.templates.api'), fake);
  const url = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("cicuci.templates.api")];');
  const control = 'data:text/javascript,' + encodeURIComponent('export const controlQueue = () => { throw new Error("NO_LIVE_QUEUE"); }; export const controlRedis = controlQueue; export const lockKey = "fixture"; export const sign = controlQueue; export const workerSnapshot = controlQueue; export const notificationBlocker = async () => "NOT_ENABLED";');
  const hook = registerHooks({ resolve(s, context, next) { return /(?:^|\/)db\.js$/.test(s) ? { url, shortCircuit: true } : s.endsWith('/lib/whatsapp-control.js') ? { url: control, shortCircuit: true } : next(s, context); } });
  const { app } = await import('../src/app.js'); const server = app.listen(0, '127.0.0.1'); await new Promise<void>(r => server.once('listening', r)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (method: string, body?: unknown, csrf = 'csrf', suffix = '') => fetch(`http://127.0.0.1:${address.port}/api/v1/whatsapp-templates${suffix}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': crypto.randomUUID(), 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    const response = await call('GET'); assert.equal(response.status, 200); const data = await response.json(); const input = { ...data.templates[0], name: 'Penerimaan baru' };
    assert.equal((await call('PATCH', input, 'wrong')).status, 403);
    role = 'STAFF'; assert.equal((await call('GET')).status, 403); assert.equal((await call('PATCH', input)).status, 403);
    role = 'ADMIN'; assert.equal((await call('GET')).status, 200); assert.equal((await call('POST', input, 'csrf', '/preview')).status, 200); assert.equal((await call('PATCH', input)).status, 403);
    role = 'OWNER'; assert.equal((await call('PATCH', { ...input, body: input.body + '{bad}' })).status, 400); assert.equal((await call('PATCH', { ...input, extra: true })).status, 400);
    const preview = await call('POST', input, 'csrf', '/preview'); assert.equal(preview.status, 200); assert.match((await preview.json()).message, /Dina \(contoh\)/);
    assert.equal((await call('PATCH', input)).status, 200); const updated = await (await call('GET')).json(); assert.equal(updated.templates[0].name, input.name);
    const audited = writes.filter(w => w.action === 'WA_TEMPLATE_UPDATED'); assert.equal(audited.length, 1); assert.equal(audited[0]!.entityId, 'ORDER_RECEIVED'); assert.doesNotMatch(JSON.stringify(audited), /Penerimaan baru|url_tracking|nama_pelanggan/);
    const { settingsWrite } = await import('../src/services/catalog.js');
    const safeSettings = { id: 1, name: 'Cicuci Sepatu', pickupInstructions: '', consentHours: 24 };
    const settingsDb = { ...fake, storeSettings: { upsert: async ({ select }: { select: unknown }) => { assert.deepEqual(select, { id: true, name: true, pickupInstructions: true, consentHours: true }); return safeSettings; } } };
    const { displaySettings } = await import('../src/services/display-settings.js');
    assert.deepEqual(await settingsWrite(settingsDb as unknown as Parameters<typeof settingsWrite>[0], {}, { id: 'owner', role: 'OWNER' }), { ...safeSettings, ...displaySettings(null, 'http://localhost:5173') });
  } finally { await new Promise<void>(r => server.close(() => r())); hook.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.templates.api')); }
});
