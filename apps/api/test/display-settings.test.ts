import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { defaultTrackingStages, trackingStagesInput, publicDisplay, defaultStatusLabels, displaySettings, publicLabels, publicOriginInput, statusLabelsInput } from '../src/services/display-settings.js';

test('display validation, contextual defaults, whitelist, canonical origin', () => {
  const defaults = displaySettings(null);
  assert.equal(defaults.publicOrigin, 'http://127.0.0.1:5173');
  assert.equal(defaults.statusLabels['shoe.RECEIVED'], 'Waiting List');
  assert.equal(defaults.statusLabels['shoe.READY_FOR_PICKUP'], 'Selesai Dikerjakan');
  assert.equal(defaults.statusLabels['history.READY_FOR_PICKUP'], 'Selesai Dikerjakan');
  assert.equal(defaults.statusLabels['order.READY_FOR_PICKUP'], 'Siap Diambil');
  for (const code of ['AWAITING_CONSENT','REWORK','RETURN_PENDING','RETURNED','HANDED_OVER']) for (const context of ['shoe','history','order']) assert.ok(defaults.statusLabels[`${context}.${code}`]);
  assert.deepEqual(statusLabelsInput.parse({ 'shoe.RECEIVED': '  Diterima  ' }), { 'shoe.RECEIVED': 'Diterima' });
  for (const input of [{ NEW: 'new' }, { 'shoe.RECEIVED': '<b>x</b>' }, { 'shoe.RECEIVED': ' ' }, { 'shoe.RECEIVED': 'a'.repeat(81) }, { 'shoe.RECEIVED': 'x\ny' }]) assert.equal(statusLabelsInput.safeParse(input).success, false);
  assert.equal(publicOriginInput.parse(' https://EXAMPLE.com:443/ '), 'https://example.com');
  for (const origin of ['http://127.0.0.1:5173/', 'http://localhost:5173', 'http://[::1]:5173']) assert.ok(publicOriginInput.safeParse(origin).success);
  for (const origin of ['http://example.com','javascript:alert(1)','https://user:pass@example.com','https://example.com/path','https://example.com/?x=1','https://example.com/#x','https://bad_host.com','https://-bad.com','https://example.com/../','https://example.com?','https://example.com#']) assert.equal(publicOriginInput.safeParse(origin).success, false, origin);
  const safe = publicLabels(defaults);
  assert.ok(Object.keys(safe).every(key => /^(shoe|history|order)\./.test(key)));
  assert.equal(safe['admin.RECEIVED'], undefined);
  assert.equal(displaySettings({}, 'https://legacy.example').publicOrigin, 'https://legacy.example');
});

test('ordered display stages: defaults, legacy, validation, explicit public projection', () => {
  assert.deepEqual(displaySettings({ statusLabels: { 'history.RECEIVED': 'Legacy' } }).trackingStages, defaultTrackingStages);
  const custom = { id: 'custom.fixture', anchor: 'WASHING', name: 'Informasi', visible: true };
  const stages = [custom, ...defaultTrackingStages.slice().reverse()];
  assert.deepEqual(trackingStagesInput.parse(stages), stages);
  for (const value of [[custom, custom], [{ ...custom, anchor: 'QC' }], [{ ...custom, id: 'arbitrary' }], [{ ...custom, name: '<b>bad</b>' }], [{ ...custom, name: 'x\ny' }], [{ ...custom, name: ' ' }], [{ ...custom, name: 'a'.repeat(81) }], [{ ...custom, completed: true }], Array.from({ length: 21 }, (_, i) => ({ ...custom, id: `custom.${i}` })), [{ ...defaultTrackingStages[0], anchor: 'WASHING' }]]) assert.equal(trackingStagesInput.safeParse(value).success, false);
  assert.deepEqual(trackingStagesInput.parse([]), []);
  const value = displaySettings({ trackingStages: [{ ...custom, visible: false }, defaultTrackingStages[0]] });
  assert.deepEqual(publicDisplay(value).trackingStages, [defaultTrackingStages[0]]);
  assert.doesNotMatch(JSON.stringify(publicDisplay(value)), /publicOrigin|admin\.|completed|timestamp/);
});

test('isolated HTTP: owner persistence/reset, CSRF/idempotency/audit, role-safe reads, public privacy, immutable snapshot links', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL = 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'http://127.0.0.1:5173'; process.env.WA_MESSAGE_KEY = 'a'.repeat(64);
  let role = 'OWNER', authenticated = true, failAudit = false;
  let profile = { id: 1, name: 'Cicuci Sepatu', pickupInstructions: '', consentHours: 48 };
  let display: unknown = null;
  const audits: { action: string }[] = [], cache = new Map<string, unknown>();
  const oldNotifications = [{ encryptedMessage: 'immutable historical ciphertext', message: '[tautan privat]', status: 'SIMULATED' }];
  const preserved = structuredClone(oldNotifications);
  const fake = {
    session: { findUnique: async () => authenticated ? { user: { id: 'owner', role, isActive: true }, csrfToken: 'csrf', expiresAt: new Date(Date.now() + 60000) } : null },
    user: { findUnique: async () => ({ isActive: true, role }) },
    storeSettings: { findUnique: async () => ({ ...profile, waActivation: 'PRIVATE', waTemplates: ['PRIVATE'] }), upsert: async ({ update }: { update: Partial<typeof profile> }) => { profile = { ...profile, ...update }; return profile; } },
    $queryRaw: async (sql: TemplateStringsArray) => sql.join('').includes('SELECT displaySettings') ? [{ displaySettings: display }] : [],
    $executeRaw: async (_sql: unknown, value: string) => { display = JSON.parse(value); return 1; },
    idempotency: { findUnique: async ({ where }: { where: { id: string } }) => cache.get(where.id) ?? null, create: async ({ data }: { data: { id: string } }) => { cache.set(data.id, data); return data; }, update: async ({ where, data }: { where: { id: string }; data: object }) => { cache.set(where.id, { ...cache.get(where.id) as object, ...data }); return data; } },
    auditLog: { create: async ({ data }: { data: { action: string } }) => { if (failAudit && data.action === 'SETTINGS_UPDATED') throw new Error('fixture audit failure'); audits.push(data); return data; } },
    order: { findUnique: async () => ({ number: 'FIXTURE', createdAt: new Date(), estimatedCompletionAt: new Date(), aggregateStatus: 'READY_FOR_PICKUP', pickupInstructions: '', pricing: null, payments: [], items: [{ id: 'shoe', brand: 'Fixture', model: '', color: '', serviceName: 'Cuci', status: 'DRYING', outcome: 'APPROVED', quotedPriceIdr: 0, finalPriceIdr: 0, inspection: { risk: 'Safety fixture' }, consents: [], photos: [], history: [{ toStatus: 'RECEIVED', createdAt: new Date('2026-11-10T01:00:00Z') }, { toStatus: 'AWAITING_CONSENT', createdAt: new Date('2026-11-10T02:00:00Z') }, { toStatus: 'WASHING', createdAt: new Date('2026-11-10T03:00:00Z') }] }] }) },
    $transaction: async (run: (tx: unknown) => unknown) => { const before = structuredClone({ profile, display, audits, cache }); try { return await run(fake); } catch (error) { profile = before.profile; display = before.display; audits.splice(0, audits.length, ...before.audits); cache.clear(); for (const [key, value] of before.cache) cache.set(key, value); throw error; } },
  };
  Reflect.set(globalThis, Symbol.for('display.fake'), fake);
  const url = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("display.fake")];');
  const control = 'data:text/javascript,' + encodeURIComponent('export const controlQueue = () => { throw new Error("NO_LIVE_QUEUE"); }; export const controlRedis = controlQueue; export const lockKey = "fixture"; export const sign = controlQueue; export const workerSnapshot = controlQueue; export const notificationBlocker = async () => "NOT_ENABLED";');
  const hook = registerHooks({ resolve(s, context, next) { return /(?:^|\/)db\.js$/.test(s) ? { url, shortCircuit: true } : s.endsWith('/lib/whatsapp-control.js') ? { url: control, shortCircuit: true } : next(s, context); } });
  const { app } = await import('../src/app.js');
  const { notify } = await import('../src/services/orders.js');
  const { hashToken } = await import('../src/lib/security.js');
  const { trackingLink, seal, unseal } = await import('../src/services/whatsapp-templates.js');
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve)); const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (path: string, method = 'GET', body?: unknown, csrf = 'csrf', key = crypto.randomUUID()) => fetch(`http://127.0.0.1:${address.port}/api/v1${path}`, { method, headers: { Cookie: `cicuci_session=${'a'.repeat(64)}`, 'X-CSRF-Token': csrf, 'Idempotency-Key': key, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  try {
    let result = await (await call('/settings')).json(); assert.equal(result.publicOrigin, 'http://127.0.0.1:5173'); assert.deepEqual(result.statusLabels, defaultStatusLabels); assert.deepEqual(result.trackingStages, defaultTrackingStages); assert.equal(result.trackingStagesVersion, 1);
    assert.equal(display, null); // GET never provisions.
    authenticated = false; assert.equal((await call('/display-settings')).status, 401); authenticated = true;
    for (role of ['ADMIN','STAFF']) { assert.equal((await call('/settings')).status, 403); assert.equal((await call('/display-settings')).status, 200); assert.equal((await call('/settings','PATCH',{})).status, 403); }
    role = 'OWNER'; assert.equal((await call('/settings','PATCH',{},'wrong')).status, 403);
    for (const input of [{ statusLabels: { UNKNOWN: 'bad' } }, { publicOrigin: 'http://evil.example' }, { transitions: [] }]) assert.equal((await call('/settings','PATCH',input)).status, 400);
    const key = crypto.randomUUID(), input = { name: 'Updated', publicOrigin: 'https://tracking.example/', statusLabels: { 'shoe.READY_FOR_PICKUP': 'Siap bersih' } };
    const snapshot = seal({ message: trackingLink('https://old.example', 'b'.repeat(64)), trackingHash: 'c'.repeat(64) });
    assert.equal((await call('/settings','PATCH',input,'csrf',key)).status, 200);
    assert.equal((await call('/settings','PATCH',input,'csrf',key)).status, 200);
    assert.equal(audits.filter(a => a.action === 'SETTINGS_UPDATED').length, 1);
    assert.equal((await call('/settings','PATCH',{ name: 'different' },'csrf',key)).status, 409);
    result = await (await call('/settings')).json(); assert.equal(result.name,'Updated'); assert.equal(result.publicOrigin,'https://tracking.example'); assert.equal(result.statusLabels['shoe.READY_FOR_PICKUP'],'Siap bersih');
    const stages = [{ id: 'custom.detail', name: 'Detail Tambahan', anchor: 'WASHING', visible: true }, ...defaultTrackingStages.slice().reverse()];
    assert.equal((await call('/settings','PATCH',{ trackingStages: stages })).status, 200);
    result = await (await call('/settings')).json(); assert.deepEqual(result.trackingStages, stages);
    assert.equal((await call('/settings','PATCH',{ name: 'Toko baru', consentHours: 36 })).status, 200);
    result = await (await call('/settings')).json(); assert.deepEqual(result.trackingStages, stages);
    assert.equal((await call('/settings','PATCH',{ trackingStages: [stages[0], stages[0]] })).status, 400);
    const originalTimeline = (await (await call(`/track/${'b'.repeat(64)}`)).json()).items[0].timeline;
    const hidden = stages.map(stage => ({ ...stage, visible: false }));
    await call('/settings','PATCH',{ trackingStages: hidden });
    assert.deepEqual((await (await call(`/track/${'b'.repeat(64)}`)).json()).trackingStages, []);
    await call('/settings','PATCH',{ trackingStages: stages.slice(1) });
    assert.deepEqual((await (await call('/settings')).json()).trackingStages, stages.slice(1));
    const track = await (await call(`/track/${'b'.repeat(64)}`)).json(); assert.deepEqual(track.items[0].timeline, originalTimeline); assert.equal(track.items[0].risk, 'Safety fixture'); assert.deepEqual(track.items[0].timeline.map((event: { status: string }) => event.status), ['RECEIVED', 'AWAITING_CONSENT', 'WASHING']); assert.equal(track.statusLabels['shoe.READY_FOR_PICKUP'],'Siap bersih'); assert.doesNotMatch(JSON.stringify(track), /PRIVATE|waActivation|waTemplates|publicOrigin|admin\./);
    const link = trackingLink(result.publicOrigin, 'b'.repeat(64), 'd'.repeat(64), 'item'); assert.ok(link.startsWith('https://tracking.example/track/')); assert.ok(link.includes('#approval='));
    const raw = 'b'.repeat(64); let event: Record<string, unknown> | undefined;
    const order = { id: 'order', number: 'FIXTURE', trackingHash: hashToken(raw), trackingSecret: seal(raw), customer: { name: 'Fixture', whatsapp: '+628123456789', notificationConsentAt: new Date() }, items: [{ id: 'shoe', brand: 'Fixture', model: '', color: '', serviceName: 'Cuci' }] };
    const notificationTx = { ...fake, consentDecision: { findUnique: async ({ where }: { where: { id: string } }) => { assert.equal(where.id, 'new-key'); return { findings: 'Fixture findings', risk: 'Fixture risk', customerNote: 'Fixture customer note' }; } }, storeSettings: { findUnique: async () => ({ waTemplates: null, waActivation: null }) }, order: { findUniqueOrThrow: async () => order }, notificationEvent: { findUnique: async () => event, upsert: async ({ create }: { create: Record<string, unknown> }) => { event ??= { ...create, id: 'event' }; return event; } } };
    await notify(notificationTx as never, 'order', 'ORDER_RECEIVED', 'event-key');
    assert.equal(event!.status, 'SKIPPED'); const originalEvent = structuredClone(event);
    const payload = unseal(String(event!.encryptedMessage)) as { message: string }; assert.match(payload.message, /https:\/\/tracking\.example\/track\//);
    await call('/settings','PATCH',{ publicOrigin: 'https://new.example' });
    await notify(notificationTx as never, 'order', 'ORDER_RECEIVED', 'event-key'); assert.deepEqual(event, originalEvent);
    event = undefined; await notify(notificationTx as never, 'order', 'CONSENT_REQUEST', 'new-key', 'shoe', 'AWAITING_CONSENT');
    assert.equal(typeof event!.encryptedMessage, 'string', 'consent snapshot must be generated before decryption');
    const consentPayload = unseal(String(event!.encryptedMessage)) as { message: string };
    assert.match(consentPayload.message, /https:\/\/new\.example\/track\//); assert.doesNotMatch(consentPayload.message, /#approval=/);
    assert.match(consentPayload.message, /Temuan: Fixture findings\nRisiko: Fixture risk\nCatatan: Fixture customer note/);
    await call('/settings','PATCH',{ publicOrigin: 'https://tracking.example' });
    assert.deepEqual(unseal(snapshot), { message: trackingLink('https://old.example', 'b'.repeat(64)), trackingHash: 'c'.repeat(64) }); assert.deepEqual(oldNotifications, preserved);
    await call('/settings','PATCH',{ consentHours: 24 }); result = await (await call('/settings')).json(); assert.equal(result.statusLabels['shoe.READY_FOR_PICKUP'],'Siap bersih');
    const beforeStages = (await (await call('/settings')).json()).trackingStages;
    failAudit = true; assert.equal((await call('/settings','PATCH',{ trackingStages: [] })).status,500); assert.deepEqual((await (await call('/settings')).json()).trackingStages, beforeStages); assert.equal((await call('/settings','PATCH',{ publicOrigin: 'https://rollback.example' })).status,500); failAudit = false;
    assert.equal((await (await call('/settings')).json()).publicOrigin,'https://tracking.example');
    await call('/settings','PATCH',{ statusLabels: {} }); result = await (await call('/settings')).json(); assert.deepEqual(result.statusLabels, defaultStatusLabels);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); hook.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('display.fake')); }
});
