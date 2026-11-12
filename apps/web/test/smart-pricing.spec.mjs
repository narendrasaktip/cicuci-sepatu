import process from 'node:process';
import { test, expect } from '@playwright/test';

const customer = { id: 'customer', name: 'Fixture', whatsapp: '+628111111111' };
const pricing = { version: 1, mode: 'PROMO', serviceId: 'service', stage: 'FINAL', pairs: 4, initialTotalIdr: 210000, totalIdr: 175000, lockedAt: null };
const item = { id: 'shoe', serviceId: 'service', serviceName: 'Clean', brand: 'Nike', model: 'Air', color: 'Putih', status: 'RECEIVED', outcome: null, quotedPriceIdr: 42000, finalPriceIdr: 0, consents: [], photos: [{ id: 'before', kind: 'BEFORE', customerVisible: true }], history: [] };
function order(items = [item]) { return { id: 'order', number: 'CS-FIXTURE', customer, items, payments: [], pricing: { ...pricing }, totalIdr: 175000, paidIdr: 0, balanceIdr: 175000, paymentStatus: 'UNPAID', aggregateStatus: 'WAITING_INSPECTION', estimatedCompletionAt: '2026-11-15T16:59:59.999Z', pickupInstructions: '' }; }
async function routes(page, handler) {
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const handled = await handler(path, request);
    let body = { data: [], page: { nextCursor: null } };
    if (handled) { await route.fulfill(handled); return; }
    if (path.endsWith('/auth/me')) body = { user: { id: 'owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' };
    else if (path.endsWith('/dashboard')) body = {};
    else if (path.endsWith('/pricing/plans')) body = [{ id: 'custom-plan', name: 'Tarif khusus', isActive: true, revision: 1, rules: [{ kind: 'PER_PAIR', minPairs: 1, maxPairs: null, priceIdr: 50000 }] }];
    else if (path.endsWith('/pricing/preview')) body = { totalIdr: 50000, breakdown: [] };
    else if (path.endsWith('/services')) body.data = [{ id: 'service', name: 'Clean', basePriceIdr: 50000 }];
    else if (path.endsWith('/customers')) body.data = [customer];
    await route.fulfill({ json: body });
  });
}
async function newOrder(page) {
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
  await page.getByLabel('Cari pelanggan').fill('Fixture');
  await page.getByRole('button', { name: 'Fixture · +628111111111', exact: true }).click();
}

test('smart intake: one order mode, automatic service, no manual price, retry stable, automatic date preserved', async ({ page }) => {
  const submissions = []; const keys = []; const serviceRequests = [];
  await routes(page, async (path, request) => {
    if (path.endsWith('/services')) serviceRequests.push(path);
    if (path.endsWith('/orders') && request.method() === 'POST') {
      submissions.push(request.postDataJSON()); keys.push(request.headers()['idempotency-key']);
      return submissions.length === 1 ? { status: 503, json: { error: { message: 'Coba lagi' } } } : { json: { ...order([]), notification: { status: 'SKIPPED', actualOutbound: false } } };
    }
  });
  await newOrder(page);
  await page.getByLabel('Tarif pesanan').selectOption('custom-plan');
  await expect(page.getByLabel('Layanan paket (semua pasangan)')).toHaveCount(0);
  const shoe = page.getByRole('group', { name: 'Sepatu 1', exact: true });
  await shoe.getByLabel('Merek *', { exact: true }).fill('Nike');
  await shoe.getByLabel('Model (opsional)', { exact: true }).fill('Air');
  await shoe.getByLabel('Warna (opsional)', { exact: true }).fill('Putih');
  await expect(page.getByLabel('Penawaran (Rp) *')).toHaveCount(0);
  await expect(page.locator('input[type="datetime-local"], input[type="date"]')).toHaveCount(0);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Coba lagi');
  expect(serviceRequests).toEqual([]);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Pesanan tersimpan.' })).toBeVisible();
  expect(submissions).toHaveLength(2); expect(submissions[0]).toEqual(submissions[1]); expect(keys[0]).toBe(keys[1]);
  expect(submissions[0]).toMatchObject({ ratePlanId: 'custom-plan' });
  expect(submissions[0]).not.toHaveProperty('packageServiceId'); expect(submissions[0].items[0]).not.toHaveProperty('serviceId');
  expect(submissions[0].items[0]).not.toHaveProperty('quotedPriceIdr'); expect(submissions[0]).not.toHaveProperty('estimatedCompletionAt');
});

test('tracking final total requires explicit price consent; locked/refund due truthful', async ({ page }) => {
  const saved = order([{ ...item, status: 'RETURN_PENDING', outcome: 'REJECTED', finalPriceIdr: 0 }]); const calls = [];
  await routes(page, async (path, request) => {
    if (path.endsWith('/pricing/confirm')) { calls.push(request.postDataJSON()); saved.pricing.stage = 'LOCKED'; saved.refundDueIdr = 35000; return { json: { confirmed: true } }; }
    if (path.includes('/track/')) return { json: saved };
  });
  await page.goto(`http://127.0.0.1:5173/track/${'a'.repeat(64)}`);
  await expect(page.getByText('Total final · menunggu persetujuan harga sebelum pengerjaan')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setujui dan kunci harga' })).toBeDisabled(); expect(calls).toHaveLength(0);
  await page.getByRole('checkbox', { name: /Saya menyetujui total final/ }).check();
  await page.getByRole('button', { name: 'Setujui dan kunci harga' }).click();
  await expect(page.getByRole('heading', { name: 'Harga disetujui dan terkunci' })).toBeVisible();
  expect(calls).toEqual([{ totalIdr: 175000, confirmed: true }]);
  await expect(page.getByText(/Kelebihan bayar \/ perlu pengembalian:/)).toContainText('35.000');
});

test('smart inspection rejection sends no manual price; final pricing visible before work', async ({ page }) => {
  const saved = order(); const calls = [];
  saved.pricing.stage = 'ESTIMATE';
  await routes(page, async (path, request) => {
    if (path.endsWith('/orders')) return { json: { data: [saved], page: { nextCursor: null } } };
    if (path.endsWith('/orders/order')) return { json: saved };
    if (path.endsWith('/inspection')) {
      calls.push(request.postDataJSON()); saved.items[0].outcome = 'REJECTED'; saved.items[0].status = 'RETURN_PENDING'; saved.pricing.stage = 'FINAL'; saved.pricing.pairs = 0; saved.totalIdr = 0;
      return { json: { order: saved } };
    }
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: /CS-FIXTURE/ }).click();
  await page.getByRole('button', { name: /Periksa sepatu/ }).click();
  await expect(page.getByLabel('Penawaran (Rp)', { exact: true })).toHaveCount(0);
  await page.getByLabel('Hasil pemeriksaan').selectOption('REJECTED');
  await page.getByLabel('Catatan pemeriksaan internal').fill('Tidak aman');
  await page.getByRole('dialog').getByRole('button', { name: /Simpan/ }).click();
  await expect(page.getByRole('heading', { name: 'Total final · menunggu persetujuan harga sebelum pengerjaan' })).toBeVisible();
  expect(calls).toHaveLength(1); expect(calls[0]).not.toHaveProperty('quotedPriceIdr'); expect(calls[0].outcome).toBe('REJECTED');
});

for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`tariff information from server; legacy management retained: ${role}`, async ({ page }) => {
  const mutations = []; const requests = [];
  const plans = [{ id: 'custom-plan', name: 'Tarif khusus', isActive: true, revision: 1, rules: [{ kind: 'PER_PAIR', minPairs: 1, maxPairs: null, priceIdr: 50000 }] }];
  await routes(page, async (path, request) => {
    requests.push(path); if (request.method() !== 'GET') mutations.push(path);
    if (path.endsWith('/auth/me')) return { json: { user: { id: 'owner', name: 'Fixture', role }, csrfToken: 'fixture' } };
    if (path.endsWith('/pricing/plans')) return { json: plans };
    if (path.endsWith('/services')) return { json: { data: [{ id: 'legacy', name: 'Layanan historis', basePriceIdr: 999999, isActive: false }, { id: 'cicuci-cleaning-v1', name: 'Cuci sepatu', basePriceIdr: 0, isActive: true }], page: { nextCursor: null } } };
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Tarif pesanan', exact: true }).click();
  const plan = page.getByRole('article').filter({ hasText: 'Tarif khusus' });
  await expect(plan).toBeVisible(); await expect(plan).toContainText('50.000');
  expect(requests.filter(p => p.endsWith('/services'))).toEqual([]);
  await expect(page.getByText('Layanan historis', { exact: true })).not.toBeVisible();
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
  await expect(page.getByText('Layanan historis', { exact: true })).toBeVisible();
  await expect(plan).not.toContainText('999.999');
  const legacy = page.getByRole('article').filter({ hasText: 'Layanan historis' });
  await expect(legacy.getByRole('button', { name: 'Ubah layanan / keaktifan' })).toHaveCount(role === 'OWNER' ? 1 : 0);
  await expect(page.getByRole('article').filter({ hasText: 'Cuci sepatu' }).getByRole('button')).toHaveCount(0);
  if (role === 'OWNER') {
    await legacy.getByRole('button').click(); await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Harga dasar (Rp)')).toHaveValue('999999');
  }
  expect(mutations).toEqual([]);
});

for (const edit of [false, true]) test(`optional model/color in ${edit ? 'edit' : 'add'} shoe dialog`, async ({ page }) => {
  const saved = order([{ ...item, status: 'RECEIVED', outcome: null, model: '', color: '' }]); saved.pricing.stage = 'ESTIMATE';
  const calls = [];
  await routes(page, async (path, request) => {
    if (path.endsWith('/orders')) return { json: { data: [saved], page: { nextCursor: null } } };
    if (path.endsWith('/orders/order')) return { json: saved };
    if (request.method() !== 'GET') { calls.push(request.postDataJSON()); return { json: {} }; }
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: /CS-FIXTURE/ }).click();
  await expect(page.getByRole('heading', { name: 'Nike', exact: true })).toBeVisible();
  if (edit) await page.getByText('Detail lainnya', { exact: true }).click();
  await page.getByRole('button', { name: edit ? 'Ubah sepatu' : 'Tambah sepatu', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Merek *', { exact: true })).toHaveAttribute('required', '');
  for (const label of ['Model (opsional)', 'Warna (opsional)']) {
    await expect(dialog.getByLabel(label, { exact: true })).not.toHaveAttribute('required');
    await expect(dialog.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await dialog.getByLabel('Merek *', { exact: true }).fill('Nike');
  await dialog.getByLabel('Layanan aktif *', { exact: true }).selectOption('service');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(calls).toEqual([{ serviceId: 'service', brand: 'Nike', model: '', color: '', initialNotes: '' }]);
});
