import process from 'node:process';
import { test, expect } from '@playwright/test';

const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const rules = [{ kind: 'PACKAGE', minPairs: 3, maxPairs: 3, priceIdr: 120000 }, { kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 47000 }];
const customer = { id: 'customer', name: 'Fixture', whatsapp: '+628111111111' };
const initialPlans = () => [{ id: 'custom', name: 'Member November', isActive: true, revision: 7, rules: structuredClone(rules) }, { id: 'inactive', name: 'Arsip', isActive: false, revision: 2, rules: structuredClone(rules) }];
function savedOrder() { return { id: 'order', number: 'CS-FIXTURE', customer, items: [], payments: [], totalIdr: 98765, paidIdr: 0, balanceIdr: 98765, paymentStatus: 'UNPAID', aggregateStatus: 'WAITING_INSPECTION', estimatedCompletionAt: '2026-11-15T16:59:59.999Z', pickupInstructions: '', pricing: { version: 2, name: 'Nama saat transaksi', planId: 'deleted', revision: 7, rules, serviceId: 'service', stage: 'ESTIMATE', pairs: 1, initialTotalIdr: 98765, totalIdr: 98765, lockedAt: null } }; }
async function mock(page, role = 'OWNER', handler = () => undefined) {
  const state = { plans: initialPlans(), mutations: [], previews: [], orders: [] };
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    const override = await handler(path, request, state);
    if (override) return route.fulfill(override);
    let body = { data: [], page: { nextCursor: null } };
    if (path.endsWith('/auth/me')) body = { user: { id: 'user', name: 'Fixture', role }, csrfToken: 'fixture' };
    else if (path.endsWith('/dashboard')) body = {};
    else if (path.endsWith('/pricing/plans') && request.method() === 'GET') body = state.plans;
    else if (path.includes('/pricing/plans') && request.method() !== 'GET') {
      const input = request.postDataJSON(); state.mutations.push({ method: request.method(), path, input });
      if (request.method() === 'POST') state.plans.push({ ...input, id: 'created', revision: 1 });
      else { const index = state.plans.findIndex(p => path.endsWith(`/${p.id}`)); state.plans[index] = { ...state.plans[index], ...input, revision: input.revision + 1 }; }
      body = state.plans.at(-1);
    } else if (path.endsWith('/pricing/preview')) {
      state.previews.push(request.postDataJSON()); body = { totalIdr: 98765, breakdown: [{ kind: 'PACKAGE', quantity: 1, pairs: request.postDataJSON().pairs, priceIdr: 98765, totalIdr: 98765 }] };
    } else if (path.endsWith('/customers')) body.data = [customer];
    else if (path.endsWith('/services')) body.data = [{ id: 'legacy', name: 'Layanan historis', basePriceIdr: 999999, isActive: false }];
    else if (path.endsWith('/orders') && request.method() === 'POST') { state.orders.push(request.postDataJSON()); body = { ...savedOrder(), notification: { status: 'SKIPPED', actualOutbound: false } }; }
    else if (path.includes('/track/')) body = savedOrder();
    else if (path.endsWith('/orders/order')) body = savedOrder();
    await route.fulfill({ json: body });
  });
  return state;
}
async function tariffs(page) {
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Tarif pesanan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Member November' })).toBeVisible();
}
async function intake(page) {
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
}
async function fillOrder(page) {
  await page.getByLabel('Cari pelanggan').fill('Fixture');
  await page.getByRole('button', { name: 'Fixture · +628111111111', exact: true }).click();
  const shoe = page.getByRole('group', { name: 'Sepatu 1', exact: true });
  await shoe.getByLabel('Merek *', { exact: true }).fill('Nike');
  await shoe.getByLabel('Model (opsional)', { exact: true }).fill('Air');
  await shoe.getByLabel('Warna (opsional)', { exact: true }).fill('Putih');
}

for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`named plans permissions and legacy details: ${role}`, async ({ page }) => {
  const state = await mock(page, role); await tariffs(page);
  const card = page.getByRole('article').filter({ hasText: 'Member November' });
  await expect(card).toContainText('Paket 3 pasang · harga total paket');
  await expect(card).toContainText('47.000');
  await expect(page.getByRole('button', { name: 'Tambah tarif', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
  await expect(card.getByRole('button', { name: 'Ubah tarif / keaktifan' })).toHaveCount(role === 'OWNER' ? 1 : 0);
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layanan historis' })).toBeVisible();
  expect(state.mutations).toEqual([]);
});

test('owner edits full replacement revision, deactivates; new order excludes inactive plan', async ({ page }) => {
  const state = await mock(page); await tariffs(page);
  await page.getByRole('article').filter({ hasText: 'Member November' }).getByRole('button').click();
  await page.getByLabel('Nama tarif *').fill('Member baru');
  await page.getByLabel('Harga total paket (Rp)').first().fill('125000');
  await page.getByLabel('Tarif aktif untuk pesanan baru').uncheck();
  await page.getByRole('button', { name: 'Simpan tarif', exact: true }).click();
  const card = page.getByRole('article').filter({ hasText: 'Member baru' });
  await expect(card).toContainText('Nonaktif');
  expect(state.mutations).toEqual([{ method: 'PATCH', path: '/api/v1/pricing/plans/custom', input: { name: 'Member baru', isActive: false, turnaroundPolicy: 'REGULAR', revision: 7, rules: [{ ...rules[0], priceIdr: 125000 }, rules[1]] } }]);
  await intake(page);
  await expect(page.getByRole('alert')).toContainText('Tidak ada tarif aktif');
  await expect(page.getByLabel('Tarif pesanan').locator('option')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Buat pesanan', exact: true })).toBeDisabled();
});

test('owner adds custom package quantity and per-pair range; server preview', async ({ page }) => {
  const state = await mock(page); await tariffs(page);
  await page.getByRole('button', { name: 'Tambah tarif', exact: true }).click();
  await page.getByLabel('Nama tarif *').fill('Keluarga khusus');
  await expect(page.getByLabel('Jenis aturan')).toHaveValue('PACKAGE');
  await expect(page.getByLabel('Jumlah pasang dalam paket')).toHaveValue('1');
  await expect(page.getByLabel('Harga total paket (Rp)')).toHaveValue('1');
  await page.getByLabel('Harga total paket (Rp)').fill('47000');
  await page.getByRole('button', { name: 'Tambah aturan', exact: true }).click();
  await page.getByLabel('Jenis aturan').nth(1).selectOption('PACKAGE');
  await page.getByLabel('Jumlah pasang dalam paket').nth(1).fill('4');
  await page.getByLabel('Harga total paket (Rp)').nth(1).fill('160000');
  await page.getByRole('button', { name: 'Tambah aturan', exact: true }).click();
  await page.getByLabel('Minimal pasang', { exact: true }).fill('5');
  await page.getByLabel('Maksimal pasang (kosong = tanpa batas)').fill('9');
  await page.getByLabel('Harga per pasang (Rp)').fill('39000');
  await page.getByLabel('Jumlah pasang pratinjau').fill('8');
  await expect(page.getByRole('status').filter({ hasText: 'Estimasi server:' })).toContainText('98.765');
  await expect.poll(() => state.previews.at(-1)).toEqual({ pairs: 8, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 47000 }, { kind: 'PACKAGE', minPairs: 4, maxPairs: 4, priceIdr: 160000 }, { kind: 'PER_PAIR', minPairs: 5, maxPairs: 9, priceIdr: 39000 }] });
  await page.getByRole('button', { name: 'Simpan tarif', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Keluarga khusus' })).toBeVisible();
  expect(state.mutations[0]).toMatchObject({ method: 'POST', input: { name: 'Keluarga khusus', isActive: true, rules: state.previews.at(-1).rules } });
  expect(state.mutations[0].input).not.toHaveProperty('revision');
});

test('optimistic conflict retains draft, never silently retries', async ({ page }) => {
  let calls = 0;
  await mock(page, 'OWNER', (path, request) => {
    if (path.endsWith('/plans/custom') && request.method() === 'PATCH') { calls++; return { status: 409, json: { error: { code: 'CONFLICT' } } }; }
  });
  await tariffs(page); await page.getByRole('article').filter({ hasText: 'Member November' }).getByRole('button').click();
  await page.getByLabel('Nama tarif *').fill('Draft dipertahankan');
  await page.getByRole('button', { name: 'Simpan tarif', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('CONFLICT');
  await expect(page.getByLabel('Nama tarif *')).toHaveValue('Draft dipertahankan');
  expect(calls).toBe(1);
});

test('new order one active selector; server preview follows pairs; posts plan ID only', async ({ page }) => {
  const state = await mock(page, 'ADMIN'); await intake(page); await fillOrder(page);
  const select = page.getByLabel('Tarif pesanan'); const save = page.getByRole('button', { name: 'Buat pesanan', exact: true });
  await expect(select).toHaveCount(1); await expect(select.locator('option')).toHaveText(['Pilih tarif aktif', 'Member November']);
  await expect(save).toBeDisabled(); await select.selectOption('custom');
  await expect(save).toBeEnabled(); await expect(page.getByRole('status').filter({ hasText: 'Estimasi server:' })).toContainText('98.765');
  await page.getByRole('button', { name: 'Tambah sepatu', exact: true }).click();
  await expect.poll(() => state.previews.at(-1)?.pairs).toBe(2);
  await page.getByRole('button', { name: 'Hapus sepatu 2', exact: true }).click();
  await expect.poll(() => state.previews.at(-1)?.pairs).toBe(1);
  await save.click(); await expect(page.getByRole('status').filter({ hasText: 'Pesanan tersimpan.' })).toBeVisible();
  expect(state.orders).toHaveLength(1); expect(state.orders[0].ratePlanId).toBe('custom');
  expect(state.orders[0]).not.toHaveProperty('rateMode'); expect(state.orders[0].items[0]).not.toHaveProperty('serviceId');
  await expect(page.getByText(/Nama saat transaksi · 1 pasang/)).toBeVisible();
  await expect(page.getByText(/Tarif tersimpan · 1 pasang/)).toHaveCount(0);
});

for (const failure of ['fetch', 'empty', 'preview']) test(`new order fails closed: ${failure}`, async ({ page }) => {
  const state = await mock(page, 'OWNER', (path, request) => {
    if (path.endsWith('/pricing/plans') && request.method() === 'GET') {
      if (failure === 'fetch') return { status: 503, json: { error: { message: 'Tarif tidak tersedia' } } };
      if (failure === 'empty') return { json: [] };
    }
    if (path.endsWith('/pricing/preview') && failure === 'preview') return { status: 503, json: { error: { message: 'Estimasi tidak tersedia' } } };
  });
  await intake(page); await fillOrder(page);
  if (failure === 'preview') await page.getByLabel('Tarif pesanan').selectOption('custom');
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Buat pesanan', exact: true })).toBeDisabled();
  expect(state.orders).toEqual([]);
});

test('refreshed inactive selection cleared', async ({ page }) => {
  const state = await mock(page); await intake(page);
  await page.getByLabel('Tarif pesanan').selectOption('custom');
  await expect(page.getByRole('button', { name: 'Buat pesanan', exact: true })).toBeEnabled();
  state.plans[0].isActive = false;
  await page.getByRole('button', { name: 'Muat ulang tarif', exact: true }).click();
  await expect(page.getByLabel('Tarif pesanan')).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Buat pesanan', exact: true })).toBeDisabled();
});

test('public tracking shows saved plan name without fetching current plans', async ({ page }) => {
  const state = await mock(page); await page.goto(`${origin}/track/${'a'.repeat(64)}`);
  await expect(page.getByText(/Nama saat transaksi · 1 pasang/)).toBeVisible();
  await expect(page.getByText(/Tarif tersimpan · 1 pasang/)).toHaveCount(0);
  expect(state.previews).toEqual([]); expect(state.mutations).toEqual([]);
});

test('stale preview cannot enable submit after pair count changes', async ({ page }) => {
  const pending = [];
  await mock(page, 'OWNER', async (path, request) => {
    if (path.endsWith('/pricing/preview')) {
      const pairs = request.postDataJSON().pairs;
      return new Promise(resolve => pending.push({ pairs, resolve }));
    }
  });
  await intake(page);
  await page.getByLabel('Tarif pesanan').selectOption('custom');
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: 'Tambah sepatu', exact: true }).click();
  await expect.poll(() => pending.length).toBe(2);
  pending[0].resolve({ json: { totalIdr: 11111, breakdown: [] } });
  const save = page.getByRole('button', { name: 'Buat pesanan', exact: true });
  await expect(save).toBeDisabled();
  pending[1].resolve({ json: { totalIdr: 22222, breakdown: [] } });
  await expect(save).toBeEnabled();
  await expect(page.getByRole('status').filter({ hasText: 'Estimasi server:' })).toContainText('22.222');
  await expect(page.getByRole('status').filter({ hasText: 'Estimasi server:' })).not.toContainText('11.111');
});

test('invalid rule range blocks save; mobile editor stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const state = await mock(page); await tariffs(page);
  await page.getByRole('button', { name: 'Tambah tarif', exact: true }).click();
  await page.getByLabel('Nama tarif *').fill('Invalid');
  const price = page.getByLabel('Harga total paket (Rp)');
  await expect(price).toHaveAttribute('min', '1');
  await price.fill('0');
  await expect(page.getByRole('button', { name: 'Simpan tarif', exact: true })).toBeDisabled();
  await expect(page.getByRole('status').filter({ hasText: 'rupiah positif' })).toBeVisible();
  await price.fill('1');
  await page.getByLabel('Jenis aturan').selectOption('PER_PAIR');
  await page.getByLabel('Minimal pasang', { exact: true }).fill('5');
  await page.getByLabel('Maksimal pasang (kosong = tanpa batas)').fill('3');
  await expect(page.getByRole('button', { name: 'Simpan tarif', exact: true })).toBeDisabled();
  expect(state.mutations).toEqual([]);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
});


test('Fast selector price and turnaround; owner policy editor', async ({ page }) => {
  const state = await mock(page, 'OWNER', (path, request) => {
    if (path.endsWith('/pricing/preview')) {
      const pairs = request.postDataJSON().pairs;
      return { json: { totalIdr: pairs * 80000, breakdown: [{ kind: 'PACKAGE', quantity: pairs, pairs: 1, priceIdr: 80000, totalIdr: pairs * 80000 }] } };
    }
  });
  state.plans.push({ id: 'fast', name: 'Fast', isActive: true, revision: 1, turnaroundPolicy: 'FAST', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 80000 }] });
  await intake(page);
  await page.getByLabel('Tarif pesanan').selectOption('fast');
  await expect(page.getByText('Estimasi Fast:', { exact: false })).toContainText('besok maksimal 17:00 WIB');
  await expect(page.getByText('Estimasi Fast:', { exact: false })).toContainText('lusa maksimal 17:00 WIB');
  await expect(page.getByText('Estimasi Fast:', { exact: false })).toContainText('termasuk akhir pekan');
  await expect(page.getByText('80.000', { exact: false }).first()).toBeVisible();
  await fillOrder(page); await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  expect(state.orders[0].ratePlanId).toBe('fast');
  await tariffs(page);
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Fast', exact: true }) }).getByRole('button', { name: 'Ubah tarif / keaktifan' }).click();
  await expect(page.getByLabel('Waktu penyelesaian')).toHaveValue('FAST');
  await page.getByLabel('Waktu penyelesaian').selectOption('REGULAR');
  await page.getByRole('button', { name: 'Simpan tarif', exact: true }).click();
  expect(state.mutations.at(-1).input.turnaroundPolicy).toBe('REGULAR');
});
