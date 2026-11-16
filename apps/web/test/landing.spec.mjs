import { test, expect } from '@playwright/test';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import vue from '@vitejs/plugin-vue';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';

for (const width of [320, 390, 1440]) {
  test(`landing publik responsif ${width}`, async ({ page }) => {
    const calls = [];
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.route('**/api/v1/**', route => { calls.push(route.request().url()); return route.fulfill({ status: 501 }); });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(origin);
    await expect(page.getByRole('heading', { level: 1 })).toContainText('Sepatu Kotor?');
    await expect(page.getByRole('heading', { name: 'Cara Pesan' })).toBeVisible();
    const reasons = page.locator('.why > div');
    await expect(reasons).toHaveText(['♢ Kondisi Sepatu Diperiksa', '◷ Proses Terpantau Setiap Saat', '◇ Konfirmasi Sebelum Pengerjaan', '☆ Perawatan Sesuai Kebutuhan']);
    const layout = await reasons.evaluateAll(items => items.map(item => ({ font: getComputedStyle(item).fontSize, icon: item.querySelector('b').getBoundingClientRect().width, right: item.getBoundingClientRect().right })));
    expect(new Set(layout.map(item => item.font)).size).toBe(1);
    expect(new Set(layout.map(item => item.icon)).size).toBe(1);
    expect(layout.every(item => item.right <= width)).toBe(true);
    await expect(page.getByRole('link', { name: 'Pesan Sekarang' }).first()).toHaveAttribute('href', '/pesan');
    await expect(page.locator('a[href*="phone=6285179963343"]').first()).toBeVisible();
    await expect(page.locator('header a[href^="/admin"], footer a[href^="/admin"]')).toHaveCount(0);
    await expect(page.getByRole('link', { name: /admin/i })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(calls.every(url => new URL(url).pathname === '/api/v1/public/feedback')).toBe(true);
    expect(requests.some(url => /AdminWorkspace|PublicTracking|fonts\.google/.test(url))).toBe(false);
    for (const image of await page.locator('main img, header img').all()) expect(await image.evaluate(el => el.complete && el.naturalWidth > 0)).toBe(true);
    await page.getByRole('link', { name: 'Lewati ke konten' }).focus();
    await expect(page.getByRole('link', { name: 'Lewati ke konten' })).toBeFocused();
  });
}

for (const number of ['', '6281234567890', ' 6281234567890 ', '+6281234567890', '081234567890', '62812<script>']) {
  test(`public WhatsApp configuration ${JSON.stringify(number)}`, async ({ page }) => {
    // ponytail: Isolated Vite transform; never touch real env files or open the contact link.
    const server = await createServer({
      configFile: false, envFile: false,
      root: fileURLToPath(new URL('../', import.meta.url)), plugins: [vue()],
      define: { 'import.meta.env.VITE_PUBLIC_WHATSAPP_NUMBER': JSON.stringify(number) },
      server: { host: '127.0.0.1', port: 0 },
    });
    const outbound = [];
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue();
      outbound.push(url.href);
      return route.abort();
    });
    try {
      await server.listen();
      await page.goto(server.resolvedUrls.local[0]);
      await expect(page.getByRole('heading', { level: 1 })).toContainText('Sepatu Kotor?');
      const link = page.locator('a[href*="phone=6285179963343"]').first();
      await expect(link).toBeVisible();
      const destination = new URL(await link.getAttribute('href'));
      expect(destination.hostname).toBe('api.whatsapp.com');
      expect(destination.searchParams.get('phone')).toBe('6285179963343');
      expect(outbound.every(url => new URL(url).pathname === '/api/v1/public/feedback')).toBe(true);
    } finally { await server.close(); }
  });
}


test('admin dan tracking tetap dapat diakses langsung', async ({ page }) => {
  await page.route('**/api/v1/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: { code: 'UNAUTHORIZED', message: 'Unauthorized' } }) }));
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await page.goto(`${origin}/track/private-test-token`);
  await expect(page.getByRole('heading', { name: 'Sepatu Kotor?' })).toHaveCount(0);
  await expect(page.locator('#main-content')).toBeVisible();
});
