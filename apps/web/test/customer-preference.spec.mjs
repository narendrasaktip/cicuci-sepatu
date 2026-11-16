import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });

test('customer preference edit, validation and clear use mocked API', async ({ page, context }) => {
  const customer = { id: 'c1', name: 'Ayu', whatsapp: '+6281234567890', salutation: 'Kak', notes: 'internal', notificationConsentAt: null, preferredHandoverMethod: 'PICKUP', preferredHandoverLocation: 'Jakarta' };
  const mutations = [], unexpected = [];
  await context.route('**/api/v1/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', '');
    let body;
    if (req.method() === 'PATCH' && path === '/customers/c1') {
      const data = req.postDataJSON(); mutations.push(data);
      if ('handoverPreference' in data) { customer.preferredHandoverMethod = data.handoverPreference?.method ?? null; customer.preferredHandoverLocation = data.handoverPreference?.method === 'STORE' ? null : data.handoverPreference?.location ?? null; }
      body = customer;
    } else if (req.method() !== 'GET') unexpected.push(req.method() + ' ' + path);
    else if (path === '/auth/me') body = { user: { id: 'u', name: 'Admin', email: 'test@example.invalid', role: 'ADMIN' }, csrfToken: 'test' };
    else if (path === '/display-settings') body = { statusLabels: {} };
    else if (path === '/dashboard') body = {};
    else if (path === '/whatsapp/status') body = { state: 'ready', ready: true, realSendEnabled: false };
    else if (path === '/orders') body = { data: [], page: { nextCursor: null } };
    else if (path === '/customers') body = { data: [customer], page: { nextCursor: null } };
    else unexpected.push(req.method() + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.goto((process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173') + '/admin');
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pelanggan', exact: true }).click();
  const edit = () => page.getByRole('button', { name: 'Ubah Pelanggan Ayu', exact: true }).filter({ visible: true }).click();
  await edit(); const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Preferensi penyerahan')).toHaveValue('PICKUP');
  await dialog.getByLabel('Preferensi penyerahan').selectOption('STORE');
  await expect(dialog.getByLabel('Lokasi preferensi')).toBeHidden();
  await dialog.getByLabel('Preferensi penyerahan').selectOption('PICKUP');
  await expect(dialog.getByLabel('Lokasi preferensi')).toBeVisible();
  await dialog.getByLabel('Lokasi preferensi').fill('');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(dialog.getByText('Lokasi wajib diisi.')).toBeVisible(); expect(mutations).toHaveLength(0);
  await dialog.getByLabel('Lokasi preferensi').fill(' Bandung ');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(dialog).toHaveCount(0); expect(mutations[0].handoverPreference).toEqual({ method: 'PICKUP', location: 'Bandung' }); expect(mutations[0].notes).toBe('internal');
  await edit(); await dialog.getByLabel('Preferensi penyerahan').selectOption('');
  await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(dialog).toHaveCount(0); expect(mutations[1].handoverPreference).toBeNull();
  await edit(); await dialog.getByRole('button', { name: 'Konfirmasi' }).click();
  await expect(dialog).toHaveCount(0); expect(mutations[2]).not.toHaveProperty('handoverPreference'); expect(unexpected).toEqual([]);
});
