import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const catalog = { plans: [
  { id: 'regular', name: 'Reguler', turnaroundPolicy: 'REGULAR', quotes: [1, 2, 3].map(pairs => ({ pairs, totalIdr: pairs === 3 ? 130000 : pairs * 45000, breakdown: [{ kind: 'PACKAGE', quantity: pairs === 3 ? 1 : pairs, pairs: pairs === 3 ? 3 : 1, priceIdr: pairs === 3 ? 130000 : 45000, totalIdr: pairs === 3 ? 130000 : pairs * 45000 }] })) },
  { id: 'fast', name: 'Express', turnaroundPolicy: 'FAST', quotes: [{ pairs: 3, totalIdr: 180000, breakdown: [{ kind: 'PER_PAIR', quantity: 3, pairs: 1, priceIdr: 60000, totalIdr: 180000 }] }] },
] };

test('order validates input, opens WhatsApp with formatted details', async ({ page, context }) => {
  let destination;
  await context.route('**/api/v1/public/catalog', route => route.fulfill({ json: catalog }));
  await context.route('https://api.whatsapp.com/**', async route => {
    destination = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: 'WhatsApp' });
  });
  await page.goto(origin);
  await page.getByRole('link', { name: 'Pesan Sekarang' }).first().click();
  await expect(page).toHaveURL(origin + '/pesan');
  await page.getByLabel('Nama lengkap').fill('   ');
  await page.getByLabel('Alamat penjemputan').fill('   ');
  await page.getByRole('button', { name: 'Lanjut ke WhatsApp' }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  expect(destination).toBeUndefined();
  await page.getByLabel('Nama lengkap').fill(' Ayu & Budi ');
  await page.getByLabel('Alamat penjemputan').fill(' Jl. Mawar #2\nLippo Karawaci ');
  await page.getByLabel('Jumlah pasang sepatu').fill('3');
  await expect(page.getByRole('region', { name: 'Estimasi biaya cuci' })).toContainText('130.000');
  await page.getByLabel('Pilihan tarif').selectOption('fast');
  await expect(page.getByRole('region', { name: 'Estimasi biaya cuci' })).toContainText('180.000');
  await page.getByLabel('Pilihan tarif').selectOption('regular');
  await page.getByLabel('Catatan', { exact: false }).fill(' Sneakers + suede? ');
  await page.getByRole('button', { name: 'Lanjut ke WhatsApp' }).click();
  await expect.poll(() => destination?.hostname).toBe('api.whatsapp.com');
  expect(destination.searchParams.get('phone')).toBe('6285179963343');
  const text = destination.searchParams.get('text');
  expect(text).toContain('Nama: Ayu & Budi\n\nTarif: Reguler');
  expect(text).toContain('Jumlah sepatu: 3 pasang\n\n');
  expect(text).toContain('(belum final)\n\nMetode penyerahan:');
  for (const line of ['Halo Admin Cicuci Sepatu,\n\nSaya ingin pesan cuci sepatu.', 'Nama: Ayu & Budi', 'Tarif: Reguler', 'Jumlah sepatu: 3 pasang', 'paket 3 pasang', '130.000 (belum final)', 'Metode penyerahan: Dijemput', 'Alamat Penjemputan: Jl. Mawar #2\nLippo Karawaci\n\nGratis penjemputan sekitar Lippo Karawaci. Cakupan alamat dikonfirmasi admin. Di luar area, biaya dikonfirmasi admin.', 'Catatan: Sneakers + suede?']) expect(text).toContain(line);
});

test('handover location changes by method; store needs no address', async ({ page, context }) => {
  await context.route('**/api/v1/public/catalog', route => route.fulfill({ json: catalog }));
  await context.route('https://api.whatsapp.com/**', route => route.fulfill({ body: 'WhatsApp' }));
  await page.goto(origin + '/pesan');
  await page.getByLabel('Nama lengkap').fill('Ayu');
  await expect(page.locator('#handover-info')).toContainText('Tim Cicuci Sepatu menjemput');
  await page.getByLabel('Metode penyerahan').selectOption('MEETUP');
  await expect(page.locator('#handover-info')).toContainText('Lokasi dan waktunya disepakati lewat WhatsApp.');
  await expect(page.getByLabel('Lokasi janjian')).toBeVisible();
  await page.getByLabel('Metode penyerahan').selectOption('COURIER');
  await expect(page.locator('#handover-info')).toContainText('Sepatu diserahkan melalui kurir.');
  await expect(page.getByLabel('Alamat pengambilan kurir')).toBeVisible();
  await expect(page.getByText('Biaya kurir dikonfirmasi admin, belum termasuk estimasi biaya cuci.')).toBeVisible();
  await page.getByLabel('Metode penyerahan').selectOption('STORE');
  await expect(page.locator('#handover-info')).toContainText('Kamu mengantar sepatu langsung ke toko.');
  await expect(page.locator('#order-address')).toHaveCount(0);
  await page.getByRole('button', { name: 'Lanjut ke WhatsApp' }).click();
  await expect(page).toHaveURL(/api.whatsapp.com/);
  const text = new URL(page.url()).searchParams.get('text');
  expect(text).toContain('Metode penyerahan: Di toko');
  expect(text).not.toContain('Gratis penjemputan');
  expect(text).not.toContain('Alamat');
});

test('order sections fit mobile, tablet and desktop', async ({ page, context }) => {
  await context.route('**/api/v1/public/catalog', route => route.fulfill({ json: catalog }));
  for (const width of [320, 390, 768, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin + '/pesan');
    await expect(page.getByRole('group', { name: 'Detail Cucian' })).toBeVisible();
    await expect(page.locator('.estimate-amount')).toContainText('45.000');
    await expect(page.locator('h1')).toHaveCSS('font-weight', '700');
    await expect(page.locator('.estimate-amount')).toHaveCSS('font-weight', '600');
    for (const text of await page.locator('label').all()) await expect(text).toHaveCSS('font-weight', '600');
    await expect(page.locator('footer')).toHaveCSS('font-weight', '400');
    for (const text of await page.locator('legend, .estimate-label').all()) await expect(text).toHaveCSS('font-weight', '700');
    await expect(page.getByRole('button', { name: 'Lanjut ke WhatsApp' })).toHaveCSS('font-weight', '500');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    for (const control of await page.locator('input, select, textarea, button').all()) {
      const box = await control.boundingBox();
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  }
});

test('catalog failure retries; no active plans blocks submission', async ({ page, context }) => {
  let fail = true;
  await context.route('**/api/v1/public/catalog', route => route.fulfill(fail ? { status: 503, json: {} } : { json: { plans: [] } }));
  await page.goto(origin + '/pesan');
  await expect(page.getByRole('alert')).toContainText('Tarif gagal dimuat');
  await expect(page.getByRole('button', { name: 'Lanjut ke WhatsApp' })).toBeDisabled();
  fail = false;
  await page.getByRole('button', { name: 'Coba lagi' }).click();
  await expect(page.getByRole('status')).toContainText('Belum ada tarif aktif');
  await expect(page.getByRole('button', { name: 'Lanjut ke WhatsApp' })).toBeDisabled();
});
