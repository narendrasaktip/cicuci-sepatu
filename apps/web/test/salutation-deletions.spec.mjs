import process from 'node:process';
import { test, expect } from '@playwright/test';

const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const customer = { id: 'customer', salutation: 'Pak', name: 'Fixture', whatsapp: '+628111111111' };
const plan = { id: 'plan', name: 'Fixture tariff', isActive: true, revision: 1, rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 50000 }] };
const order = { id: 'order', number: 'CS-FIXTURE', customer, items: [], payments: [], totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', aggregateStatus: 'WAITING_INSPECTION', estimatedCompletionAt: '2026-11-20T00:00:00Z', pickupInstructions: '' };
async function mock(page, role = 'OWNER', failure = '') {
  const state = { customers: [{ ...customer }], calls: [], deleted: new Set() };
  // Every API request is fulfilled locally; never reaches the operational API.
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname.replace('/api/v1', ''); const method = request.method();
    let body = { data: [], page: { nextCursor: null } };
    if (method !== 'GET') {
      const input = request.postDataJSON(); state.calls.push({ path, method, input });
      if (method === 'DELETE') {
        if (failure) return route.fulfill({ status: 409, json: { error: { code: failure } } });
        state.deleted.add(path); if (path === '/customers/customer') state.customers = []; body = { deleted: true };
      } else if (path === '/customers') { body = { id: 'new-customer', ...input }; state.customers.push(body); }
      else if (path === '/customers/customer') { Object.assign(state.customers[0], input); body = state.customers[0]; }
      else if (path === '/orders') body = { ...order, notification: { status: 'SKIPPED', actualOutbound: false } };
      else if (path === '/pricing/preview') body = { totalIdr: 50000, breakdown: [] };
      else throw new Error(`Unexpected mocked mutation: ${method} ${path}`);
    } else if (path === '/auth/me') body = { user: { id: 'self', name: 'Owner fixture', role }, csrfToken: 'fixture' };
    else if (path === '/dashboard') body = {};
    else if (path === '/pricing/plans') body = state.deleted.has('/pricing/plans/plan') ? [] : [plan];
    else if (path === '/customers') body.data = state.customers;
    else if (path === '/customers/customer') body = state.customers[0];
    else if (path === '/orders') body.data = state.deleted.has('/orders/order') ? [] : [order];
    else if (path === '/users') body.data = [{ id: 'self', name: 'Owner fixture', email: 'self@example.test', role: 'OWNER', isActive: true }, { id: 'other', name: 'Other fixture', email: 'other@example.test', role: 'STAFF', isActive: true }].filter(u => !state.deleted.has('/users/' + u.id));
    else if (path.startsWith('/track/') || path === '/orders/order') body = order;
    await route.fulfill({ json: body });
  });
  return state;
}
async function tab(page, name) { await page.getByRole('navigation').getByRole('button', { name, exact: true }).click(); }

test('customer create defaults Kak; edit supports Bu; inline intake persists Pak', async ({ page }) => {
  const state = await mock(page); await page.goto(`${origin}/admin`); await tab(page, 'Pelanggan');
  await page.getByRole('button', { name: 'Pelanggan baru', exact: true }).click();
  let dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('Sapaan')).toHaveValue('Kak');
  await dialog.getByLabel('Nama', { exact: false }).fill('New fixture');
  await dialog.getByLabel('Nomor WhatsApp').fill('081111111112');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.calls.at(-1).input.salutation).toBe('Kak');
  await page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Pak Fixture', exact: true }) }).getByRole('button', { name: 'Ubah', exact: true }).click();
  dialog = page.getByRole('dialog'); await expect(dialog.getByLabel('Sapaan')).toHaveValue('Pak');
  await dialog.getByLabel('Sapaan').selectOption('Bu'); await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(dialog).toHaveCount(0); expect(state.calls.at(-1).input.salutation).toBe('Bu');
  await tab(page, 'Pesanan'); await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
  await page.getByLabel('Pelanggan baru', { exact: true }).check();
  await expect(page.getByLabel('Sapaan', { exact: true })).toHaveValue('Kak');
  await page.getByLabel('Sapaan', { exact: true }).selectOption('Pak');
  await page.getByLabel('Nama *', { exact: true }).fill('Inline fixture');
  await page.getByLabel('Nomor WhatsApp *', { exact: true }).fill('081111111113');
  await page.getByLabel('Tarif pesanan').selectOption('plan');
  await page.getByRole('group', { name: 'Sepatu 1', exact: true }).getByLabel('Merek *', { exact: true }).fill('Nike');
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect.poll(() => state.calls.filter(c => c.path === '/orders').length).toBe(1);
  expect(state.calls.filter(c => c.path === '/customers').at(-1).input.salutation).toBe('Pak');
});

for (const [name, button, path] of [['Pelanggan', 'Hapus pelanggan', '/customers/customer'], ['Pesanan', 'Hapus pesanan', '/orders/order'], ['Tarif pesanan', 'Hapus tarif', '/pricing/plans/plan'], ['Pengguna', 'Hapus pengguna', '/users/other']]) {
  test(`owner explicit delete confirmation: ${name}`, async ({ page }) => {
    const state = await mock(page); await page.goto(`${origin}/admin`); await tab(page, name);
    await expect(page.getByRole('button', { name: button, exact: true })).toHaveCount(1);
    await page.getByRole('button', { name: button, exact: true }).click();
    const dialog = page.getByRole('dialog'); await expect(dialog).toContainText('Tidak dapat dibatalkan'); await dialog.getByLabel('Ketik HAPUS untuk konfirmasi').fill('salah');
    await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
    await expect(dialog.getByRole('alert')).toContainText('Ketik HAPUS'); expect(state.calls).toEqual([]);
    await dialog.getByRole('button', { name: 'Batal', exact: true }).click(); expect(state.calls).toEqual([]);
    await page.getByRole('button', { name: button, exact: true }).click();
    await page.getByRole('dialog').getByLabel('Ketik HAPUS untuk konfirmasi').fill('HAPUS');
    await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: button, exact: true })).toHaveCount(0);
    expect(state.calls).toEqual([{ path, method: 'DELETE', input: { confirmed: true, confirmation: 'HAPUS' } }]);
  });
}
for (const role of ['ADMIN', 'STAFF']) test(`${role} has no delete controls`, async ({ page }) => {
  const state = await mock(page, role); await page.goto(`${origin}/admin`);
  for (const name of role === 'ADMIN' ? ['Pelanggan', 'Pesanan', 'Tarif pesanan'] : ['Pesanan', 'Tarif pesanan']) {
    await tab(page, name); await expect(page.getByRole('button', { name: /^Hapus/ })).toHaveCount(0);
  }
  expect(state.calls).toEqual([]);
});

for (const [name, button, code, message] of [
  ['Pesanan', 'Hapus pesanan', 'ORDER_HAS_PAYMENTS', 'ledger wajib dipertahankan'],
  ['Pesanan', 'Hapus pesanan', 'NOTIFICATION_IN_PROGRESS', 'sedang diproses'],
  ['Pesanan', 'Hapus pesanan', 'DELETE_DEPENDENCY', 'ketergantungan data'],
  ['Pelanggan', 'Hapus pelanggan', 'CUSTOMER_HAS_ORDERS', 'masih memiliki pesanan'],
  ['Pengguna', 'Hapus pengguna', 'USER_HAS_HISTORY', 'riwayat operasional'],
]) test(`dependency rejection stays visible: ${code}`, async ({ page }) => {
  await mock(page, 'OWNER', code); await page.goto(`${origin}/admin`); await tab(page, name);
  await page.getByRole('button', { name: button, exact: true }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Ketik HAPUS untuk konfirmasi').fill('HAPUS');
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(message); await expect(dialog).toBeVisible();
});
