import process from 'node:process';
import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const initial = { event: 'ORDER_RECEIVED', name: 'Pesanan diterima', body: 'Halo Kak {nama_pelanggan}, {total_sepatu} pasang sudah diterima.\n{detail_sepatu}\n{url_tracking}\nCicuci Sepatu' };
async function openWhatsApp(page) { await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'WhatsApp', exact: true }).click(); }
for (const role of ['OWNER', 'ADMIN']) for (const width of [390, 1024, 1280]) {
  test(`${role} templates preview/history/save responsive ${width}; never commands`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.addInitScript(() => localStorage.setItem('cicuci-presentation', 'new'));
    const commands = []; let saved = { ...initial }; let previews = 0; let history = 0;
    await page.route('**/api/v1/**', async route => {
      const path = new URL(route.request().url()).pathname.replace('/api/v1', '');
      const method = route.request().method(); let body = { data: [], page: { nextCursor: null } };
      if (path === '/auth/me') body = { user: { id: 'template-user', name: 'Uji', role }, csrfToken: 'test' };
      else if (path === '/dashboard') body = {};
      else if (path === '/whatsapp/status') body = { state: 'ready', ready: true, realSendEnabled: false };
      else if (path.startsWith('/whatsapp/')) commands.push(path);
      else if (path === '/whatsapp-templates' && method === 'GET') body = { templates: [{ ...initial, event: 'RECEIVED', name: 'Sepatu diterima' }, { ...initial, event: 'INSPECTION', name: 'Pemeriksaan dimulai' }, saved, { ...initial, event: 'PACKING', name: 'Pengemasan lama' }, { ...initial, event: 'QC', name: 'Pemeriksaan kualitas' }, { ...initial, event: 'FINISHING', name: 'Penyelesaian akhir' }, { ...initial, event: 'PICKUP_BILL_UNPAID', name: 'Tagihan siap ambil' }, { ...initial, event: 'PICKUP_BILL_PAID', name: 'Siap ambil lunas' }], placeholders: { nama_pelanggan: 'Nama pelanggan', detail_sepatu: 'Daftar sepatu', url_tracking: 'Tautan privat', ...Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`contoh_${i}`, `Deskripsi contoh ${i}`])) }, localOnly: true, encryptionReady: true };
      else if (path === '/whatsapp-templates/preview') { previews++; const input = route.request().postDataJSON(); if (input.body.includes('{salah}')) { await route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR' } } }); return; } body = { message: 'Halo Dina, 2 pasang sudah diterima.\n*Sepatu Biru*\n_Sepatu Putih_\n[tautan privat — contoh]\nCicuci Sepatu' }; }
      else if (path === '/whatsapp-templates' && method === 'PATCH') { expect(role).toBe('OWNER'); saved = route.request().postDataJSON(); body = saved; }
      else if (path === '/notifications') { history++; body.data = [{ id: 'old', template: 'ORDER_RECEIVED', provider: 'mock', status: 'SIMULATED', recipient: '+6281234567890', createdAt: '2026-11-01T00:00:00Z', attempts: [] }]; }
      await route.fulfill({ json: body });
    });
    await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
    await openWhatsApp(page);
    await page.getByRole('button', { name: 'Template Pesan', exact: true }).click();
    await expect(page.getByRole('heading', { name: /Template pesan pelanggan/i })).toBeVisible();
    await expect(page.getByText('Riwayat simulasi; tidak pernah dikirim nyata.', { exact: false })).not.toBeVisible(); expect(history).toBe(0);
    await expect(page.getByText('Alamat tracking masih localhost:', { exact: false })).toBeVisible();
    await expect(page.getByLabel('Peristiwa Notifikasi')).toHaveValue('ORDER_RECEIVED');
    const eventBox = await page.getByLabel('Peristiwa Notifikasi').boundingBox();
    const nameBox = await page.getByLabel('Nama Peristiwa', { exact: true }).boundingBox();
    const editorBox = await page.getByLabel('Isi Pesan', { exact: true }).boundingBox();
    const helpBox = await page.getByRole('complementary', { name: 'Bantuan penulisan pesan' }).boundingBox();
    expect(editorBox.height).toBeGreaterThanOrEqual(300);
    if (width > 800) expect(Math.abs(eventBox.y - nameBox.y)).toBeLessThan(5);
    else expect(nameBox.y).toBeGreaterThan(eventBox.y + eventBox.height);
    expect(helpBox.y).toBeGreaterThan(editorBox.y + editorBox.height);
    expect(helpBox.width).toBeGreaterThanOrEqual(editorBox.width);
    for (const name of ['Sepatu diterima', 'Pemeriksaan dimulai', 'Pengemasan lama', 'Pemeriksaan kualitas']) await expect(page.getByRole('option', { name })).toHaveCount(0);
    await expect(page.getByRole('option', { name: 'Penyelesaian akhir' })).toHaveCount(1);
    await page.getByLabel('Peristiwa Notifikasi').selectOption('PICKUP_BILL_UNPAID');
    await expect(page.getByText('saldo diperiksa kembali', { exact: false })).toContainText('QR pembayaran disertakan');
    await page.getByLabel('Peristiwa Notifikasi').selectOption('PICKUP_BILL_PAID');
    await expect(page.getByText('saldo diperiksa kembali', { exact: false })).toContainText('Jangan gunakan');
    await page.getByLabel('Peristiwa Notifikasi').selectOption('ORDER_RECEIVED');
    await expect(page.getByText('{nama_pelanggan}', { exact: true })).toBeVisible();
    const list = page.getByRole('region', { name: 'Daftar placeholder' });
    const dimensions = await list.evaluate(el => ({ height: el.clientHeight, content: el.scrollHeight, overflow: getComputedStyle(el).overflowY, columns: getComputedStyle(el).gridTemplateColumns.split(' ').length }));
    expect(dimensions.content).toBe(dimensions.height);
    expect(dimensions.overflow).toBe('visible');
    expect(dimensions.columns).toBeGreaterThanOrEqual(1);
    await expect(list.getByText('Deskripsi contoh 19')).toBeVisible();
    if (role === 'OWNER') {
      const editor = page.getByLabel('Isi Pesan', { exact: true });
      await editor.focus(); await editor.evaluate(el => el.setSelectionRange(0, 0));
      await page.getByRole('button', { name: 'Sisipkan contoh_19' }).focus(); await page.keyboard.press('Enter');
      await expect(editor).toHaveValue('{contoh_19}' + initial.body);
      await editor.fill(initial.body);
    }
    await expect(page.getByText('Placeholder adalah penanda', { exact: false })).toBeVisible();
    for (const example of ['*teks*', '_teks_', '~teks~']) await expect(page.getByText(example, { exact: true })).toBeVisible();
    await expect(page.locator('.theme-new .wa-templates')).toBeVisible();
    await expect(page.locator('.wa-templates .format-help')).toHaveCSS('background-color', 'rgb(244, 247, 252)');
    const fonts = await page.locator('.wa-templates').evaluate(el => [getComputedStyle(el).fontFamily, getComputedStyle(el.querySelector('textarea')).fontFamily]);
    expect(fonts[1]).toBe(fonts[0]);
    await expect(page.getByText('bukan dua tanda bintang', { exact: false })).toBeVisible();
    if (role === 'OWNER') {
      const editor = page.getByLabel('Isi Pesan', { exact: true });
      await editor.focus(); await editor.evaluate(el => el.setSelectionRange(0, 0));
      await page.getByRole('button', { name: 'Sisipkan nama_pelanggan' }).click();
      await expect(editor).toHaveValue('{nama_pelanggan}' + initial.body);
      await expect(page.getByText('Perubahan belum disimpan.')).toBeVisible();
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByLabel('Peristiwa Notifikasi').selectOption('PICKUP_BILL_PAID');
      await expect(page.getByLabel('Peristiwa Notifikasi')).toHaveValue('ORDER_RECEIVED');
      await editor.fill(initial.body);
    }
    await expect(page.getByRole('region', { name: 'Pratinjau pesan' })).toContainText('Dina'); expect(previews).toBeGreaterThan(0);
    await expect(page.locator('.preview-message strong')).toHaveText('Sepatu Biru');
    await expect(page.locator('.preview-message em')).toHaveText('Sepatu Putih');
    if (role === 'OWNER') {
      await page.getByLabel('Nama Peristiwa', { exact: true }).fill('Penerimaan sepatu');
      await page.getByLabel('Isi Pesan', { exact: true }).fill(initial.body + '\n{salah}');
      await expect(page.getByRole('alert')).toBeVisible();
      await page.getByLabel('Isi Pesan', { exact: true }).fill(initial.body.replace('Halo Kak', 'Halo'));
      await page.getByRole('button', { name: 'Simpan Template' }).click(); await expect(page.getByRole('status').filter({ hasText: 'Template tersimpan' })).toBeVisible();
      await page.reload(); await openWhatsApp(page); await page.getByRole('button', { name: 'Template Pesan', exact: true }).click(); await expect(page.getByLabel('Nama Peristiwa', { exact: true })).toHaveValue('Penerimaan sepatu');
    } else { await expect(page.getByLabel('Isi Pesan', { exact: true })).toHaveAttribute('readonly', ''); await expect(page.getByRole('button', { name: 'Simpan Template' })).toHaveCount(0); }
    await expect(page.getByRole('button', { name: 'Riwayat', exact: true })).toHaveCount(0); expect(history).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true); expect(commands).toEqual([]);
  });
}
