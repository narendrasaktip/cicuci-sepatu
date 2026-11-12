import process from 'node:process';
import { test, expect } from '@playwright/test';

// Standalone fixtures only. Every /api/** is fulfilled; unknown routes fail closed.
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const order = { id: 'fixture-order', number: 'CS-PRESENTATION', customer: { name: 'Pelanggan Contoh' }, aggregateStatus: 'IN_PROGRESS', estimatedCompletionAt: '2026-12-01T00:00:00Z', totalIdr: 90000, balanceIdr: 45000, paymentStatus: 'PARTIAL', itemCount: 2 };
async function mock(context, role = 'OWNER') {
  const state = { calls: [], unexpected: [], empty: false, fail: false, hold: null };
  await context.route('**/api/**', async route => {
    const request = route.request(); const url = new URL(request.url()); const path = url.pathname;
    state.calls.push(path + url.search);
    let body;
    if (request.method() !== 'GET') state.unexpected.push(request.method() + ' ' + path);
    else if (path === '/api/v1/auth/me') body = { user: { id: 'fixture-user', name: 'Operator Contoh', email: 'fixture@example.invalid', role }, csrfToken: 'fixture-only' };
    else if (path === '/api/v1/display-settings') body = { statusLabels: {} };
    else if (path === '/api/v1/dashboard') body = { activeOrders: 12, waitingInspection: 4, awaitingConsent: 1, inProgress: 5, readyForPickup: 2, overdue: 0, revenueIdr: 1250000 };
    else if (path === '/api/v1/orders') {
      if (state.hold) await state.hold;
      if (state.fail) { await route.fulfill({ status: 503, json: { error: { code: 'FIXTURE_UNAVAILABLE', message: 'Data contoh gagal dimuat.' } } }); return; }
      body = { data: state.empty ? [] : [order], page: { nextCursor: null } };
    } else if (path === '/api/v1/pricing/plans') body = [];
    else if (path === '/api/v1/services') body = { data: [{ id: 'legacy', name: 'Layanan Historis', basePriceIdr: 35000, isActive: true }, { id: 'cicuci-cleaning-v1', name: 'Cuci sepatu', basePriceIdr: 0, isActive: true }], page: { nextCursor: null } };
    else if (path === '/api/v1/notifications') body = { data: [{ id: 'historical', template: 'ORDER_RECEIVED', status: 'SIMULATED', provider: 'mock', recipient: 'fixture-only', eventKey: 'fixture-event', createdAt: '2026-11-01T00:00:00Z', attempts: [{ id: 'attempt', attemptNo: 1, attemptedAt: '2026-11-01T00:00:00Z', status: 'SIMULATED', response: { actualOutbound: false } }] }], page: { nextCursor: null } };
    else if (path === '/api/v1/whatsapp/status') body = { state: 'stopped', provider: 'whatsapp-web.js', ready: false, realSendEnabled: false };
    else if (path === '/api/v1/whatsapp-templates') body = { templates: [], placeholders: {}, localOnly: true, encryptionReady: false };
    else if (path === '/api/v1/customers') body = { data: [], page: { nextCursor: null } };
    else state.unexpected.push(request.method() + ' ' + path);
    await route.fulfill({ status: body ? 200 : 501, json: body ?? { error: { code: 'UNMOCKED', message: 'Blocked test request' } } });
  });
  return state;
}
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}
async function navigate(page, name) {
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name, exact: true }).click();
}

test('new only despite stored classic preference; forms and reload remain usable', async ({ page, context }, info) => {
  const state = await mock(context); const errors = []; page.on('pageerror', e => errors.push(e.message));
  await context.addInitScript(() => localStorage.setItem('cicuci-presentation', 'classic'));
  await page.setViewportSize({ width: 1440, height: 1050 }); await page.goto(`${origin}/admin`);
  await expect(page.getByLabel('Tampilan', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCSS('background-color', 'rgb(21, 43, 73)');
  await expect(page.getByRole('img', { name: 'Cicuci Sepatu' })).toBeVisible();
  await noOverflow(page); await page.screenshot({ path: info.outputPath('new-dashboard-desktop.png'), fullPage: true });
  await page.reload(); await expect(page.locator('.theme-new')).toBeVisible();
  await navigate(page, 'Pesanan'); await page.getByLabel('Cari', { exact: true }).fill('Contoh');
  await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click();
  await expect(page.getByRole('button', { name: 'Terapkan / muat ulang' })).toBeEnabled();
  expect(state.calls.some(call => call.includes('q=Contoh'))).toBe(true);
  const sort = page.getByRole('columnheader', { name: /Pelanggan/ }); await sort.getByRole('button').click(); await expect(sort).toHaveAttribute('aria-sort', 'ascending');
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
  await expect(page.getByRole('radiogroup', { name: 'Jenis pelanggan' })).toBeVisible();
  await page.getByRole('button', { name: 'Batal', exact: true }).click();
  expect(errors).toEqual([]); expect(state.unexpected).toEqual([]);
});

for (const width of [1440, 768, 760, 390, 320]) {
  test(`new responsive orders and keyboard menu ${width}`, async ({ page, context }, info) => {
    const state = await mock(context); await page.setViewportSize({ width, height: 950 }); await page.goto(`${origin}/admin`);
    await navigate(page, 'Pesanan');
    await expect(page.getByRole('button', { name: 'CS-PRESENTATION', exact: true })).toBeVisible(); await noOverflow(page);
    const region = page.getByRole('region', { name: 'Daftar pesanan, geser untuk kolom lainnya' });
    await page.keyboard.press('Tab'); await region.focus(); await expect(region).toBeFocused();
    expect(await region.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
    if (width <= 760) {
      const menu = page.getByRole('button', { name: 'Menu', exact: true }); await expect(menu).toHaveAttribute('aria-expanded', 'false');
      await menu.focus(); await page.keyboard.press('Enter'); await expect(menu).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Tab'); await page.keyboard.press('Escape'); await expect(menu).toBeFocused(); await expect(menu).toHaveAttribute('aria-expanded', 'false');
      if (width < 760) { await region.evaluate(el => { el.scrollLeft = el.scrollWidth; }); expect(await region.evaluate(el => el.scrollLeft)).toBeGreaterThan(0); }
    }
    await page.screenshot({ path: info.outputPath(`new-orders-${width}.png`), fullPage: true }); expect(state.unexpected).toEqual([]);
  });
}

test('loading, empty, error and recovery use intercepted data', async ({ page, context }, info) => {
  const state = await mock(context); await page.goto(`${origin}/admin`);
  await expect(page.getByRole('button', { name: 'CS-PRESENTATION', exact: true })).toBeVisible();
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click(); await expect(page.getByText('Memuat data…', { exact: true })).toBeVisible();
  release(); state.hold = null; await expect(page.getByText('Memuat data…', { exact: true })).toHaveCount(0);
  state.empty = true; await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click(); await expect(page.locator('.empty-state')).toBeVisible();
  await page.screenshot({ path: info.outputPath('new-empty.png'), fullPage: true });
  state.fail = true; await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click(); await expect(page.getByRole('alert')).toContainText('FIXTURE_UNAVAILABLE');
  await page.screenshot({ path: info.outputPath('new-error.png'), fullPage: true });
  state.fail = false; state.empty = false; await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click(); await expect(page.getByRole('alert')).toHaveCount(0); await expect(page.getByRole('button', { name: 'CS-PRESENTATION', exact: true })).toBeVisible(); expect(state.unexpected).toEqual([]);
});

test('staff permissions unchanged; browser storage unnecessary', async ({ page, context }) => {
  const state = await mock(context, 'STAFF');
  await page.addInitScript(() => {
    Storage.prototype.getItem = Storage.prototype.setItem = () => { throw new Error('Test storage blocked'); };
  });
  await page.goto(`${origin}/admin`); await expect(page.locator('.theme-new')).toBeVisible();
  for (const name of ['Pesanan baru', 'Hapus pesanan', 'Pengaturan', 'Audit']) {
    await expect(page.getByRole('button', { name, exact: true })).toHaveCount(0);
  }
  await expect(page.getByLabel('Tampilan', { exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`advanced legacy services and delivery history preserve ${role} access`, async ({ page, context }) => {
  const state = await mock(context, role); await page.goto(`${origin}/admin`);
  await navigate(page, 'Tarif Pesanan');
  const legacy = page.locator('details').filter({ has: page.locator('summary').getByText('Lanjutan: layanan lama', { exact: true }) });
  await expect(legacy).not.toHaveAttribute('open', '');
  expect(state.calls.some(c => c.startsWith('/api/v1/services'))).toBe(false);
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layanan Historis', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Ubah layanan / keaktifan', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
  if (role === 'OWNER') {
    await page.getByRole('button', { name: 'Ubah layanan / keaktifan', exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toBeVisible();
    await expect(dialog.getByLabel('Nama *', { exact: true })).toHaveValue('Layanan Historis');
    await dialog.getByRole('button', { name: 'Batal', exact: true }).click(); await expect(dialog).toHaveCount(0);
  }
  if (role !== 'STAFF') {
    await navigate(page, 'WhatsApp');
    expect(state.calls.some(c => c.startsWith('/api/v1/notifications'))).toBe(false);
    await page.getByText('Riwayat pengiriman', { exact: true }).click();
    await expect(page.getByText('fixture-only', { exact: false })).toBeVisible();
    await page.getByText('Percobaan (1)', { exact: true }).click();
    await expect(page.locator('pre')).toContainText('"actualOutbound": false');
    await page.getByLabel('Status', { exact: true }).selectOption('SIMULATED');
    await page.getByRole('button', { name: 'Terapkan / muat ulang', exact: true }).click();
    await expect.poll(() => state.calls.some(c => c.includes('/notifications?') && c.includes('status=SIMULATED'))).toBe(true);
  } else await expect(page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'WhatsApp', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
