import process from 'node:process';
import { test, expect } from '@playwright/test';
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const customer = { id: 'customer-ux', name: 'Pelanggan Uji', whatsapp: '+6281234567890', notificationConsentAt: null };
const service = { id: 'service-ux', name: 'Cuci Uji', basePriceIdr: 35000, isActive: true };
const plan = { id: 'plan-ux', name: 'Tarif Uji', isActive: true, revision: 1, turnaroundPolicy: 'REGULAR', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 35000 }] };
const order = { id: 'order-ux', number: 'UX-001', customer, estimatedCompletionAt: '2026-12-01T10:00:00Z', pickupInstructions: '', aggregateStatus: 'WAITING_INSPECTION', totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID', items: [], payments: [] };
async function fixture(page, options = {}) {
  const commands = [];
  let state = options.state ?? { state: 'stopped', ready: false, realSendEnabled: false };
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url()); const path = url.pathname.replace('/api/v1', '');
    let body = { data: [], page: { nextCursor: null } };
    if (path === '/auth/me') body = { user: { id: 'owner-ux', name: 'Pemilik Uji', role: 'OWNER' }, csrfToken: 'test-only' };
    else if (path === '/whatsapp/status') { body = { provider: 'whatsapp-web.js', ...state }; if (options.delay) await new Promise(resolve => setTimeout(resolve, options.delay)); }
    else if (path.startsWith('/whatsapp/')) { commands.push({ path, body: route.request().postDataJSON() }); body = { status: 'queued' }; }
    else if (path === '/whatsapp-templates') body = { templates: [], placeholders: {}, encryptionReady: true, localOnly: false };
    else if (path === '/dashboard') body = {};
    else if (path === '/services') body.data = [service];
    else if (path === '/pricing/plans') body = [plan];
    else if (path === '/pricing/preview') body = { totalIdr: 35000, breakdown: [] };
    else if (path === '/customers') body.data = [customer];
    else if (path === '/orders' && route.request().method() === 'POST') body = { ...order, ...(options.notification ? { notification: options.notification } : {}) };
    else if (path === '/orders/order-ux') body = order;
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  return { commands, setState(value) { state = value; } };
}
async function openWhatsApp(page) { await page.getByRole('button', { name: 'WhatsApp', exact: true }).click(); }

test('completed start never means connected; diagnostics collapsed; no automatic commands', async ({ page }) => {
  const mock = await fixture(page, { state: { state: 'starting', ready: false, realSendEnabled: false, lastCommand: { command: 'start', status: 'completed' } } });
  await openWhatsApp(page);
  await expect(page.getByText('Menyiapkan koneksi.', { exact: false })).toBeVisible();
  await expect(page.getByText('Perintah selesai diproses.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aktifkan pengiriman', exact: true })).toHaveCount(0);
  await expect(page.locator('[aria-labelledby="wa-heading"] details')).not.toHaveAttribute('open', '');
  expect(mock.commands).toEqual([]);
  mock.setState({ state: 'error', ready: false, realSendEnabled: false, error: 'INITIALIZATION_FAILED' });
  await page.getByRole('button', { name: 'Periksa status WhatsApp' }).click();
  await expect(page.getByRole('alert')).toContainText('Penyiapan WhatsApp gagal. Penyebab belum dipastikan');
  expect(mock.commands).toEqual([]);
});

test('activation requires explicit risk consent; logout requires confirmation', async ({ page }) => {
  const mock = await fixture(page, { state: { state: 'ready', ready: true, realSendEnabled: false } });
  await openWhatsApp(page);
  const activate = page.getByRole('button', { name: 'Aktifkan pengiriman', exact: true });
  await expect(activate).toBeDisabled();
  await page.getByRole('checkbox', { name: /Saya memahami risiko/ }).check();
  await activate.click();
  expect(mock.commands).toEqual([{ path: '/whatsapp/activate', body: { acknowledgeRisk: true } }]);
  await expect(page.getByText('Permintaan masuk antrean.', { exact: false })).toBeVisible();
  await expect(page.getByText('Pengiriman nonaktif.', { exact: false })).toBeVisible();
  await expect(activate).toBeDisabled();
  await page.getByText('Diagnostik dan pengelolaan sesi', { exact: true }).click();
  page.once('dialog', dialog => dialog.dismiss());
  await page.getByRole('button', { name: 'Putuskan dan hapus sesi' }).click();
  expect(mock.commands).toHaveLength(1);
});

for (const [notification, expected] of [
  [{ status: 'SKIPPED', reason: 'NO_CURRENT_OPT_IN', actualOutbound: false }, 'Pelanggan belum menyetujui'],
  [{ status: 'SKIPPED', reason: 'NOT_ENABLED', actualOutbound: false }, 'Pengiriman belum diaktifkan'],
  [{ status: 'PENDING', actualOutbound: false }, 'Notifikasi WhatsApp masuk antrean pengiriman'],
  [{ status: 'PROCESSING', actualOutbound: false }, 'WhatsApp sedang diproses'],
  [{ status: 'SENT', actualOutbound: false }, 'bukan bukti diterima atau dibaca'],
  [{ status: 'FAILED', reason: 'AMBIGUOUS_SEND_MANUAL_REVIEW', actualOutbound: false }, 'jangan langsung kirim ulang'],
  [{ status: 'SIMULATED', actualOutbound: false }, 'tidak ada pesan nyata'],
  [undefined, 'Status notifikasi WhatsApp belum tersedia'],
]) {
  test(`order feedback reflects persisted ${notification?.reason ?? notification?.status ?? 'missing'} status`, async ({ page }) => {
    await fixture(page, { notification });
    await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
    await page.getByLabel('Cari pelanggan').fill(customer.name);
    await page.getByRole('button', { name: `${customer.name} · ${customer.whatsapp}`, exact: true }).click();
    await page.getByLabel('Tarif Pesanan').selectOption(plan.id);
    await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
    await page.getByLabel('Merek *', { exact: true }).fill('Uji');
    await page.getByLabel('Model (opsional)', { exact: true }).fill('Model Uji');
    await page.getByLabel('Warna (opsional)', { exact: true }).fill('Hitam');
    await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
    await expect(page.getByText('Pesanan tersimpan.', { exact: true })).toHaveClass('success');
    const feedback = page.locator('.notice').filter({ hasText: expected });
    await expect(feedback).toBeVisible();
    await expect(feedback).not.toHaveClass('success');
    if (notification?.status === 'PENDING') await expect(feedback).not.toContainText('belum dikirim');
  });
}

for (const enabled of [false, true]) {
  test(`refresh/navigation preserves authoritative ready and activation=${enabled}, no commands`, async ({ page }) => {
    const mock = await fixture(page, { delay: 350, state: { state: 'ready', ready: true, realSendEnabled: enabled, lastCommand: { command: 'start', status: 'completed' } } });
    const watch = () => {
      window.disconnectedFlash = false;
      new MutationObserver(() => { if (document.body?.textContent.includes('Belum terhubung.')) window.disconnectedFlash = true; }).observe(document, { childList: true, subtree: true });
    };
    await page.addInitScript(watch);
    await page.evaluate(watch);
    for (let i = 0; i < 3; i++) {
      if (i) await page.reload();
      await openWhatsApp(page);
      await expect(page.getByText('Memeriksa status WhatsApp…', { exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: 'Hubungkan WhatsApp', exact: true })).toHaveCount(0);
      await expect(page.getByText('WhatsApp terhubung.', { exact: true })).toBeVisible();
      await expect(page.getByText(enabled ? 'Pengiriman aktif untuk event baru' : 'Pengiriman nonaktif.', { exact: false })).toBeVisible();
      await page.getByRole('button', { name: 'Periksa status WhatsApp', exact: true }).click();
      await page.getByRole('button', { name: 'Ringkasan', exact: true }).click();
      await openWhatsApp(page);
      await expect(page.getByText('Memeriksa status WhatsApp…', { exact: true })).toBeVisible();
      await expect(page.getByText('WhatsApp terhubung.', { exact: true })).toBeVisible();
      expect(await page.evaluate(() => window.disconnectedFlash)).toBe(false);
    }
    await page.waitForTimeout(2200);
    expect(mock.commands).toEqual([]);
  });
}

test('late stopped response cannot overwrite newer ready snapshot', async ({ page }) => {
  const mock = await fixture(page, { state: { state: 'ready', ready: true, realSendEnabled: true } });
  await openWhatsApp(page);
  await expect(page.getByText('WhatsApp terhubung.', { exact: true })).toBeVisible();
  let release; let held = false;
  await page.route('**/api/v1/whatsapp/status', async route => {
    if (!held) { held = true; await new Promise(resolve => { release = resolve; }); await route.fulfill({ json: { state: 'stopped', ready: false, realSendEnabled: false } }); }
    else await route.fulfill({ json: { state: 'ready', ready: true, realSendEnabled: true } });
  });
  await expect.poll(() => held).toBe(true);
  await page.getByRole('button', { name: 'Periksa status WhatsApp' }).click();
  await expect(page.locator('[aria-labelledby="wa-heading"]')).toHaveAttribute('aria-busy', 'false');
  release();
  await page.waitForTimeout(200);
  await expect(page.getByText('WhatsApp terhubung.', { exact: true })).toBeVisible();
  expect(mock.commands).toEqual([]);
});
