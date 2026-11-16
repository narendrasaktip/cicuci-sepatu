import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const [key, name, filter] of [
  ['activeOrders', 'Pesanan aktif', 'status=ACTIVE'],
  ['waitingInspection', 'Pesanan menunggu inspeksi', 'status=WAITING_INSPECTION'],
  ['awaitingConsent', 'Pesanan perlu persetujuan', 'status=AWAITING_CONSENT'],
  ['inProgress', 'Pesanan diproses', 'status=IN_PROGRESS'],
  ['readyForPickup', 'Pesanan siap diambil', 'status=READY_FOR_PICKUP'],
  ['awaitingPayment', 'Pesanan menunggu pelunasan', 'status=AWAITING_PAYMENT'],
  ['overdue', 'Pesanan terlambat', 'overdue=true'],
]) test(`dashboard ${key} sends exactly one filtered request`, async ({ page }) => {
  const requests = [];
  await page.route('**/api/v1/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/orders')) requests.push(url.search);
    const json = url.pathname.endsWith('/auth/me') ? { user: { id: 'owner', name: 'Owner', role: 'OWNER' }, csrfToken: 'fixture' }
      : url.pathname.endsWith('/display-settings') ? { statusLabels: {} }
      : url.pathname.endsWith('/dashboard') ? { [key]: 1, revenueIdr: 10000 }
      : url.pathname.endsWith('/whatsapp/status') ? { state: 'stopped', ready: false }
      : { data: [], page: { nextCursor: null } };
    await route.fulfill({ json });
  });
  await page.goto('http://127.0.0.1:5173/admin/dashboard');
  await expect(page.getByRole('button', { name: `${name} 1`, exact: true })).toBeVisible();
  await expect.poll(() => requests.length).toBe(1);
  requests.length = 0;
  await page.getByRole('button', { name: `${name} 1`, exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/orders$/);
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0]).toContain(filter);
  await expect(page.getByLabel('Status', { exact: true })).toHaveValue(filter === 'overdue=true' ? 'OVERDUE' : filter.slice(7));
});
