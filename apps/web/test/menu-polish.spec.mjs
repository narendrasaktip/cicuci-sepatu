import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const customer = { id: 'customer-fixture', name: 'Ayu Lestari', salutation: 'Kak', whatsapp: '6281234567890', notes: 'Hubungi sebelum pengambilan.', notificationConsentAt: null };
const owner = { id: 'self-fixture', name: 'Pemilik Contoh', email: 'owner@example.invalid', role: 'OWNER', isActive: true };
const colleague = { id: 'colleague-fixture', name: 'Rani Operator', email: 'rani@example.invalid', role: 'ADMIN', isActive: true };
const order = { id: 'order-fixture', number: 'CS-CONTOH-001', customer, aggregateStatus: 'IN_PROGRESS', estimatedCompletionAt: '2026-12-01T00:00:00Z', totalIdr: 90000, paidIdr: 45000, balanceIdr: 45000, paymentStatus: 'PARTIAL', itemCount: 1, pickupInstructions: 'Bawa bukti pesanan.', items: [{ id: 'shoe-fixture', brand: 'Sepatu Contoh', model: 'Kanvas', color: 'Biru', status: 'WASHING', quotedPriceIdr: 90000, finalPriceIdr: 90000, consents: [], photos: [], history: [], inspection: null }], payments: [] };
const plan = { id: 'plan-fixture', name: 'Cuci Reguler', isActive: true, revision: 1, turnaroundPolicy: 'REGULAR', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 45000 }] };
const menus = ['Dashboard', 'Pesanan', 'Pelanggan', 'Tarif Pesanan', 'Pengguna', 'Pengaturan', 'WhatsApp', 'Audit'];
async function fixture(context, role = 'OWNER') {
  const state = { unexpected: [], mutations: [], empty: false, fail: false };
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
    const list = data => ({ data: state.empty ? [] : data, page: { nextCursor: null } });
    let body;
    if (method === 'DELETE' && ['/orders/order-fixture', '/customers/customer-fixture', '/users/colleague-fixture', '/pricing/plans/plan-fixture'].includes(path)) {
      state.mutations.push({ path, body: request.postDataJSON() });
      return route.fulfill({ status: 409, json: { error: { code: 'FIXTURE_PROTECTED', message: 'Penghapusan ditolak (data contoh).' } } });
    }
    if (method === 'POST' && path === '/pricing/preview') return route.fulfill({ json: { totalIdr: 45000, breakdown: [] } });
    if (method !== 'GET') state.unexpected.push(method + ' ' + path);
    else if (path === '/auth/me') body = { user: { ...owner, role }, csrfToken: 'fixture-only' };
    else if (state.fail) return route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: 'Data contoh tidak tersedia.' } } });
    else if (path === '/dashboard') body = { activeOrders: 12, waitingInspection: 4, awaitingConsent: 1, inProgress: 5, readyForPickup: 2, overdue: 0, revenueIdr: 1250000 };
    else if (path === '/orders') body = list([order]);
    else if (path === '/orders/order-fixture') body = order;
    else if (path === '/customers') body = list([customer]);
    else if (path === '/customers/customer-fixture') body = customer;
    else if (path === '/users') body = list([owner, colleague]);
    else if (path === '/pricing/plans') body = state.empty ? [] : [plan];
    else if (path === '/services') body = list([{ id: 'service-fixture', name: 'Layanan Lama', isActive: true, basePriceIdr: 40000 }]);
    else if (path === '/settings') body = { name: 'Cicuci Sepatu', pickupInstructions: 'Bawa bukti pesanan.', consentHours: 24 };
    else if (path === '/whatsapp/status') body = { state: 'stopped', provider: 'whatsapp-web.js', ready: false, realSendEnabled: false };
    else if (path === '/whatsapp-templates') body = { templates: [{ event: 'ORDER_CREATED', name: 'Pesanan diterima', body: 'Cicuci Sepatu menerima pesanan {orderNumber}. Lihat {trackingUrl}.' }], placeholders: { trackingUrl: 'Tautan privat pelanggan' }, localOnly: true, encryptionReady: true };
    else if (path === '/notifications') body = list([{ id: 'notification-fixture', eventKey: 'fixture-event-private-id', template: 'Pesanan diterima', provider: 'whatsapp-web.js', recipient: '6281234567890', status: 'FAILED', attempts: [], createdAt: '2026-11-11T08:00:00Z', lastError: 'Contoh pengiriman gagal' }]);
    else if (path === '/audit') body = list([{ id: 'audit-fixture', action: 'HTTP_REQUEST', entityType: 'Order', entityId: order.id, actorUser: owner, actorUserId: owner.id, createdAt: '2026-11-11T08:00:00Z', metadata: { outcome: 'FAILED', requestId: 'request-fixture', method: 'DELETE', route: '/api/v1/orders/:id', status: 409, errorCode: 'ORDER_HAS_PAYMENTS' } }]);
    else state.unexpected.push(method + ' ' + path);
    return route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED', message: 'Blocked test request' } } });
  });
  return state;
}
async function start(page, context, role = 'OWNER') {
  const state = await fixture(context, role);
  await page.goto(`${origin}/admin`); await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  return state;
}
async function nav(page, name) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
}
async function overflow(page) { expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); }
async function shot(page, info, name) { await page.screenshot({ path: info.outputPath(name + '.png'), fullPage: true }); }

for (const width of [1440, 768, 390, 320]) test(`every menu, nested views, no document overflow ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await start(page, context); const errors = []; page.on('pageerror', e => errors.push(e.message));
  for (const name of menus) {
    await nav(page, name); await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Memuat…', exact: true })).toHaveCount(0);
    if (name === 'Pengguna') await expect(page.getByRole('heading', { name: owner.name, exact: true })).toBeVisible();
    if (name === 'Pengaturan') await expect(page.getByLabel('Nama toko', { exact: true })).toHaveValue('Cicuci Sepatu');
    if (name === 'Tarif Pesanan') {
      await expect(page.getByRole('heading', { name: plan.name, exact: true })).toBeVisible();
      await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
      await expect(page.getByRole('heading', { name: 'Layanan Lama', exact: true })).toBeVisible();
    }
    if (name === 'WhatsApp') {
      await expect(page.getByRole('heading', { name: 'Template Pesan Pelanggan' })).toBeVisible();
      await page.locator('summary').filter({ hasText: /Riwayat/ }).click();
      await expect(page.getByText('Identitas notifikasi', { exact: true })).toBeVisible();
    }
    if (name === 'Audit') { await expect(page.getByText('Detail teknis', { exact: true })).toBeVisible(); await expect(page.locator('.audit-outcome')).toHaveText('Gagal'); }
    await page.locator('main').focus(); await overflow(page); await shot(page, info, name.replaceAll(' ', '-'));
  }
  await nav(page, 'Pesanan'); await page.getByRole('button', { name: order.number, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detail Pesanan', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Keuangan', exact: true })).toBeVisible(); await overflow(page); await shot(page, info, 'Detail-Pesanan');
  await page.getByRole('button', { name: 'Kembali ke pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Pesanan Baru', exact: true })).toBeVisible(); await overflow(page); await shot(page, info, 'Pesanan-Baru');
  await expect(page.getByRole('option', { name: plan.name, exact: true })).toHaveCount(1);
  expect(errors).toEqual([]); expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

test('contextual trash, final order cell, focus, HAPUS guards, mocked refusal only', async ({ page, context }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 }); const state = await start(page, context);
  for (const [menu, name] of [['Pesanan', 'pesanan ' + order.number], ['Pelanggan', 'pelanggan ' + customer.name], ['Pengguna', 'pengguna ' + colleague.name], ['Tarif Pesanan', 'tarif ' + plan.name]]) {
    await nav(page, menu); const button = page.getByRole('button', { name: 'Hapus ' + name, exact: true });
    await expect(button).toHaveAttribute('title', 'Hapus ' + name);
    const box = await button.boundingBox(); expect(box.width).toBeGreaterThanOrEqual(44); expect(box.height).toBeGreaterThanOrEqual(44);
    await button.focus(); await expect(button).toBeFocused();
    if (menu === 'Pesanan') expect(await button.evaluate(el => el.closest('td') === el.closest('tr').lastElementChild)).toBe(true);
    if (menu === 'Pengguna') await expect(page.getByRole('button', { name: 'Hapus pengguna ' + owner.name })).toHaveCount(0);
    const countBefore = state.mutations.length; await page.keyboard.press('Enter'); const dialog = page.getByRole('dialog');
    await expect(dialog).toHaveAccessibleName('Hapus ' + name);
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('hapus');
    await dialog.getByRole('button', { name: 'Hapus permanen' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ketik HAPUS'); expect(state.mutations).toHaveLength(countBefore);
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('HAPUS');
    await dialog.getByRole('button', { name: 'Hapus permanen' }).click(); await expect(dialog.getByRole('alert')).toContainText('Penghapusan ditolak');
    await shot(page, info, 'delete-' + menu); await dialog.getByRole('button', { name: 'Batal', exact: true }).click(); await expect(button).toBeFocused();
  }
  expect(state.mutations).toHaveLength(4); for (const call of state.mutations) expect(call.body).toEqual({ confirmed: true, confirmation: 'HAPUS' }); expect(state.unexpected).toEqual([]);
});

for (const role of ['ADMIN', 'STAFF']) test(`${role} permissions preserved across presentations`, async ({ page, context }) => {
  const state = await start(page, context, role);
  for (const mode of ['new', 'classic']) {
    await page.getByLabel('Tampilan', { exact: true }).selectOption(mode);
    for (const name of ['Pengguna', 'Pengaturan', 'Audit']) await expect(page.getByRole('navigation').getByRole('button', { name, exact: true })).toHaveCount(0);
    await nav(page, 'Pesanan'); await expect(page.locator('.icon-delete')).toHaveCount(0); await expect(page.getByRole('button', { name: 'Hapus pesanan', exact: true })).toHaveCount(0);
    if (role === 'STAFF') await expect(page.getByRole('button', { name: 'Pesanan baru', exact: true })).toHaveCount(0);
    else { await nav(page, 'Pelanggan'); await expect(page.getByRole('button', { name: /Hapus pelanggan/ })).toHaveCount(0); }
  }
  expect(state.unexpected).toEqual([]);
});

test('all menu empty/error recovery, classic wording retained', async ({ page, context }) => {
  const state = await start(page, context);
  for (const name of menus) {
    state.empty = true; await nav(page, name); await expect(page.locator('main [aria-busy="true"]')).toHaveCount(0); await overflow(page);
    state.fail = true; await nav(page, name === 'Dashboard' ? 'Pesanan' : 'Dashboard'); await nav(page, name);
    await expect(page.getByRole('alert').first()).toBeVisible(); state.fail = false; state.empty = false;
  }
  await page.getByLabel('Tampilan', { exact: true }).selectOption('classic');
  await expect(page.locator('.icon-delete')).toHaveCount(0);
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Ringkasan', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation').getByRole('button', { name: 'Tarif pesanan', exact: true })).toBeVisible();
  await nav(page, 'Pesanan'); await expect(page.getByRole('button', { name: 'Hapus pesanan', exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]);
});

for (const width of [1440, 320]) test(`nested editors and technical disclosures ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 1000 }); const state = await start(page, context);
  await nav(page, 'Pelanggan'); await page.getByRole('button', { name: 'Detail pelanggan ' + customer.name, exact: true }).click();
  await expect(page.getByText(customer.notes, { exact: true })).toBeVisible(); await overflow(page);
  await page.getByRole('button', { name: 'Ubah pelanggan', exact: true }).click();
  await expect(page.getByRole('dialog').getByLabel('Nama *', { exact: true })).toHaveValue(customer.name); await overflow(page); await shot(page, info, 'editor-pelanggan');
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  await nav(page, 'Pengguna'); await page.getByRole('button', { name: 'Pengguna baru', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await overflow(page); await shot(page, info, 'editor-pengguna'); await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await nav(page, 'Tarif Pesanan'); await page.getByRole('button', { name: 'Ubah tarif', exact: true }).click();
  await expect(page.getByRole('form', { name: 'Editor tarif' })).toBeVisible(); await overflow(page); await shot(page, info, 'editor-tarif');
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click(); await page.getByRole('button', { name: 'Ubah layanan / keaktifan', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible(); await overflow(page); await shot(page, info, 'editor-layanan-lama'); await page.keyboard.press('Escape');
  await nav(page, 'WhatsApp'); await page.getByText('Diagnostik dan pengelolaan sesi', { exact: true }).click();
  await page.getByText('Bantuan placeholder', { exact: true }).click(); await overflow(page); await shot(page, info, 'whatsapp-diagnostik');
  await nav(page, 'Audit'); await page.getByText('Detail teknis', { exact: true }).click();
  await expect(page.getByText('request-fixture', { exact: true })).toBeVisible(); await overflow(page); await shot(page, info, 'audit-teknis');
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});
