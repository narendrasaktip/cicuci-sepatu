import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const [aggregateStatus, balanceIdr, expected, tone] of [
  ['READY_FOR_PICKUP', 45000, 'Menunggu Pelunasan', 'amber'],
  ['READY_FOR_PICKUP', 0, 'Siap Diambil', 'teal'],
  ['COMPLETED', 0, 'Selesai', 'green'],
  ['RETURN_PENDING', 0, 'Menunggu Pengembalian Sepatu', 'slate'],
  ['COMPLETED', -10000, 'Pengembalian Dana Tertunda', 'red'],
  ['AWAITING_CONSENT', 45000, 'Menunggu Persetujuan', 'amber'],
]) test(`tracking status ${aggregateStatus} balance ${balanceIdr}`, async ({ page }) => {
  page.on('pageerror', error => { throw error; });
  const itemStatus = aggregateStatus === 'COMPLETED' ? 'RETURNED' : aggregateStatus;
  await page.route('**/api/v1/**', route => route.fulfill({ json: {
    id: 'fixture', number: 'CS-TEST', aggregateStatus, balanceIdr, refundDueIdr: Math.max(0, -balanceIdr),
    totalIdr: 45000, paidIdr: 45000 - balanceIdr, paymentStatus: balanceIdr > 0 ? 'UNPAID' : 'PAID',
    estimatedCompletionAt: '2026-11-20T10:00:00Z', pickupInstructions: '', feedbackEligible: false, feedback: null,
    items: [{ id: 'shoe', brand: 'Fixture', model: '', color: '', serviceName: 'Cuci', status: itemStatus, finalPriceIdr: 45000, quotedPriceIdr: 45000, consents: [], photos: [], timeline: [{ status: itemStatus, at: '2026-11-16T10:00:00Z' }] }],
  } }));
  await page.goto('http://127.0.0.1:5173/track/tracking-fixture-only');
  const badge = page.locator('.badge').filter({ hasText: expected }).first();
  await expect(badge).toHaveText(expected);
  await expect(badge).toHaveAttribute('data-tone', tone);
  if (aggregateStatus === 'READY_FOR_PICKUP') {
    await expect(page.getByText('Selesai Dikerjakan', { exact: true }).first()).toBeVisible();
  }
});
