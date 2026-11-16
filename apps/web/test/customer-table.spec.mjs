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
  const state = { unexpected: [], calls: [], mutations: [], empty: false, fail: false, hold: null, history: [order], records: structuredClone(customers) };
  // Every API request is intercepted before navigation. Never continue/fallback to live API.
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', ''), method = req.method();
    state.calls.push(method + ' ' + path + url.search);
    const list = (data, nextCursor = null) => ({ data, page: { nextCursor } });
    let body;
    if (['POST', 'PATCH', 'DELETE'].includes(method) && (path === '/customers' || path === '/customers/customer-one')) {
      state.mutations.push({ method, path, body: req.postDataJSON() });
      if (method === 'DELETE') return route.fulfill({ json: { id: 'customer-one', deleted: true } });
      const data = req.postDataJSON();
      const saved = { ...state.records[0], ...data, ...(data.handoverPreference !== undefined ? { preferredHandoverMethod: data.handoverPreference?.method ?? null, preferredHandoverLocation: data.handoverPreference?.location ?? null } : {}), notificationConsentAt: data.notificationConsent ? '2026-11-01T00:00:00Z' : null };
      if (method === 'PATCH') state.records[0] = saved;
      return route.fulfill({ json: saved });
    }
    if (method !== 'GET') state.unexpected.push(method + ' ' + path);
    else if (path === '/auth/me') body = { user: { id: 'fixture-user', name: 'Operator Contoh', email: 'fixture@example.invalid', role }, csrfToken: 'fixture-only' };
    else if (path === '/dashboard') body = { activeOrders: 0 };
    else if (path === '/display-settings') body = { statusLabels: { 'admin.WAITING_INSPECTION': 'Label sama', 'admin.IN_PROGRESS': 'Label sama' } };
    else if (path === '/whatsapp/status') body = { state: 'ready', ready: true };
    else if (path === '/orders') body = list(url.searchParams.has('customerId') ? state.history : []);
    else if (path === '/orders/order-fixture') body = order;
    else if (path === '/services' || path === '/users') body = list([]);
    else if (path === '/orders/order-fixture/tracking-token') body = { trackingToken: 'fixture-private-token' };
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
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true }).first()).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pelanggan', exact: true }).click();
  await expect(page.locator('.customer-table')).toHaveAttribute('aria-busy', 'false');
  return state;
}
const action = (page, verb) => page.getByRole('button', { name: verb === 'Hapus' ? 'Hapus permanen pelanggan Ayu Lestari' : `${verb} Pelanggan Ayu Lestari`, exact: true }).filter({ visible: true });

for (const width of [1440, 768, 390, 320]) test(`semantic customer table, long names, keyboard actions ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await start(page, context);
  const header = page.locator('main > header.topbar');
  await expect(header).toHaveClass(/orders-topbar/);
  await expect(header.getByRole('heading', { name: 'Pelanggan', exact: true })).toBeVisible();
  await expect(header.locator('.page-description')).not.toBeEmpty();
  await expect(header.getByRole('button', { name: 'Pelanggan Baru', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Daftar Pelanggan', exact: true })).toHaveCount(0);
  const table = page.getByRole('table', { name: 'Pelanggan, maksimum 25 per halaman' });
  await expect(table.getByRole('columnheader')).toHaveText(['Pelanggan', 'Nomor WhatsApp', 'Notifikasi', 'Aksi']);
  expect(await table.locator('thead th').evaluateAll(els => els.every(el => el.scope === 'col'))).toBe(true);
  await expect(table.getByRole('rowheader')).toHaveText(['Bu Ayu Lestari', 'Pak ' + longName, 'Kak Rani']);
  await expect(table.locator('.badge')).toHaveText(['Diizinkan', 'Tidak diizinkan', 'Tidak diizinkan']);
  expect(await table.locator('thead th').evaluateAll(els => [...new Set(els.map(el => getComputedStyle(el).fontSize))])).toEqual(['14px']);
  expect(await table.locator('tbody tr:first-child th, tbody tr:first-child td, tbody tr:first-child .badge, tbody tr:first-child button').evaluateAll(els => [...new Set(els.map(el => getComputedStyle(el).fontSize))])).toEqual(['13px']);
  expect(await table.getByRole('rowheader').nth(1).evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const region = page.getByRole('region', { name: 'Daftar pelanggan, geser untuk kolom lainnya' });
  await page.keyboard.press('Tab'); await region.focus(); await expect(region).toBeFocused();
  expect(await region.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  await page.screenshot({ path: info.outputPath(`customers-${width}.png`), fullPage: true });
  if (width < 760) { await region.evaluate(el => { el.scrollLeft = el.scrollWidth; }); expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
  const trash = action(page, 'Hapus');
  expect(await trash.evaluate(el => el.closest('td') === el.closest('tr').lastElementChild)).toBe(true);
  await expect(trash).toHaveCount(1);
  await expect(trash).toHaveText('');
  await expect(trash.locator('svg')).toHaveCount(1);
  for (const verb of ['Detail', 'Ubah', 'Hapus']) {
    const button = action(page, verb), box = await button.boundingBox();
    expect(box.height).toBeGreaterThanOrEqual(44); if (verb === 'Hapus') expect(box.width).toBeGreaterThanOrEqual(44);
    await button.focus(); await expect(button).toBeFocused();
    expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  }
  await page.screenshot({ path: info.outputPath(`actions-${width}.png`), fullPage: true });
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

test('search submit, next/previous, reset and detail', async ({ page, context }) => {
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
  await action(page, 'Detail').click();
  const detail = page.getByRole('dialog', { name: 'Bu Ayu Lestari' });
  await expect(detail).toBeVisible(); await expect(detail).toContainText('Catatan contoh.');
  await expect(detail).toContainText('6281234567890'); await expect(detail).toContainText('Opt-in Notifikasi');
  await page.keyboard.press('Escape'); await expect(detail).toHaveCount(0); await expect(action(page, 'Detail')).toBeFocused();
  await action(page, 'Detail').click();
  await detail.getByRole('button', { name: 'Ubah Pelanggan' }).click();
  const edit = page.getByRole('dialog', { name: 'Ubah pelanggan' });
  await expect(edit).toBeVisible(); await edit.getByRole('button', { name: 'Batal' }).click();
  await expect(detail).toBeVisible();
  await detail.getByRole('button', { name: 'CS-TABLE', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CS-TABLE', exact: true })).toBeVisible();
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

for (const width of [320, 1440]) test(`customer detail consent and responsive layout ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await start(page, context);
  state.records[0].preferredHandoverMethod = null;
  await action(page, 'Detail').click();
  const detail = page.getByRole('dialog', { name: 'Bu Ayu Lestari' });
  await expect(detail.locator('.customer-consent-badge')).toHaveText('Aktif');
  await expect(detail.locator('.customer-consent-date')).toContainText('Sejak');
  expect(await detail.getByRole('heading', { name: 'Bu Ayu Lestari' }).evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThan(20);
  expect(await detail.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  await expect(detail.locator('.customer-detail-handover')).toContainText('Belum diatur');
  await expect(detail.locator('.customer-detail-notes')).toContainText('Catatan contoh.');
  const contacts = detail.locator('.customer-detail-contact');
  expect(await contacts.locator('svg[aria-hidden="true"]').count()).toBe(2);
  const first = await contacts.nth(0).boundingBox(), second = await contacts.nth(1).boundingBox();
  if (width === 320) expect(second.y).toBeGreaterThan(first.y); else expect(second.y).toBe(first.y);
  await page.keyboard.press('Escape');
  state.records[0].notificationConsentAt = null;
  await action(page, 'Detail').click();
  await expect(detail.locator('.customer-consent-badge')).toHaveText('Tidak aktif');
  await expect(detail.locator('.customer-consent-date')).toHaveCount(0);
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

for (const width of [320, 1440]) test(`customer detail history and empty state ${width}`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 600 });
  const state = await start(page, context);
  state.history = Array.from({ length: 25 }, (_, i) => ({ ...order, id: `order-${i}`, number: `CS-${i}` }));
  await action(page, 'Detail').click();
  const detail = page.getByRole('dialog', { name: 'Bu Ayu Lestari' });
  await expect(detail.locator('.customer-order-status')).toHaveCount(25);
  expect(await detail.evaluate(el => el.scrollHeight > el.clientHeight && el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  state.history = [];
  await action(page, 'Detail').click();
  await expect(detail.getByText('Belum ada pesanan.')).toBeVisible();
  expect(state.unexpected).toEqual([]); expect(state.mutations).toEqual([]);
});

test('customer preference and raw history status remain independent of order snapshots', async ({ page, context }) => {
  const state = await start(page, context);
  state.records[0].preferredHandoverMethod = null;
  state.records[0].preferredHandoverLocation = null;
  const statuses = ['WAITING_INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'IN_PROGRESS', 'READY_FOR_PICKUP', 'RETURN_PENDING', 'COMPLETED', 'UNKNOWN'];
  state.history = statuses.map((aggregateStatus, i) => ({ ...order, id: `o-${i}`, aggregateStatus, handoverMethod: 'COURIER', handoverLocation: 'Lokasi pesanan' }));
  await action(page, 'Detail').click();
  const detail = page.getByRole('dialog', { name: 'Bu Ayu Lestari' });
  await expect(detail).toContainText('Belum diatur. Gunakan Ubah Pelanggan untuk menambah.');
  await expect(detail).not.toContainText('Lokasi pesanan');
  const badges = detail.locator('.customer-order-status');
  await expect(badges).toHaveCount(statuses.length);
  const colors = await badges.evaluateAll(els => els.map(el => [el.dataset.status, getComputedStyle(el).backgroundColor, getComputedStyle(el).color]));
  expect(colors.map(c => c[0])).toEqual(statuses);
  expect(await badges.evaluateAll(els => els.map(el => el.dataset.tone))).toEqual(['blue', 'amber', 'blue', 'blue', 'teal', 'slate', 'green', 'blue']);
  expect(colors[7].slice(1)).toEqual(colors[0].slice(1));
  await detail.getByRole('button', { name: 'Ubah Pelanggan' }).click();
  const edit = page.getByRole('dialog', { name: 'Ubah pelanggan' });
  await edit.getByLabel('Preferensi penyerahan').selectOption('PICKUP');
  await edit.getByLabel('Lokasi preferensi').fill('Lokasi profil');
  await edit.getByRole('button', { name: 'Konfirmasi' }).click();
  expect(state.mutations.at(-1).body.handoverPreference).toEqual({ method: 'PICKUP', location: 'Lokasi profil' });
  await expect(edit).toHaveCount(0);
  await expect(detail).toContainText('Dijemput'); await expect(detail).toContainText('Lokasi profil');
  await expect(detail).not.toContainText('Lokasi pesanan');
  expect(state.unexpected).toEqual([]);
});

for (const role of ['OWNER', 'ADMIN']) test(`${role} edit/create mocked only; owner HAPUS protection`, async ({ page, context }) => {
  const state = await start(page, context, role);
  await action(page, 'Ubah').click(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nama *', { exact: true })).toHaveValue('Ayu Lestari');
  await dialog.getByLabel('Nama *', { exact: true }).fill('Ayu Baru');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('rowheader').first()).toHaveText('Bu Ayu Baru');
  await page.getByRole('button', { name: 'Pelanggan Baru', exact: true }).click();
  await dialog.getByLabel('Nama *', { exact: true }).fill('Contoh Baru');
  await dialog.getByLabel('Nomor WhatsApp *', { exact: true }).fill('081234567899');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(dialog).toHaveCount(0);
  expect(state.mutations.map(m => m.method)).toEqual(['PATCH', 'POST']);
  if (role === 'OWNER') {
    const trash = page.getByRole('button', { name: 'Hapus permanen pelanggan Ayu Baru', exact: true });
    await trash.click(); await expect(dialog).toContainText('seluruh pesanan');
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('hapus');
    await dialog.getByRole('button', { name: 'Hapus permanen', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ketik HAPUS'); expect(state.mutations).toHaveLength(2);
    await dialog.getByLabel('Ketik HAPUS untuk konfirmasi', { exact: false }).fill('HAPUS');
    await dialog.getByRole('button', { name: 'Hapus permanen', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(state.mutations[2]).toEqual({ method: 'DELETE', path: '/customers/customer-one', body: { confirmed: true, confirmation: 'HAPUS' } });
  } else {
    await expect(page.getByRole('button', { name: /Hapus permanen pelanggan/ })).toHaveCount(0);
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
