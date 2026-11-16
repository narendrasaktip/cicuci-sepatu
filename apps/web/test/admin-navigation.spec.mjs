import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [390, 768, 820, 1024, 1440]) test(`admin URLs and tablet navigation ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const json = path.endsWith('/auth/me') ? { user: { id: 'fixture', name: 'Owner', role: 'OWNER' }, csrfToken: 'fixture' }
      : path.endsWith('/display-settings') ? { statusLabels: {} }
      : path.endsWith('/dashboard') ? { activeOrders: 1, overdue: 1 }
      : path.endsWith('/whatsapp/status') ? { state: 'stopped', ready: false }
      : path.endsWith('/audit') ? { data: [{ id: 'audit-fixture', actorUserId: 'fixture', actorUser: { name: 'Owner Contoh', email: 'owner@example.invalid' }, action: 'LOGIN_SUCCEEDED', createdAt: '2026-11-16T00:00:00Z' }], page: { nextCursor: null } }
      : path.endsWith('/pricing/plans') || path.endsWith('/whatsapp-broadcasts') ? []
      : path.endsWith('/settings') ? { name: 'Cicuci Sepatu', consentHours: 48, statusLabels: {}, trackingStagesVersion: 1, trackingStages: [] }
      : path.endsWith('/whatsapp-templates') ? { templates: [], placeholders: {}, localOnly: true, encryptionReady: false }
      : { data: [], page: { nextCursor: null } };
    return route.fulfill({ json });
  });
  await page.goto('http://127.0.0.1:5173/admin/orders');
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  const expandedLeft = await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().left);
  await page.getByRole('button', { name: 'Ringkas menu', exact: true }).click();
  await expect(page.locator('.sidebar')).toHaveCSS('width', '64px');
  await expect(page.locator('.sidebar nav .nav-label').first()).toBeHidden();
  expect(await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().left)).toBe(64);
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.locator('.app-shell')).toHaveClass(/sidebar-collapsed/);
  await page.getByRole('button', { name: 'Perluas menu', exact: true }).click();
  await expect(page.locator('.sidebar nav .nav-label').first()).toBeVisible();
  expect(await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().left)).toBe(expandedLeft);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  if (width <= 1024) {
    const sidebarWidth = width <= 600 ? 80 : 190;
    await expect(page.locator('.sidebar')).toHaveCSS('width', `${sidebarWidth}px`);
    await expect(page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true })).toBeVisible();
    await expect(page.locator('.sidebar nav .nav-label').first()).toBeVisible();
    expect(await page.locator('.workspace').evaluate(el => el.getBoundingClientRect().left)).toBe(sidebarWidth);
    await expect(menu).toHaveCount(0);
  }
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Pesanan', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const name of ['Pelanggan', 'Tarif Pesanan', 'Pengguna', 'Pengaturan', 'WhatsApp', 'Ulasan', 'Audit']) {
    if (await menu.isVisible()) await menu.click();
    await page.getByRole('navigation').getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { name, level: 1, exact: true })).toBeVisible();
    if (name === 'Audit') {
      await expect(page.locator('.audit-actor')).toContainText('Owner Contoh');
      await expect(page.locator('.audit-actor-email')).toHaveText('owner@example.invalid');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});
test('custom message draft blocks navigation until confirmed', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/auth/me') ? { user: { id: 'fixture', role: 'OWNER', name: 'Owner' }, csrfToken: 'fixture' } : path.endsWith('/display-settings') ? { statusLabels: {} } : path.endsWith('/whatsapp-broadcasts') ? [] : path.endsWith('/whatsapp/status') ? { state: 'stopped', ready: false } : path.endsWith('/dashboard') ? {} : { data: [], page: { nextCursor: null } } });
  });
  await page.goto('http://127.0.0.1:5173/admin/whatsapp/broadcast');
  await page.getByLabel('Pesan informasi layanan').fill('Draft belum dikirim');
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page.getByLabel('Pesan informasi layanan')).toHaveValue('Draft belum dikirim');
  page.once('dialog', dialog => dialog.accept());
  await page.getByRole('navigation').getByRole('button', { name: 'Dashboard', exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/dashboard$/);
});
test('handover template exposes private feedback link placeholder', async ({ page }) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const template = { event: 'ORDER_HANDED_OVER', name: 'Seluruh pesanan diserahkan', body: 'Terima kasih dari Cicuci Sepatu. Ulasan: {url_ulasan}' };
    return route.fulfill({ json: path.endsWith('/auth/me') ? { user: { id: 'fixture', role: 'OWNER', name: 'Owner' }, csrfToken: 'fixture' } : path.endsWith('/display-settings') ? { statusLabels: {} } : path.endsWith('/whatsapp-templates/preview') ? { message: 'Tautan ulasan privat — contoh' } : path.endsWith('/whatsapp-templates') ? { templates: [{ event: 'HANDED_OVER', name: 'Sepatu diserahkan', body: 'Cicuci Sepatu {url_tracking}' }, template], placeholders: { url_ulasan: 'Tautan privat halaman ulasan' }, localOnly: true, encryptionReady: true } : { state: 'stopped', ready: false } });
  });
  await page.goto('http://127.0.0.1:5173/admin/whatsapp/templates');
  await expect(page.getByLabel('Peristiwa Notifikasi')).toHaveValue('ORDER_HANDED_OVER');
  await expect(page.getByLabel('Peristiwa Notifikasi').locator('option[value="HANDED_OVER"]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sisipkan url_ulasan', exact: true })).toBeVisible();
  await expect(page.getByLabel('Isi Pesan')).toHaveValue(/\{url_ulasan\}/);
});
