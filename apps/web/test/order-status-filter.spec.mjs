import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const tab of ['Dashboard', 'Pesanan']) test(`${tab}: overdue is a status choice, never an API status`, async ({ page, context }) => {
  const unexpected = [], queries = [];
  await context.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname.replace('/api/v1', '');
    let body;
    if (request.method() === 'GET' && path === '/auth/me') body = { user: { id: 'admin', name: 'Admin', role: 'ADMIN' }, csrfToken: 'fixture-only' };
    else if (request.method() === 'GET' && path === '/dashboard') body = { activeOrders: 0, revenueIdr: 0 };
    else if (request.method() === 'GET' && path === '/orders') {
      queries.push(Object.fromEntries(url.searchParams));
      body = { data: [], page: { nextCursor: url.searchParams.has('cursor') ? null : 'fixture-next' } };
    } else if (request.method() === 'GET' && path === '/whatsapp-templates') body = { templates: [], placeholders: {}, localOnly: true, encryptionReady: true };
    else if (request.method() === 'GET' && path === '/notifications') body = { data: [], page: { nextCursor: null } };
    else unexpected.push(request.method() + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  const navigation = page.getByRole('navigation', { name: 'Navigasi utama' });
  const apply = page.getByRole('button', { name: 'Terapkan / muat ulang', exact: true });
  const status = page.getByRole('combobox', { name: 'Status', exact: true });
  await expect(apply).toBeEnabled();
  if (tab === 'Pesanan') {
    await navigation.getByRole('button', { name: tab, exact: true }).click();
    await expect(apply).toBeEnabled();
  } else {
    await expect(page.getByText('Pembayaran dikurangi refund dari pesanan yang masih ada.', { exact: true })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Metrik operasional' }).locator('strong').last()).toHaveText(/Rp\s*0/);
  }
  await expect(page.getByRole('checkbox', { name: 'Hanya terlambat' })).toHaveCount(0);
  await expect(status.locator('option[value="OVERDUE"]')).toHaveText('Hanya terlambat');
  const check = async (action, expected) => {
    const count = queries.length;
    await action();
    await expect.poll(() => queries.length).toBe(count + 1);
    await expect(apply).toBeEnabled();
    expect(queries.at(-1)).toEqual({ limit: '25', ...expected });
  };
  await status.selectOption('OVERDUE');
  await check(() => apply.click(), { overdue: 'true' });
  await page.getByRole('searchbox').fill('Fixture');
  await check(() => page.getByRole('searchbox').press('Enter'), { q: 'Fixture', overdue: 'true' });
  await check(() => page.getByRole('button', { name: 'Berikutnya', exact: true }).click(), { q: 'Fixture', overdue: 'true', cursor: 'fixture-next' });
  await check(() => page.getByRole('button', { name: 'Sebelumnya', exact: true }).click(), { q: 'Fixture', overdue: 'true' });
  await check(() => page.getByRole('button', { name: /^Estimasi/ }).click(), { q: 'Fixture', overdue: 'true', sort: 'estimatedCompletionAt', direction: 'asc' });
  await expect(status).toHaveValue('OVERDUE');
  await status.selectOption('IN_PROGRESS');
  await check(() => apply.click(), { q: 'Fixture', status: 'IN_PROGRESS', sort: 'estimatedCompletionAt', direction: 'asc' });
  await status.selectOption('OVERDUE');
  await check(() => apply.click(), { q: 'Fixture', overdue: 'true', sort: 'estimatedCompletionAt', direction: 'asc' });
  await status.selectOption('');
  await check(() => apply.click(), { q: 'Fixture', sort: 'estimatedCompletionAt', direction: 'asc' });
  await status.selectOption('OVERDUE');
  await check(() => apply.click(), { q: 'Fixture', overdue: 'true', sort: 'estimatedCompletionAt', direction: 'asc' });
  await check(() => navigation.getByRole('button', { name: tab === 'Dashboard' ? 'Pesanan' : 'Dashboard', exact: true }).click(), { sort: 'estimatedCompletionAt', direction: 'asc' });
  await expect(status).toHaveValue('');
  await navigation.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await page.getByText('Riwayat pengiriman', { exact: true }).click();
  await expect(apply).toBeEnabled();
  await expect(status.locator('option[value="OVERDUE"]')).toHaveCount(0);
  await expect(status.locator('option')).toHaveText(['Semua status', 'Menunggu antrean', 'Sedang diajukan ke browser', 'Simulasi berhasil', 'Gagal', 'Dilewati', 'Diajukan ke browser (belum bukti diterima)']);
  expect(queries.every(query => query.status !== 'OVERDUE')).toBe(true);
  expect(unexpected).toEqual([]);
});
