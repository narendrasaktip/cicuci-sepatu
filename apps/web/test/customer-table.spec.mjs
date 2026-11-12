import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const longName = 'PelangganDenganNamaSangatPanjangTanpaSpasi'.repeat(2);
const customers = [
  { id: 'customer-one', salutation: 'Bu', name: 'Ayu Lestari', whatsapp: '6281234567890', notificationConsentAt: '2026-11-01T00:00:00Z', notes: 'Catatan contoh.' },
  { id: 'customer-two', salutation: 'Pak', name: longName, whatsapp: '6281234567891', notificationConsentAt: null, notes: '' },
  { id: 'customer-three', name: 'Rani', whatsapp: '6281234567892', notificationConsentAt: null, notes: '' },
];
const order = { id: 'order-fixture', number: 'CS-TABLE', customer: customers[0], aggregateStatus: 'RECEIVED', estimatedCompletionAt: '2026-12-01T00:00:00Z', totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID', items: [], payments: [] };
async function start(page, context, role = 'OWNER') {
  const state = { unexpected: [], calls: [], mutations: [], empty: false, fail: false, hold: null, records: structuredClone(customers) };
  // Every API request is intercepted before navigation. Never continue/fallback to live API.
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', ''), method = req.method();
    state.calls.push(method + ' ' + path + url.search);
    const list = (data, nextCursor = null) => ({ data, page: { nextCursor } });
    let body;
    if (['POST', 'PATCH', 'DELETE'].includes(method) && (path === '/customers' || path === '/customers/customer-one')) {
      state.mutations.push({ method, path, body: req.postDataJSON() });
      if (method === 'DELETE') return route.fulfill({ status: 409, json: { error: { code: 'CUSTOMER_HAS_ORDERS' } } });
      const data = req.postDataJSON();
      const saved = { ...state.records[0], ...data, notificationConsentAt: data.notificationConsent ? '2026-11-01T00:00:00Z' : null };
      if (method === 'PATCH') state.records[0] = saved;
      return route.fulfill({ json: saved });
    }
    if (method !== 'GET') state.unexpected.push(method + ' ' + path);
    else if (path === '/auth/me') body = { user: { id: 'fixture-user', name: 'Operator Contoh', email: 'fixture@example.invalid', role }, csrfToken: 'fixture-only' };
    else if (path === '/dashboard') body = { activeOrders: 0 };
    else if (path === '/orders') body = list(url.searchParams.has('customerId') ? [order] : []);
    else if (path === '/orders/order-fixture') body = order;
    else if (path === '/customers/customer-one') body = state.records[0];
    else if (path === '/customers') {
      if (state.hold) await state.hold;
      if (state.fail) return route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: 'Data contoh gagal.' } } });
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const data = state.records.filter(c => (c.name + c.whatsapp).toLowerCase().includes(q));
      body = list(state.empty ? [] : url.searchParams.has('cursor') ? [state.records[2]] : data, !state.empty && !q && !url.searchParams.has('cursor') ? 'fixture-next' : null);
    } else state.unexpected.push(method + ' ' + path);
    return route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pelanggan', exact: true }).click();
  await expect(page.locator('.customer-table')).toHaveAttribute('aria-busy', 'false');
  return state;
}
const action = (page, verb) => page.getByRole('button', { name: `${verb} pelanggan Ayu Lestari`, exact: true });

for (const width of [1440, 390, 320]) test(`semantic customer table, long names, keyboard actions ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await start(page, context);
  const table = page.getByRole('table', { name: 'Pelanggan, maksimum 25 per halaman' });
  await expect(table.getByRole('columnheader')).toHaveText(['Pelanggan', 'Nomor WhatsApp', 'Notifikasi', 'Aksi']);
  expect(await table.locator('thead th').evaluateAll(els => els.every(el => el.scope === 'col'))).toBe(true);
  await expect(table.getByRole('rowheader')).toHaveText(['Bu Ayu Lestari', 'Pak ' + longName, 'Kak Rani']);
  await expect(table.locator('.badge')).toHaveText(['Diizinkan', 'Tidak diizinkan', 'Tidak diizinkan']);
  expect(await table.getByRole('rowheader').nth(1).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const region = page.getByRole('region', { name: 'Daftar pelanggan, geser untuk kolom lainnya' });
  await page.keyboard.press('Tab'); await region.focus(); await expect(region).toBeFocused();
  expect(await region.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.screenshot({ path: info.outputPath(`customers-${width}.png`), fullPage: true });
  if (width < 760) { await region.evaluate(el => { el.scrollLeft = el.scrollWidth; }); expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
  const trash = action(page, 'Hapus');
  expect(await trash.evaluate(el => el.closest('td') === el.closest('tr').lastElementChild)).toBe(true);
  for (const verb of ['Detail', 'Ubah', 'Hapus']) {
    const button = action(page, verb), box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44); if (verb === 'Hapus') expect(box.width).toBeGreaterThanOrEqual(44);
    await button.focus(); await expect(button).toBeFocused();
    expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  }
  await page.screenshot({ path: info.outputPath(`actions-${width}.png`), fullPage: true });
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

test('search submit, next/previous, classic copy/cards and shared selection', async ({ page, context }, info) => {
  const state = await start(page, context);
  await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page.getByText('Halaman 2', { exact: true })).toBeVisible();
  await expect(page.getByRole('rowheader')).toHaveText(['Kak Rani']);
  expect(state.calls.some(s => s.includes('cursor=fixture-next'))).toBe(true);
  await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveCount(3);
  const input = page.getByLabel('Cari Pelanggan', { exact: true });
  await input.fill('Ayu'); await input.press('Enter');
  await expect(page.getByRole('rowheader')).toHaveText(['Bu Ayu Lestari']);
  expect(state.calls.some(s => s.includes('q=Ayu'))).toBe(true);
  await input.fill('6281234567891'); await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveText(['Pak ' + longName]);
  await input.fill('Ayu'); await input.press('Enter'); await expect(action(page, 'Detail')).toBeVisible();
  await action(page, 'Detail').click(); await expect(page.getByText('Catatan contoh.', { exact: true })).toBeVisible();
  await page.getByLabel('Tampilan', { exact: true }).selectOption('classic');
  await expect(page.locator('.customer-table')).toHaveCount(0); await expect(page.locator('.cards article')).toHaveCount(1);
  await expect(page.getByLabel('Cari', { exact: true })).toHaveValue('Ayu');
  await expect(page.getByRole('button', { name: 'Terapkan / muat ulang', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Detail pelanggan', exact: true })).toBeVisible();
  await expect(page.getByText('WhatsApp opt-in', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('classic-customers.png'), fullPage: true });
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  await expect(page.getByText('Catatan contoh.', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'CS-TABLE', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Detail Pesanan', exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

for (const role of ['OWNER', 'ADMIN']) test(`${role} edit/create mocked only; owner HAPUS protection`, async ({ page, context }) => {
  const state = await start(page, context, role);
  await action(page, 'Ubah').click(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nama *', { exact: true })).toHaveValue('Ayu Lestari');
  await dialog.getByLabel('Nama *', { exact: true }).fill('Ayu Baru');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('rowheader').first()).toHaveText('Bu Ayu Baru');
  await page.getByRole('button', { name: 'Pelanggan baru', exact: true }).click();
  await dialog.getByLabel('Nama *', { exact: true }).fill('Contoh Baru');
  await dialog.getByLabel('Nomor WhatsApp *', { exact: true }).fill('081234567899');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.mutations.map(m => m.method)).toEqual(['PATCH', 'POST']);
  if (role === 'OWNER') {
    const trash = page.getByRole('button', { name: 'Hapus pelanggan Ayu Baru', exact: true });
    await trash.click(); await expect(dialog).toContainText('Tidak dapat dibatalkan');
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('hapus');
    await dialog.getByRole('button', { name: 'Hapus permanen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ketik HAPUS'); expect(state.mutations).toHaveLength(2);
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('HAPUS');
    await dialog.getByRole('button', { name: 'Hapus permanen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('CUSTOMER_HAS_ORDERS');
    expect(state.mutations[2].body).toEqual({ confirmed: true, confirmation: 'HAPUS' });
    await dialog.getByRole('button', { name: 'Batal', exact: true }).click(); await expect(trash).toBeFocused();
  } else {
    for (const mode of ['new', 'classic']) { await page.getByLabel('Tampilan', { exact: true }).selectOption(mode); await expect(page.getByRole('button', { name: /Hapus pelanggan/ })).toHaveCount(0); }
  }
  expect(state.unexpected).toEqual([]);
});

test('loading, empty, error recovery stay within mocked API', async ({ page, context }) => {
  const state = await start(page, context); let release;
  state.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.locator('.customer-table')).toHaveAttribute('aria-busy', 'true');
  release(); state.hold = null; await expect(page.locator('.customer-table')).toHaveAttribute('aria-busy', 'false');
  state.empty = true; await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.getByText('Tidak ada pelanggan.', { exact: true })).toBeVisible();
  state.fail = true; await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('FIXTURE_UNAVAILABLE');
  state.fail = false; state.empty = false; await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(page.getByRole('rowheader')).toHaveCount(3); await expect(page.getByRole('alert')).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});
