import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [320, 390, 1440]) test(`compact users, actions, search, Classic ${width}`, async ({ page, context }, info) => {
  const users = [
    { id: 'owner', name: 'Owner', email: 'owner@example.test', role: 'OWNER', isActive: true },
    { id: 'staff', name: 'NamaPanjang'.repeat(10), email: 'emailpanjang'.repeat(8) + '@example.test', role: 'STAFF', isActive: false },
  ];
  const unexpected = [], mutations = [], queries = [];
  await context.route('**/api/**', async route => {
    const req = route.request(), url = new URL(req.url()), path = url.pathname.replace('/api/v1', '');
    let body;
    if (req.method() === 'GET' && path === '/auth/me') body = { user: users[0], csrfToken: 'fixture-only' };
    else if (req.method() === 'GET' && path === '/dashboard') body = {};
    else if (req.method() === 'GET' && path === '/orders') body = { data: [], page: { nextCursor: null } };
    else if (req.method() === 'GET' && path === '/users') {
      const q = url.searchParams.get('q') ?? ''; queries.push(q);
      body = { data: users.filter(u => (u.name + u.email).includes(q)), page: { nextCursor: null } };
    } else if (req.method() === 'PATCH' && path === '/users/owner') {
      body = users[0];
    } else if (req.method() === 'DELETE' && path === '/users/staff') {
      mutations.push(req.postDataJSON());
      return route.fulfill({ status: 409, json: { error: { message: 'USER_HAS_HISTORY' } } });
    } else unexpected.push(req.method() + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { message: 'UNMOCKED' } } });
  });
  await page.setViewportSize({ width, height: 1000 });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pengguna', exact: true }).click();
  const table = page.locator('.user-table');
  await expect(table.locator('thead th')).toHaveText(['ID', 'Nama', 'Email', 'Peran', 'Status', 'Aksi']);
  await expect(table.locator('tbody td:first-child')).toHaveText(['owner', 'staff']);
  await expect(table.getByText('Detail teknis', { exact: true })).toHaveCount(0);
  await expect(table.getByRole('rowheader')).toHaveCount(2);
  await expect(table.locator('tbody tr').first().locator('td:last-child').getByText('Akun Anda', { exact: true })).toBeVisible();
  await expect(table.getByRole('rowheader').first()).toHaveText('Owner');
  await expect(page.getByRole('button', { name: 'Hapus pengguna Owner', exact: true })).toHaveCount(0);
  await expect(table.locator('tbody td:nth-child(5)')).toHaveText(['Aktif', 'Nonaktif']);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`users-${width}.png`), fullPage: true });
  await table.focus(); await expect(table).toBeFocused();
  await page.getByRole('button', { name: 'Ubah pengguna Owner', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Nama *', { exact: true })).toHaveValue('Owner');
  await expect(dialog.getByLabel('Peran *', { exact: true })).toHaveValue('OWNER');
  await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await page.clock.install();
  async function saveOwner() {
    await page.getByRole('button', { name: 'Ubah pengguna Owner', exact: true }).click();
    await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByRole('status')).toContainText('Perubahan tersimpan.');
  }
  await saveOwner();
  await page.clock.fastForward(5001);
  await expect(page.getByRole('status')).toHaveCount(0);
  await saveOwner();
  const trash = page.getByRole('button', { name: `Hapus pengguna ${users[1].name}`, exact: true });
  expect(await trash.evaluate(el => el.closest('td') === el.closest('tr').lastElementChild)).toBe(true);
  await trash.click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('USER_HAS_HISTORY');
  await expect(page.getByRole('status')).toHaveCount(0);
  await page.getByLabel('Cari Pengguna', { exact: true }).fill('owner@example.test');
  await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(table.getByRole('rowheader')).toHaveCount(1);
  expect(queries).toContain('owner@example.test');
  await page.getByLabel('Tampilan', { exact: true }).selectOption('classic');
  await expect(table).toHaveCount(0);
  await expect(page.locator('.cards article')).toHaveCount(1);
  await expect(page.getByRole('button', { name: 'Ubah akun / peran / password', exact: true })).toBeVisible();
  expect(mutations).toEqual([{ confirmed: true, confirmation: 'HAPUS' }]);
  expect(unexpected).toEqual([]);
});
