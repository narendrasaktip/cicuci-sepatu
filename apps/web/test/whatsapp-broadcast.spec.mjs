import process from 'node:process';
import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const id = '11111111-1111-4111-8111-111111111111';
async function setup(page, role = 'OWNER') {
  const state = { unexpected: [], confirmations: 0, previews: 0, keys: [] };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
    let json;
    if (path === '/auth/me') json = { user: { id: 'fixture', name: 'Uji', role }, csrfToken: 'csrf' };
    else if (path === '/dashboard' || path === '/display-settings') json = {};
    else if (path === '/orders') json = { data: [], page: { nextCursor: null } };
    else if (path === '/whatsapp/status') json = { state: 'stopped', ready: false, realSendEnabled: false };
    else if (path === '/whatsapp-templates') json = { templates: [], placeholders: {}, encryptionReady: true };
    else if (path === '/whatsapp-broadcasts') json = state.confirmations < 2 ? [] : [{ id, createdAt: '2026-11-15T09:00:00.000Z' }];
    else if (path === '/whatsapp-broadcasts/preview') {
      state.previews++; expect(role).toBe('OWNER');
      const input = route.request().postDataJSON(); expect(input.scope).toBe('SERVICE_INFORMATION');
      json = { id, message: input.message, expiresAt: Date.now() + 600000, recipients: [{ id: 'c', name: 'Dina', whatsapp: '+6281234567890', ...(state.previews > 1 ? { message: input.message.replaceAll('{customer_name}', 'Dina') } : {}) }] };
    } else if (path === '/whatsapp-broadcasts/confirm') {
      state.confirmations++; state.keys.push(route.request().headers()['idempotency-key']);
      expect(route.request().headers()['x-csrf-token']).toBe('csrf');
      expect(route.request().postDataJSON()).toEqual({ previewId: id, confirmed: true, serviceOnly: true });
      if (state.confirmations === 1) { await route.fulfill({ status: 409, json: { error: { code: 'NOT_ENABLED' } } }); return; }
      json = { id, queued: true };
    } else if (path === `/whatsapp-broadcasts/${id}`) json = { id, recipients: [{ id: 'e', recipient: '+6281234567890', status: 'FAILED', attempts: [{ attemptNo: 1, status: 'FAILED', response: { actualOutbound: 'unknown', error: 'AMBIGUOUS_SEND_MANUAL_REVIEW' } }] }] };
    else { state.unexpected.push(path); await route.abort(); return; }
    await route.fulfill({ json });
  });
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
  if (await page.getByRole('button', { name: 'Menu', exact: true }).isVisible()) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  if (role === 'OWNER') await page.getByRole('button', { name: 'Pesan Custom', exact: true }).click();
  return state;
}
for (const role of ['OWNER', 'ADMIN']) test(`${role} preview, confirmation and report with fail-closed API mocks`, async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const state = await setup(page, role);
  if (role === 'OWNER') {
    await expect(page.getByText('Promosi memerlukan izin terpisah.', { exact: false })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Pesan Custom', exact: true })).toBeVisible();
    await expect(page.getByText('Belum ada riwayat Pesan Custom.', { exact: true })).toBeVisible();
    await page.getByText('Ketentuan dan kesiapan pengiriman', { exact: true }).click();
    await expect(page.getByText('Pratinjau belum mengirim pesan dan tersedia tanpa koneksi', { exact: false })).toBeVisible();
    await expect(page.getByText('Maksimal 500 penerima;', { exact: false })).toBeVisible();
    const editor = page.getByLabel('Pesan informasi layanan');
    await editor.fill('Jam operasional berubah sementara.');
    await page.getByRole('button', { name: 'Pratinjau Penerima' }).click();
    const preview = page.getByRole('region', { name: 'Pratinjau Pesan Custom' });
    await expect(preview).toContainText('API belum mendukung pratinjau personalisasi');
    const confirm = page.getByRole('button', { name: 'Konfirmasi dan Antrekan Pesan Custom' });
    await page.getByRole('checkbox').check(); await expect(confirm).toBeDisabled(); expect(state.confirmations).toBe(0);
    await editor.fill('Halo {customer_name}, jam operasional diperbarui.');
    await expect(preview).toHaveCount(0);
    await page.getByRole('button', { name: 'Pratinjau Penerima' }).click();
    await expect(preview).toContainText('Halo Dina, jam operasional diperbarui.');
    await expect(confirm).toBeDisabled(); await page.getByRole('checkbox').check();
    await confirm.click();
    await expect(page.getByRole('alert')).toContainText('Koneksi > Izin Pengiriman');
    await expect(preview).toContainText('Dina');
    await confirm.click();
    const report = page.getByRole('region', { name: 'Laporan Pesan Custom' });
    await expect(report).toContainText('FAILED: 1');
    await expect(report).toContainText('tidak dicoba ulang otomatis');
    await expect(report).toContainText('bukan bukti diterima atau dibaca');
    await expect(page.getByText('15 Nov 2026, 16.00 WIB', { exact: true })).toBeVisible();
    await expect(page.getByText(`ID: ${id}`, { exact: true }).first()).not.toBeVisible();
    await page.getByText('Detail laporan', { exact: true }).click();
    await expect(report).toContainText(id);
    expect(state.confirmations).toBe(2); expect(state.previews).toBe(2);
    expect(state.keys[0]).toBeTruthy(); expect(state.keys[1]).toBe(state.keys[0]);
    await expect(page.getByRole('checkbox')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } else await expect(page.getByRole('button', { name: 'Pesan Custom', exact: true })).toHaveCount(0);
  expect(state.unexpected).toEqual([]);
});
for (const width of [390, 1440]) test(`editor toolbar, placeholder, escaped simulation and layout at ${width}px`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await setup(page);
  const editor = page.getByLabel('Pesan informasi layanan');
  const simulation = page.getByRole('region', { name: 'Simulasi chat' });
  await expect(simulation).toContainText('Tulis pesan untuk melihat simulasi');
  for (const [label, marker] of [['Tebal', '*'], ['Miring', '_'], ['Coret', '~'], ['Monospace', '```']]) {
    await editor.fill('Halo Dina!');
    await editor.evaluate(field => { field.focus(); field.setSelectionRange(5, 9); });
    await page.getByRole('button', { name: label, exact: true }).click();
    await expect(editor).toHaveValue(`Halo ${marker}Dina${marker}!`);
    expect(await editor.evaluate(field => [field.selectionStart, field.selectionEnd])).toEqual([5 + marker.length, 9 + marker.length]);
    await expect(editor).toBeFocused();
  }
  await editor.fill('Halo !');
  await editor.evaluate(field => field.setSelectionRange(5, 5));
  await page.getByRole('button', { name: 'Sisipkan nama pelanggan' }).click();
  await expect(editor).toHaveValue('Halo {customer_name}!');
  await expect(simulation).toContainText('Halo Dina!');
  await expect(page.getByText('21/4000 karakter', { exact: true })).toBeVisible();
  await editor.fill('');
  await page.getByRole('button', { name: 'Tebal', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(editor).toHaveValue('**');
  expect(await editor.evaluate(field => field.selectionStart)).toBe(1);
  await editor.fill('x'.repeat(4000));
  await editor.evaluate(field => field.setSelectionRange(4000, 4000));
  await page.getByRole('button', { name: 'Monospace', exact: true }).click();
  await expect(editor).toHaveValue('x'.repeat(4000));
  await editor.fill('<img src=x onerror="window.xss=1"> {customer_name} ' + 'z'.repeat(500));
  await expect(simulation).toContainText('<img src=x onerror="window.xss=1"> Dina');
  await expect(simulation.locator('img')).toHaveCount(0);
  expect(await page.evaluate(() => window.xss)).toBeUndefined();
  const formBox = await page.locator('.broadcast-panel form').boundingBox();
  const simulationBox = await simulation.boundingBox();
  if (width > 800) expect(simulationBox.x).toBeGreaterThanOrEqual(formBox.x + formBox.width);
  else expect(simulationBox.y).toBeGreaterThanOrEqual(formBox.y + formBox.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.previews).toBe(0); expect(state.confirmations).toBe(0); expect(state.unexpected).toEqual([]);
});
