import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
import { defaults, eventNames, templateWrite, renderTemplate, previewValues, seal, unseal, trackingLink, deliveryPayload } from '../src/services/whatsapp-templates.js';
import { hashToken } from '../src/lib/security.js';

test('all emitted events: Indonesian defaults, literal substitution, strict placeholders and content', () => {
  assert.deepEqual(defaults.map(t => t.event).sort(), Object.keys(eventNames).sort());
  for (const definition of defaults) {
    templateWrite.parse(definition);
    const rendered = renderTemplate(definition.body, previewValues);
    assert.match(rendered, /Cicuci Sepatu/); assert.match(rendered, /Dina/); assert.match(rendered, /Sepatu Contoh Biru/); assert.doesNotMatch(rendered, /Deep Clean|Basic Clean/);
    assert.doesNotMatch(rendered, /\{[a-z_]+\}|ORDER_RECEIVED|CONSENT_REQUEST/);
  }
  const body = defaults[0]!.body;
  for (const invalid of [body + '{nama}', body + '{taotal_sepatu}', body + '{constructor}', body + '{{nama_pelanggan}}', body + '${process.env}', body + '\u0000', body + 'https://evil.test', body + '<script>alert(1)</script>', 'a'.repeat(2001), body.replace('{url_tracking}', '')]) assert.equal(templateWrite.safeParse({ ...defaults[0], body: invalid }).success, false);
  assert.match(renderTemplate(body, { ...previewValues, nama_pelanggan: '{url_tracking} $&' }), /\{url_tracking\} \$&/); // replacements never recursively evaluate customer input
});

test('secure origin, tracking and consent fragment; AES-GCM ciphertext/tamper/key rotation', () => {
  process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  const raw = 'cd'.repeat(32); const approval = 'ef'.repeat(32);
  const url = new URL(trackingLink('https://store.example', raw, approval, 'shoe-1'));
  assert.equal(url.pathname, `/track/${raw}`); assert.equal(url.search, ''); assert.equal(new URLSearchParams(url.hash.slice(1)).get('approval'), approval);
  for (const origin of ['https://evil.test/path', 'http://public.example', 'https://user:pass@store.example', 'https://store.example?q=1', 'javascript:alert(1)']) assert.throws(() => trackingLink(origin, raw));
  assert.throws(() => trackingLink('https://store.example', 'CS-001'));
  assert.match(trackingLink('http://localhost:5173', raw), /localhost/);
  const value = { message: `Halo ${url.href}`, trackingHash: hashToken(raw) };
  const cipher = seal(value); assert.ok(!cipher.includes(raw) && !cipher.includes(approval));
  assert.deepEqual(deliveryPayload.parse(unseal(cipher)), value);
  assert.throws(() => unseal(cipher.slice(0, -5) + 'AAAAA'));
  process.env.WA_MESSAGE_KEY = 'bc'.repeat(32); assert.throws(() => unseal(cipher));
});

test('outbox snapshots multiple shoes safely; consent link encrypted, snapshots immutable, legacy tracking blocked', async () => {
  process.env.DATABASE_URL ??= 'mysql://fake:fake@127.0.0.1:1/fake'; process.env.REDIS_URL ??= 'redis://127.0.0.1:1'; process.env.APP_BASE_URL = 'https://store.example'; process.env.WA_MESSAGE_KEY = 'ab'.repeat(32);
  const fake = 'data:text/javascript,' + encodeURIComponent('export async function notificationBlocker() { return undefined; }');
  const fakeDb = 'data:text/javascript,' + encodeURIComponent('export const db = {};');
  const hook = registerHooks({ resolve(s, context, next) { return s.endsWith('/lib/whatsapp-control.js') ? { url: fake, shortCircuit: true } : /(?:^|\/)db\.js$/.test(s) ? { url: fakeDb, shortCircuit: true } : next(s, context); } });
  try {
    const { notify } = await import('../src/services/orders.js');
    const raw = 'cd'.repeat(32); let saved: unknown[] = []; let created: Record<string, unknown> | undefined;
    const order = { id: 'order', number: 'CS-TEST', trackingHash: hashToken(raw), trackingSecret: seal(raw), customer: { name: 'Dina', whatsapp: '+6281234567890', notificationConsentAt: new Date(), notes: 'PRIVATE CUSTOMER' }, items: [{ id: 'shoe1', brand: 'Brand1', model: 'Model', color: 'Biru', serviceName: 'Deep Clean', initialNotes: 'PRIVATE NOTE', risk: 'PRIVATE RISK' }, { id: 'shoe2', brand: 'Brand2', model: 'Model', color: 'Putih', serviceName: 'Basic Clean' }] };
    const audits: unknown[] = [];
    const consent = { findings: 'Bagian atas kelupas', risk: 'Tidak akan bersih', customerNote: 'Coba semaksimal mungkin' };
    const tx = { consentDecision: { findUnique: async () => consent }, $queryRaw: async () => [], order: { findUniqueOrThrow: async () => order }, storeSettings: { findUnique: async () => ({ waActivation: 'activation', waTemplates: saved }) }, notificationEvent: { findUnique: async () => created, upsert: async ({ create }: { create: Record<string, unknown> }) => { created ??= { id: 'event', ...create }; return created; } }, auditLog: { create: async (v: unknown) => { audits.push(v); } } };
    await notify(tx as never, 'order', 'ORDER_RECEIVED', 'receipt');
    const first = created!; assert.equal(first.status, 'PENDING');
    const payload = deliveryPayload.parse(unseal(String(first.encryptedMessage)));
    assert.match(payload.message, /Jumlah: 2 pasang/); assert.match(payload.message, /\*Rincian pesanan\*/); assert.match(payload.message, /_Terima kasih telah memilih Cicuci Sepatu\._/); assert.match(payload.message, /• Brand1 Model Biru/); assert.match(payload.message, /• Brand2 Model Putih/); assert.doesNotMatch(payload.message, /Deep Clean|Basic Clean/); assert.match(payload.message, new RegExp(raw));
    assert.doesNotMatch(payload.message, /PRIVATE/); assert.doesNotMatch(JSON.stringify(audits), /Dina|Brand1|cdcd|efef/);
    assert.doesNotMatch(String(first.message), /cdcd|Dina/);
    saved = ['ORDER_RECEIVED', 'CONSENT_REQUEST', 'WASHING', 'READY_FOR_PICKUP'].map(event => {
      const definition = defaults.find(t => t.event === event)!;
      return { ...definition, body: definition.body.replace('Halo {sapaan}', `Kustom ${event} {sapaan}`) };
    });
    await notify(tx as never, 'order', 'ORDER_RECEIVED', 'receipt'); assert.equal(created, first);
    for (const event of ['ORDER_RECEIVED', 'WASHING', 'READY_FOR_PICKUP']) {
      created = undefined; await notify(tx as never, 'order', event, `custom-${event}`, event === 'WASHING' ? 'shoe1' : undefined);
      assert.match(deliveryPayload.parse(unseal(String(created!.encryptedMessage))).message, new RegExp(`Kustom ${event}`));
      assert.match(String(created!.message), new RegExp(`Kustom ${event}`));
    }
    created = undefined; await notify(tx as never, 'order', 'CONSENT_REQUEST', 'consent', 'shoe1', 'AWAITING_CONSENT');
    assert.doesNotMatch(deliveryPayload.parse(unseal(String(created!.encryptedMessage))).message, /#approval=/);
    const structured = deliveryPayload.parse(unseal(String(created!.encryptedMessage))).message;
    assert.match(structured, /Kustom CONSENT_REQUEST/); assert.match(structured, /Temuan: Bagian atas kelupas/); assert.match(structured, /Risiko: Tidak akan bersih/); assert.match(structured, /Catatan: Coba semaksimal mungkin/); assert.doesNotMatch(structured, /PRIVATE/);
    const snapshot = created!.encryptedMessage;
    consent.findings = 'Changed'; await notify(tx as never, 'order', 'CONSENT_REQUEST', 'consent', 'shoe1', 'AWAITING_CONSENT'); assert.equal(created!.encryptedMessage, snapshot);
    created = undefined; consent.findings = ''; consent.customerNote = '';
    await notify(tx as never, 'order', 'CONSENT_REQUEST', 'legacy', 'shoe1', 'AWAITING_CONSENT');
    const legacy = deliveryPayload.parse(unseal(String(created!.encryptedMessage))).message;
    assert.match(legacy, /Deskripsi risiko \(legacy\): Tidak akan bersih/); assert.doesNotMatch(legacy, /Temuan:|Catatan:/);
    order.trackingSecret = ''; created = undefined; await notify(tx as never, 'order', 'WASHING', 'wash', 'shoe1', 'WASHING'); assert.equal(created!.status, 'SKIPPED');
    assert.doesNotMatch(JSON.stringify(created), /cdcd|efef|PRIVATE/);
  } finally { hook.deregister(); }
});
