import process from 'node:process';
import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const initial = { event: 'ORDER_RECEIVED', name: 'Pesanan diterima', body: 'Halo Kak {nama_pelanggan}, {total_sepatu} pasang sudah diterima.\n{detail_sepatu}\n{url_tracking}\nCicuci Sepatu' };
for (const role of ['OWNER', 'ADMIN']) for (const width of [390, 1280]) {
  test(`${role} templates preview/history/save responsive ${width}; never commands`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const commands = []; let saved = { ...initial }; let previews = 0; let history = 0;
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      const method = route.request().method(); let body = { data: [], page: { nextCursor: null } };
      if (path === '/auth/me') body = { user: { id: 'template-user', name: 'Uji', role }, csrfToken: 'test' };
      else if (path === '/dashboard') body = {};
      else if (path === '/whatsapp/status') body = { state: 'ready', ready: true, realSendEnabled: false };
      else if (path.startsWith('/whatsapp/')) commands.push(path);
      else if (path === '/whatsapp-templates' && method === 'GET') body = { templates: [{ ...initial, event: 'RECEIVED', name: 'Sepatu diterima' }, { ...initial, event: 'INSPECTION', name: 'Pemeriksaan dimulai' }, saved, { ...initial, event: 'PACKING', name: 'Pengemasan lama' }, { ...initial, event: 'QC', name: 'Pemeriksaan kualitas' }, { ...initial, event: 'FINISHING', name: 'Penyelesaian akhir' }], placeholders: { nama_pelanggan: 'Nama pelanggan', detail_sepatu: 'Daftar sepatu', url_tracking: 'Tautan privat' }, localOnly: true, encryptionReady: true };
      else if (path === '/whatsapp-templates/preview') { previews++; const input = route.request().postDataJSON(); if (input.body.includes('{salah}')) { await route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR' } } }); return; } body = { message: 'Halo Dina, 2 pasang sudah diterima.\n• Sepatu Biru\n• Sepatu Putih\n[tautan privat — contoh]\nCicuci Sepatu' }; }
      else if (path === '/whatsapp-templates' && method === 'PATCH') { expect(role).toBe('OWNER'); saved = route.request().postDataJSON(); body = saved; }
      else if (path === '/notifications') { history++; body.data = [{ id: 'old', template: 'ORDER_RECEIVED', provider: 'mock', status: 'SIMULATED', recipient: '+6281234567890', createdAt: '2026-11-01T00:00:00Z', attempts: [] }]; }
      await route.fulfill({ json: body });
    });
    await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Template pesan pelanggan' })).toBeVisible();
    await expect(page.getByText('Riwayat simulasi; tidak pernah dikirim nyata.', { exact: false })).not.toBeVisible(); expect(history).toBe(0);
    await expect(page.getByText('Alamat tracking masih localhost:', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Peristiwa notifikasi')).toHaveValue('ORDER_RECEIVED');
    for (const name of ['Sepatu diterima', 'Pemeriksaan dimulai', 'Pengemasan lama', 'Pemeriksaan kualitas']) await expect(page.getByRole('option', { name })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Penyelesaian akhir' })).toHaveCount(1);
    await page.getByText('Bantuan placeholder', { exact: true }).click(); await expect(page.getByText('{nama_pelanggan}', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Lihat pratinjau' }).click(); await expect(page.getByRole('region', { name: 'Pratinjau pesan' })).toContainText('Dina'); expect(previews).toBe(1);
    if (role === 'OWNER') {
      await page.getByLabel('Nama peristiwa', { exact: true }).fill('Penerimaan sepatu');
      await page.getByLabel('Isi pesan', { exact: true }).fill(initial.body + '\n{salah}');
      await page.getByRole('button', { name: 'Lihat pratinjau' }).click(); await expect(page.getByRole('alert')).toBeVisible();
      await page.getByLabel('Isi pesan', { exact: true }).fill(initial.body.replace('Halo Kak', 'Halo'));
      await page.getByRole('button', { name: 'Simpan template' }).click(); await expect(page.getByRole('status').filter({ hasText: 'Template tersimpan' })).toBeVisible();
      await page.reload(); await page.getByRole('button', { name: 'WhatsApp', exact: true }).click(); await expect(page.getByLabel('Nama peristiwa', { exact: true })).toHaveValue('Penerimaan sepatu');
    } else { await expect(page.getByLabel('Isi pesan', { exact: true })).toHaveAttribute('readonly', ''); await expect(page.getByRole('button', { name: 'Simpan template' })).toHaveCount(0); }
    await page.getByText('Riwayat pengiriman', { exact: true }).click(); await expect(page.getByText('Riwayat simulasi; tidak pernah dikirim nyata.', { exact: false })).toBeVisible(); expect(history).toBeGreaterThan(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(commands).toEqual([]);
  });
}
