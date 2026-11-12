import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const stage of ['FINAL', 'ESTIMATE', 'LOCKED', 'HISTORICAL_ESTIMATE', 'UNVERIFIED_FINAL']) test(`tracking ${stage}: truthful price provenance, no duplicate confirmation, explicit risk`, async ({ page, context }) => {
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const pending = ['ESTIMATE', 'HISTORICAL_ESTIMATE'].includes(stage);
  const historical = ['LOCKED', 'HISTORICAL_ESTIMATE'].includes(stage);
  const actualStage = pending ? 'ESTIMATE' : stage === 'UNVERIFIED_FINAL' ? 'FINAL' : stage;
  const order = { number: 'CS-VERIFIED', estimatedCompletionAt: '2026-12-01T00:00:00Z', aggregateStatus: pending ? 'AWAITING_CONSENT' : 'QUEUED', pricing: { version: 1, mode: 'NORMAL', stage: actualStage, staffVerified: stage === 'FINAL', lockedAt: historical ? '2026-11-11T03:00:00Z' : null, pairs: 1, initialTotalIdr: 50000, totalIdr: 50000 }, totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', items: [{ id: 'shoe', brand: 'Nike', model: '', color: '', serviceName: 'Cuci', status: pending ? 'AWAITING_CONSENT' : 'QUEUED', outcome: pending ? 'NEEDS_CONSENT' : 'APPROVED', quotedPriceIdr: 50000, finalPriceIdr: pending ? 0 : 50000, risk: 'Warna luntur', consents: [], photos: [], timeline: [] }] };
  await context.route('**/api/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/fixture') await route.fulfill({ json: order });
    else { unexpected.push(`${route.request().method()} ${route.request().url()}`); await route.fulfill({ status: 501, json: { error: { code: 'UNEXPECTED_MOCK_ROUTE' } } }); }
  });
  await page.goto('http://127.0.0.1:5173/track/fixture');
  await expect(page.getByRole('heading', { name: 'Tracking Pesanan', exact: true })).toBeVisible();
  await expect(page.getByText('Menunggu Persetujuan Risiko harga sebelum pengerjaan', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Setujui harga/ })).toHaveCount(0);
  await expect(page.getByText('Harga diverifikasi staf.', { exact: true })).toHaveCount(stage === 'FINAL' ? 1 : 0);
  if (pending) {
    await expect(page.getByText('Sisa Pembayaran', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Total Akhir', { exact: true })).toHaveCount(0);
  }
  await expect(page.getByText('Mengikuti harga yang disepakati sebelumnya.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Harga Awal', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Ini bukan halaman pembayaran online.', { exact: true })).toHaveCount(1);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});
