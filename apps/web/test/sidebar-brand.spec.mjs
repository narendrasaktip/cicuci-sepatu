import { test, expect } from '@playwright/test';
import process from 'node:process';
import { readFile, readdir } from 'node:fs/promises';
import { Buffer } from 'node:buffer';

const asset = new URL('../src/assets/logo.webp', import.meta.url);

const origin = process.env.TEST_WEB_ORIGIN ?? process.env.WEB_TEST_ORIGIN ?? 'http://127.0.0.1:5173';
for (const width of [1440, 768, 760, 390, 320]) {
  test(`sidebar logo loads without distortion or overflow at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      expect(route.request().method()).toBe('GET');
      const pathname = new URL(route.request().url()).pathname;
      const body = pathname.endsWith('/auth/me')
        ? { user: { id: 'fixture-owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' }
        : pathname.endsWith('/dashboard') ? {} : { data: [], page: { nextCursor: null } };
      await route.fulfill({ json: body });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/admin`);
    const brand = page.locator('.sidebar').getByRole('link', { name: 'Cicuci Sepatu', exact: true });
    await expect(brand).toHaveAttribute('href', '/');
    const image = brand.getByRole('img', { name: 'Cicuci Sepatu', exact: true });
    await expect(image).toBeVisible();
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(540);
    await expect(image).toHaveAttribute('width', '540');
    await expect(image).toHaveAttribute('height', '360');
    const dimensions = await image.evaluate(img => {
      const box = img.getBoundingClientRect();
      const sidebar = img.closest('.sidebar').getBoundingClientRect();
      return { width: box.width, height: box.height, naturalHeight: img.naturalHeight,
        contained: box.left >= sidebar.left && box.right <= sidebar.right && sidebar.right <= innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth, src: img.currentSrc };
    });
    expect(dimensions.naturalHeight).toBe(360);
    expect(dimensions.width).toBe(width <= 760 ? 90 : 120);
    expect(dimensions.height).toBe(width <= 760 ? 60 : 80);
    expect(dimensions.width / dimensions.height).toBeCloseTo(1.5);
    expect(dimensions.contained).toBe(true);
    // Existing order pagination overflows at 320px; keep this change scoped to the sidebar.
    if (width > 320) expect(dimensions.overflow).toBe(false);
    expect(dimensions.src).not.toContain('file:');
    expect(new URL(dimensions.src).pathname).toMatch(/\/logo(?:-[\w-]+)?\.webp$/);
    const response = await page.request.get(dimensions.src);
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(await readFile(asset));
    await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
    if (width > 760) await expect(page.getByText('Ruang operasional', { exact: true })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await brand.focus();
    await expect(brand).toBeFocused();
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`sidebar-${width}.png`), fullPage: true });
  });
}

for (const width of [1440, 768, 760, 390, 320]) {
  test(`tracking uses shared responsive logo at ${width}px`, async ({ page }, testInfo) => {
    const errors = [];
    const calls = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/api/**', async route => {
      calls.push(new URL(route.request().url()).pathname);
      expect(route.request().method()).toBe('GET');
      expect(calls.at(-1)).toBe('/api/v1/track/fixture-logo-only');
      await route.fulfill({ json: {
        number: 'FIXTURE-LOGO', aggregateStatus: 'WAITING_INSPECTION',
        totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID',
        estimatedCompletionAt: '2026-11-15T16:59:59.999Z', items: [],
      } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/track/fixture-logo-only`);
    await expect(page.getByRole('heading', { name: 'FIXTURE-LOGO' })).toBeVisible();
    const brand = page.locator('.tracking-header').getByRole('link', { name: 'Cicuci Sepatu', exact: true });
    await expect(brand).toHaveAttribute('href', '/');
    const image = brand.getByRole('img', { name: 'Cicuci Sepatu', exact: true });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute('width', '540');
    await expect(image).toHaveAttribute('height', '360');
    await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth)).toBe(540);
    const dimensions = await image.evaluate(img => {
      const box = img.getBoundingClientRect();
      const header = img.closest('header').getBoundingClientRect();
      return { width: box.width, height: box.height, naturalHeight: img.naturalHeight,
        contained: box.left >= header.left && box.right <= header.right && header.right <= innerWidth,
        overflow: document.documentElement.scrollWidth > innerWidth, src: img.currentSrc };
    });
    expect(dimensions.naturalHeight).toBe(360);
    expect(dimensions.width).toBe(width <= 760 ? 120 : 180);
    expect(dimensions.width / dimensions.height).toBeCloseTo(1.5);
    expect(dimensions.contained).toBe(true);
    expect(dimensions.overflow).toBe(false);
    expect(new URL(dimensions.src).pathname).toMatch(/\/logo(?:-[\w-]+)?\.webp$/);
    const response = await page.request.get(dimensions.src);
    expect(response.ok()).toBe(true);
    expect(await response.body()).toEqual(await readFile(asset));
    await expect(page.getByText('Tautan ini bersifat rahasia. Jangan bagikan kepada pihak lain.')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await brand.focus();
    await expect(brand).toBeFocused();
    expect(calls).toEqual(['/api/v1/track/fixture-logo-only']);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`tracking-${width}.png`), fullPage: true });
  });
}

test('production ships one optimized logo, never the original PNG', async () => {
  const optimized = await readFile(asset);
  const original = await readFile(new URL('../../../img/logo.png', import.meta.url));
  expect(optimized.length).toBeLessThan(60_000);
  expect(optimized.length).toBeLessThan(original.length / 20);
  const dist = new URL('../dist/', import.meta.url);
  const files = await readdir(dist, { recursive: true });
  const logos = files.filter(file => /logo/i.test(file));
  expect(logos).toHaveLength(1);
  expect(logos[0]).toMatch(/^assets\/logo-[\w-]+\.webp$/);
  expect(await readFile(new URL(logos[0], dist))).toEqual(optimized);
  let referenced = false;
  for (const file of files.filter(file => /\.(?:js|css|html|png|webp)$/.test(file))) {
    const content = await readFile(new URL(file, dist));
    expect(content.equals(original)).toBe(false);
    if (/\.(?:js|css|html)$/.test(file)) {
      expect(content.toString()).not.toMatch(/img\/logo\.png|logo-[\w-]+\.png|data:image\/png/);
      referenced ||= content.includes(Buffer.from(`/${logos[0]}`));
    }
  }
  expect(referenced).toBe(true);
});
