import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaults, previewValues, receiptValues, renderTemplate, templateWrite } from '../src/services/whatsapp-templates.js';
import { initialPricing, planPricing } from '../src/services/pricing.js';
import { defaultRules } from '../src/services/rate-rules.js';

const item = { id: '1', outcome: null, status: 'RECEIVED', serviceName: 'Normal' };
const receipt = (pricing: unknown, items: Parameters<typeof receiptValues>[0]['items'] = [item]) => receiptValues({ pricing, estimatedCompletionAt: null, items });

test('receipt breakdown uses saved package and actual per-pair rates', () => {
  const pricing = planPricing({ id: 'plan', name: 'Normal', revision: 1, rules: defaultRules('NORMAL') }, 'service', 4);
  const values = receipt(pricing);
  assert.equal(values.layanan_tarif, 'Normal');
  assert.doesNotMatch(values.rincian_harga, /Estimasi|Total:/);
  assert.equal(values.rincian_harga, 'Paket 3 pasang: 1 × Rp145.000 = Rp145.000\n• Paket 1 pasang: 1 × Rp50.000 = Rp50.000');
  assert.doesNotMatch(values.rincian_harga, /\/pasang/);
  const range = receipt(planPricing({ id: 'plan', name: 'Normal', revision: 1, rules: defaultRules('NORMAL') }, 'service', 6));
  assert.match(range.rincian_harga, /6 pasang × Rp45\.000\/pasang = Rp270\.000/);
  assert.match(receipt(initialPricing('PROMO', 'service', 3)).rincian_harga, /Paket 3 pasang: 1 × Rp130\.000 = Rp130\.000/);
});

test('receipt falls back honestly for legacy and mismatched snapshots', () => {
  assert.match(receipt(null).rincian_harga, /tidak tersedia/);
  const pricing = initialPricing('NORMAL', 'service', 3);
  const mismatch = receipt({ ...pricing, totalIdr: 120000 });
  assert.match(mismatch.rincian_harga, /Rincian paket tidak tersedia/);
  assert.match(mismatch.estimasi_total, /Rp120\.000/);
  assert.doesNotMatch(mismatch.rincian_harga, /\/paket|\/pasang/);
  assert.match(receipt({ ...pricing, stage: 'FINAL' }).estimasi_total, /estimasi, belum final/);
  assert.match(receipt({ ...pricing, stage: 'FINAL' }, [{ ...item, outcome: 'APPROVED', status: 'QUEUED' }]).estimasi_total, /total final tersimpan/);
  assert.equal(receiptValues({ pricing, estimatedCompletionAt: new Date('2026-11-13T18:00:00Z'), items: [item] }).estimasi_selesai, '14 November 2026 WIB');
});

test('receipt-only placeholder validates and renders without changing saved templates', () => {
  const original = defaults.find(t => t.event === 'ORDER_RECEIVED')!;
  const customized = { ...original, body: `${original.body}\n{rincian_harga}` };
  assert.equal(templateWrite.safeParse(original).success, true);
  assert.equal(templateWrite.safeParse(customized).success, true);
  assert.match(renderTemplate(customized.body, previewValues), /2 × Rp45\.000 = Rp90\.000/);
  assert.equal(templateWrite.safeParse({ ...customized, event: 'WASHING' }).success, false);
  assert.equal(templateWrite.safeParse({ ...original, body: original.body + ' {unknown}' }).success, false);
  assert.equal(renderTemplate(original.body, { ...previewValues, layanan_tarif: '{url_tracking}' }).includes('{url_tracking}'), true);
  const unpaid = defaults.find(t => t.event === 'PICKUP_BILL_UNPAID');
  assert.ok(unpaid);
  assert.equal(templateWrite.safeParse(unpaid).success, true);
  assert.equal(templateWrite.safeParse({ ...unpaid, event: 'PICKUP_BILL_PAID' }).success, false);
});
