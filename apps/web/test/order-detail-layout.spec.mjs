import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [1440, 900, 390]) test(`order detail hierarchy and safe controls at ${width}px`, async ({ page, context }) => {
  await page.setViewportSize({ width, height: 1000 });
  const unexpected = [];
  const item = { id: 'shoe', brand: 'Nike', model: '', color: '', serviceName: 'Promo', status: 'RETURN_PENDING', outcome: 'DECLINED', quotedPriceIdr: 45000, finalPriceIdr: 0, assignedUserId: null, photos: [], history: [], consents: [] };
  const order = { id: 'fixture', number: 'CS-FIXTURE', customer: { name: 'Fixture', whatsapp: '+628111111111' }, aggregateStatus: 'RETURN_PENDING', paymentStatus: 'UNPAID', totalIdr: 0, paidIdr: 0, balanceIdr: 0, estimatedCompletionAt: '2026-11-19T16:59:59.999Z', handoverMethod: 'STORE', items: [item], payments: [], pricing: { version: 1, stage: 'FINAL', rateMode: 'PROMO', pairs: 0, initialTotalIdr: 45000, totalIdr: 0 } };
  await context.route('**/api/**', async route => {
    const req = route.request(); const path = new URL(req.url()).pathname.replace('/api/v1', '');
    const responses = {
      '/auth/me': { user: { id: 'owner', name: 'Owner', role: 'OWNER' }, csrfToken: 'fixture' },
      '/display-settings': { statusLabels: {} }, '/dashboard': {},
      '/whatsapp/status': { workerAvailable: true, state: 'ready', ready: true, realSendEnabled: false },
      '/orders': { data: [order], page: { nextCursor: null } },
      '/orders/fixture': order,
      '/orders/fixture/tracking-token': { trackingToken: 'fixture-only', publicOrigin: 'http://127.0.0.1:5173' },
      '/services': { data: [], page: {} }, '/users': { data: [], page: {} },
    };
    if (req.method() !== 'GET' || !(path in responses)) {
      unexpected.push(`${req.method()} ${path}`);
      return route.fulfill({ status: 501, json: { error: { message: 'UNMOCKED' } } });
    }
    await route.fulfill({ json: responses[path] });
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('button', { name: 'CS-FIXTURE', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'CS-FIXTURE', exact: true })).toBeVisible();
  await expect(page.locator('main > .topbar')).toHaveCount(0);
  const shoes = page.getByRole('region', { name: 'Daftar Sepatu' });
  await expect(shoes.getByRole('heading', { name: 'Nike', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Catat Pembayaran', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Tambah Sepatu', exact: true })).toBeDisabled();
  const summary = page.getByRole('complementary', { name: 'Ringkasan Pesanan' });
  await expect(summary.locator('.balance-highlight')).toContainText('Sisa Tagihan');
  const textSizes = await summary.locator('.order-detail-pricing h2, .order-detail-pricing p, .balance-highlight span, .finance-totals dd, .handover-facts dd').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).fontSize));
  expect(new Set(textSizes).size).toBe(1);
  await expect(shoes.locator('.shoe-service')).toHaveCSS('font-size', '12.8px');
  await expect(shoes.locator('.shoe-details > summary')).toHaveCSS('font-size', '12.8px');
  const buttonSizes = await page.locator('.order-detail-heading button, .order-detail-content button:not(.order-detail-shoe > .actions > button:not(.secondary):not(.danger)), .order-detail-summary summary, .order-detail-summary dt, .order-detail-access label, .order-detail-content .access-open').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize) / parseFloat(getComputedStyle(document.documentElement).fontSize)));
  expect(buttonSizes.every(size => Math.abs(size - .75) < .001)).toBe(true);
  const explanation = summary.locator('.pricing-explanation');
  const disclosure = await explanation.locator('summary').boundingBox();
  const collapsed = await explanation.boundingBox();
  const balance = await summary.locator('.balance-highlight').boundingBox();
  expect(collapsed.height - disclosure.height).toBeLessThan(5);
  expect(balance.y - disclosure.y - disclosure.height).toBeLessThanOrEqual(12);
  expect(disclosure.height).toBeGreaterThanOrEqual(44);
  await expect(summary.locator('.finance-totals > div')).toHaveCount(2);
  await expect(summary.locator('.payment-state')).toHaveText('Belum dibayar');
  await expect(summary.locator('.completion-highlight')).toContainText('Estimasi Selesai');
  await expect(summary.locator('.handover-facts')).toContainText('Di toko');
  const handover = await summary.getByRole('button', { name: 'Ubah Penyerahan', exact: true }).boundingBox();
  const estimate = await summary.getByRole('button', { name: 'Ubah Estimasi', exact: true }).boundingBox();
  expect(Math.abs(handover.y - estimate.y)).toBeLessThan(1);
  expect(estimate.x).toBeGreaterThan(handover.x);
  const a = await shoes.boundingBox(), b = await summary.boundingBox();
  if (width > 1100) expect(b.x).toBeGreaterThan(a.x + a.width - 1);
  else expect(b.y).toBeGreaterThan(a.y);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.getByText('Kelola Akses Pelanggan', { exact: true }).click();
  await page.getByRole('button', { name: 'Cabut Tautan', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Semua akses melalui tautan pelacakan saat ini berhenti');
  expect(unexpected).toEqual([]);
});
