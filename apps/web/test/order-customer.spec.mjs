import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
const db = new PrismaClient();
const origin = process.env.TEST_WEB_ORIGIN ?? process.env.APP_BASE_URL ?? 'http://127.0.0.1:5173';
const prefix = `web-${randomUUID()}`;
const password = `Browser-${randomUUID()}`;
let owner; let service;
const sessionToken = randomBytes(32).toString('hex');
const errors = []; const keys = new Set();
test.beforeAll(async () => {
  owner = await db.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: await argon2.hash(password), role: 'OWNER' } });
  service = await db.service.create({ data: { name: `${prefix}-clean`, basePriceIdr: 50000 } });
  await db.session.create({ data: { userId: owner.id, tokenHash: createHash('sha256').update(sessionToken).digest('hex'), csrfToken: randomUUID(), expiresAt: new Date(Date.now() + 3600000) } });
});
test.afterAll(async () => {
  if (!owner) { await db.$disconnect(); return; }
  const customers = await db.customer.findMany({ where: { name: { startsWith: prefix } } });
  const orders = await db.order.findMany({ where: { customerId: { in: customers.map(c => c.id) } } });
  const orderIds = orders.map(o => o.id);
  const items = await db.orderItem.findMany({ where: { orderId: { in: orderIds } } });
  const itemIds = items.map(i => i.id);
  const events = await db.notificationEvent.findMany({ where: { orderId: { in: orderIds } } });
  await db.notificationAttempt.deleteMany({ where: { eventId: { in: events.map(e => e.id) } } });
  await db.notificationEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  for (const model of ['photo', 'consentDecision', 'inspection', 'statusHistory']) await db[model].deleteMany({ where: { itemId: { in: itemIds } } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { id: { in: itemIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.customer.deleteMany({ where: { id: { in: customers.map(c => c.id) } } });
  await db.service.deleteMany({ where: { id: service?.id } });
  const sessions = await db.session.findMany({ where: { userId: owner.id } });
  const { createHash } = await import('node:crypto');
  for (const session of sessions) for (const key of keys) await db.idempotency.deleteMany({ where: { id: createHash('sha256').update(`${owner.id}:${session.csrfToken}:${key}`).digest('hex') } });
  await db.session.deleteMany({ where: { userId: owner.id } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorUserId: owner.id }, { entityId: { in: [...orderIds, ...itemIds, ...events.map(e => e.id)] } }] } });
  await db.user.delete({ where: { id: owner.id } });
  await db.$disconnect();
});
async function login(page) {
  await page.context().addCookies([{ name: 'cicuci_session', value: sessionToken, url: origin, httpOnly: true, sameSite: 'Lax' }]);
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Ringkasan', exact: true })).toBeVisible();
}
async function openNewOrder(page) {
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await nav.getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
}
async function fillShoe(page) {
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  const shoe = page.getByRole('group', { name: 'Sepatu 1', exact: true });
  await shoe.getByRole('combobox').selectOption({ value: service.id });
  await shoe.getByLabel('Merek *', { exact: true }).fill('Nike');
  await shoe.getByLabel('Model (opsional)', { exact: true }).fill('Air');
  await shoe.getByLabel('Warna (opsional)', { exact: true }).fill('Putih');
}
test('order creation: search existing customer and inline new customer with retry no duplicate', async ({ page }) => {
  test.setTimeout(90000); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const key = r.headers()['idempotency-key']; if (key) keys.add(key); });
  await login(page);
  const existing = await db.customer.create({ data: { name: `${prefix}-lama`, whatsapp: '+628111111111' } });
  await openNewOrder(page);
  await page.getByLabel('Cari pelanggan').fill(`${prefix}-lama`);
  const result = page.getByRole('button', { name: `${prefix}-lama · +628111111111`, exact: true });
  await expect(result).toBeVisible();
  await expect(page.locator('.customer-picker select')).toHaveCount(0);
  await result.click();
  await expect(page.getByText('Pelanggan terpilih:', { exact: false })).toBeVisible();
  await page.getByLabel('Cari pelanggan').fill(`${prefix}-no-match`);
  await expect(page.getByText('Tidak ada pelanggan cocok.', { exact: false })).toBeVisible();
  await expect(page.getByText('Pelanggan terpilih:', { exact: false })).toHaveCount(0);
  await fillShoe(page);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Pilih pelanggan dari hasil');
  await expect(page.getByLabel('Cari pelanggan')).toBeFocused();
  expect(await db.order.count({ where: { customerId: existing.id } })).toBe(0);
  await page.getByLabel('Cari pelanggan').fill(`${prefix}-lama`);
  await expect(result).toBeVisible();
  await page.getByLabel('Cari pelanggan').press('Enter');
  await expect(page.getByRole('button', { name: 'Ganti pelanggan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cari', exact: true })).toHaveCount(0);
  await fillShoe(page);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Akses pelanggan' })).toBeVisible();
  expect(await db.order.count({ where: { customerId: existing.id } })).toBe(1);

  await openNewOrder(page);
  await page.getByLabel('Pelanggan baru', { exact: true }).check();
  await page.getByLabel('Nama *', { exact: true }).fill(`${prefix}-baru`);
  await page.getByLabel('Nomor WhatsApp *', { exact: true }).fill('081222222222');
  await expect(page.getByLabel('Pelanggan menyetujui notifikasi WhatsApp', { exact: true })).not.toBeChecked();
  await fillShoe(page);
  let failed = false;
  await page.route('**/api/v1/orders', async route => {
    if (!failed && route.request().method() === 'POST') { failed = true; await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'INTERNAL', message: 'Simulasi gagal' } }) }); return; }
    await route.continue();
  });
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByText('Pelanggan sudah tersimpan.', { exact: false })).toBeVisible();
  await expect(page.getByLabel('Nama *', { exact: true })).toHaveValue(`${prefix}-baru`);
  await expect(page.getByLabel('Merek *', { exact: true })).toHaveValue('Nike');
  expect(await db.customer.count({ where: { name: `${prefix}-baru` } })).toBe(1);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Akses pelanggan' })).toBeVisible();
  expect(await db.customer.count({ where: { name: `${prefix}-baru` } })).toBe(1);
  const created = await db.customer.findFirstOrThrow({ where: { name: `${prefix}-baru` } });
  expect(created.whatsapp).toBe('+6281222222222');
  expect(created.notificationConsentAt).toBeNull();
  expect(await db.order.count({ where: { customerId: created.id } })).toBe(1);
  expect(errors).toEqual([]);
});
test('mobile and keyboard: mode radios, search field, no overflow', async ({ page }) => {
  test.setTimeout(60000); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.setViewportSize({ width: 390, height: 844 });
  await login(page);
  await openNewOrder(page);
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await expect(page.getByLabel('Pelanggan lama', { exact: true })).toBeEnabled();
  await page.getByLabel('Pelanggan lama', { exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByLabel('Pelanggan baru', { exact: true })).toBeChecked();
  await expect(page.getByLabel('Nomor WhatsApp *', { exact: true })).toBeVisible();
  await page.getByLabel('Pelanggan lama', { exact: true }).check();
  await expect(page.getByLabel('Cari pelanggan')).toBeVisible();
  await page.getByLabel('Cari pelanggan').press('Tab');
  await expect(page.locator('.customer-picker select')).toHaveCount(0);
  expect(errors).toEqual([]);
});
test('inline new customer validation failure keeps order form', async ({ page }) => {
  test.setTimeout(60000); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const key = r.headers()['idempotency-key']; if (key) keys.add(key); });
  await login(page);
  await openNewOrder(page);
  await page.getByLabel('Pelanggan baru', { exact: true }).check();
  await page.getByLabel('Nama *', { exact: true }).fill(`${prefix}-invalid`);
  await page.getByLabel('Nomor WhatsApp *', { exact: true }).fill('123');
  await fillShoe(page);
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await expect(page.getByLabel('Merek *', { exact: true })).toHaveValue('Nike');
  await expect(page.getByLabel('Nomor WhatsApp *', { exact: true })).toHaveValue('123');
  expect(await db.customer.count({ where: { name: `${prefix}-invalid` } })).toBe(0);
  expect(errors).toEqual([]);
});

test('search ignores a stale response while the next query is debouncing', async ({ page }) => {
  let release;
  let markRequested;
  const queries = [];
  const requested = new Promise(resolve => { markRequested = resolve; });
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = { data: [], page: { nextCursor: null } };
    if (url.pathname.endsWith('/auth/me')) body = { user: { id: 'fixture-owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture-only' };
    else if (url.pathname.endsWith('/dashboard')) body = {};
    else if (url.pathname.endsWith('/services')) body.data = [service];
    else if (url.pathname.endsWith('/customers')) {
      queries.push(url.searchParams.get('q'));
      if (url.searchParams.get('q') === 'old') {
        await new Promise(resolve => { release = resolve; markRequested(); });
        body.data = [{ id: 'old-customer', name: 'Old', whatsapp: '+628111111111' }];
      } else if (url.searchParams.get('q') === 'fresh') body.data = [{ id: 'fresh-customer', name: 'Fresh', whatsapp: '+628122222222' }];
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  await openNewOrder(page);
  const search = page.getByLabel('Cari pelanggan');
  const results = page.locator('[data-customer-result]');
  await expect(search).toBeEnabled();
  await expect(results).toHaveCount(0);
  await expect(page.locator('#customer-feedback')).toHaveText('');
  expect(queries).toEqual([]);
  await search.fill('   ');
  await page.waitForTimeout(350);
  expect(queries).toEqual([]);
  await search.fill('old');
  await requested;
  await search.fill('');
  const staleResponse = page.waitForResponse(response => new URL(response.url()).searchParams.get('q') === 'old');
  release();
  await staleResponse;
  await page.waitForTimeout(350);
  await expect(results).toHaveCount(0);
  await expect(page.locator('#customer-feedback')).toHaveText('');
  expect(queries).toEqual(['old']);
  await search.fill('fresh');
  await expect(results.filter({ hasText: 'Fresh' })).toHaveCount(1);
  await expect(page.getByText('1 hasil pencarian.', { exact: true })).toHaveClass('sr-only');
  await search.press('ArrowDown');
  await expect(results).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByText('Pelanggan terpilih:', { exact: false })).toContainText('Fresh');
});

test('read-only stored Narendra search: route validation, whitespace, case, normalized phone', async ({ request }) => {
  const known = await db.customer.findFirst({ where: { name: { contains: 'Narendra' } }, select: { id: true, name: true, whatsapp: true } });
  expect(known, 'Known Narendra customer must exist').not.toBeNull();
  const headers = { Cookie: `cicuci_session=${sessionToken}` };
  const queries = ['Narendra', '  Narendra  ', 'nArEnDrA', known.whatsapp, known.whatsapp.replace(/^\+62/, '0').replace(/(\d{4})/g, '$1 ')];
  for (const q of queries) {
    const response = await request.get(`${origin}/api/v1/customers`, { params: { q, limit: 100 }, headers });
    expect(response.status()).toBe(200);
    expect((await response.json()).data.some(customer => customer.id === known.id), 'Stored customer returned').toBe(true);
  }
  for (const suffix of ['q=a&q=b', `q=${'x'.repeat(101)}`, 'q=a&unknown=true']) {
    const response = await request.get(`${origin}/api/v1/customers?${suffix}`, { headers });
    expect(response.status()).toBe(400);
  }
});

test('ambiguous search requires explicit keyboard choice; pagination and errors remain accessible', async ({ page }) => {
  let fail = false; let submissions = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = { data: [], page: { nextCursor: null } };
    if (url.pathname.endsWith('/auth/me')) body = { user: { id: 'fixture-owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture-only' };
    else if (url.pathname.endsWith('/dashboard')) body = {};
    else if (url.pathname.endsWith('/services')) body.data = [service];
    else if (url.pathname.endsWith('/orders') && route.request().method() === 'POST') submissions++;
    else if (url.pathname.endsWith('/customers')) {
      if (fail) { await route.fulfill({ status: 500, json: { error: { message: 'Pencarian gagal' } } }); return; }
      body = { data: [{ id: url.searchParams.has('cursor') ? 'second' : 'first', name: 'Same name', whatsapp: url.searchParams.has('cursor') ? '+628122222222' : '+628111111111' }], page: { nextCursor: url.searchParams.has('cursor') ? null : 'first' } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`); await openNewOrder(page); await fillShoe(page);
  const search = page.getByLabel('Cari pelanggan');
  await search.fill('Same');
  await expect(page.getByRole('button', { name: 'Muat lebih banyak' })).toBeEnabled();
  await search.press('Enter');
  await expect(page.getByRole('alert')).toContainText('Pilih pelanggan');
  await expect(page.getByText('Pelanggan terpilih:', { exact: false })).toHaveCount(0);
  await page.getByRole('button', { name: 'Muat lebih banyak' }).click();
  const results = page.locator('[data-customer-result]');
  await expect(results).toHaveCount(2);
  await search.press('Enter');
  expect(submissions).toBe(0);
  await search.press('ArrowDown'); await page.keyboard.press('ArrowDown');
  await expect(results.nth(1)).toBeFocused(); await page.keyboard.press('ArrowUp');
  await expect(results.nth(0)).toBeFocused(); await page.keyboard.press('Enter');
  await expect(page.getByText('Pelanggan terpilih:', { exact: false })).toContainText('+628111111111');
  await page.getByRole('button', { name: 'Ganti pelanggan' }).click();
  await expect(search).toBeFocused(); await expect(search).toHaveValue('');
  fail = true; await search.fill('broken');
  await expect(page.getByRole('alert')).toContainText('Pencarian gagal');
  await expect(results).toHaveCount(0);
  fail = false; await page.getByRole('button', { name: 'Ulangi pencarian' }).click();
  await expect(results).toHaveCount(1);
  expect(submissions).toBe(0);
});
