import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';

test('owner toggles tariff; failed update keeps previous status', async ({ page, context }) => {
  let plan = { id: 'normal', name: 'NORMAL', isActive: true, turnaroundPolicy: 'REGULAR', revision: 1, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 50000 }] };
  const writes = []; let fail = true;
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '');
    if (path === '/auth/me') return route.fulfill({ json: { user: { id: 'owner', name: 'Owner', email: 'owner@example.invalid', role: 'OWNER' }, csrfToken: 'test' } });
    if (path === '/pricing/plans') return route.fulfill({ json: [plan] });
    if (path === '/pricing/plans/normal') {
      const input = request.postDataJSON(); writes.push(input);
      if (fail) return route.fulfill({ status: 409, json: { error: { message: 'Status gagal disimpan' } } });
      expect(input.revision).toBe(plan.revision);
      plan = { ...plan, ...input, revision: plan.revision + 1 };
      return route.fulfill({ json: plan });
    }
    if (path === '/dashboard') return route.fulfill({ json: {} });
    if (path === '/orders') return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
    if (path === '/display-settings') return route.fulfill({ json: { statusLabels: {} } });
    if (path === '/whatsapp/status') return route.fulfill({ json: { state: 'ready', ready: true } });
    return route.fulfill({ status: 501, json: {} });
  });
  await page.goto(origin + '/admin');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: /Tarif/ }).click();
  await page.getByRole('button', { name: 'Nonaktifkan tarif NORMAL', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Status gagal disimpan');
  await expect(page.getByRole('button', { name: 'Nonaktifkan tarif NORMAL', exact: true })).toBeEnabled();
  fail = false;
  await page.getByRole('button', { name: 'Nonaktifkan tarif NORMAL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Aktifkan tarif NORMAL', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Aktifkan tarif NORMAL', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Nonaktifkan tarif NORMAL', exact: true })).toBeVisible();
  expect(writes.map(input => input.isActive)).toEqual([false, false, true]);
  expect(plan.rules).toEqual([{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 50000 }]);
});
