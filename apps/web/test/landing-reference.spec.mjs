import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

for (const width of [320, 390, 768, 1440]) {
  test(`landing reference at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route('**/api/**', route => route.abort());
    await page.goto('http://127.0.0.1:5174/');
    await expect(page.getByRole('heading', { name: /Sepatu Kotor/ })).toBeVisible();
    await expect(page.locator('.hero-art img')).not.toHaveJSProperty('naturalWidth', 0);
    await expect(page.locator('.hero-art img')).toHaveAttribute('src', await page.locator('.brand img').getAttribute('src'));
    const logo = page.locator('.brand img');
    await expect(logo).not.toHaveJSProperty('naturalWidth', 0);
    await expect(logo).toHaveCSS('object-fit', 'contain');
    const response = await page.request.get(await logo.evaluate(image => image.src));
    expect(await response.body()).toEqual(await readFile(new URL('../../../cicuci-sepatu 8/assets/logo-transparent.png', import.meta.url)));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (width <= 700) {
      const menu = page.getByRole('button', { name: 'Buka menu' });
      await menu.click();
      await expect(page.getByRole('button', { name: 'Tutup menu' })).toHaveAttribute('aria-expanded', 'true');
      await page.locator('#mobileMenu').getByRole('link', { name: 'FAQ' }).click();
      await expect(menu).toHaveAttribute('aria-expanded', 'false');
    }
    await page.getByRole('link', { name: /Cek Status/ }).click();
    await expect(page.locator('#tracking')).toBeInViewport();
  });
}

test('direct admin and tracking routes remain separate', async ({ page }) => {
  await page.route('**/api/**', route => route.fulfill({ status: 401, contentType: 'application/json', body: '{}' }));
  await page.goto('http://127.0.0.1:5174/admin');
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await page.goto('http://127.0.0.1:5174/track/test-token');
  await expect(page.locator('.site')).toHaveCount(0);
  await expect(page.locator('main')).toBeVisible();
});
