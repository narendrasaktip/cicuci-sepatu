import process from 'node:process';
import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
test('mobile login, keyboard focus, ignored preview, unavailable public token', async ({ page }) => {
  const errors = [], calls = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/**', route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    calls.push(`${request.method()} ${path}`);
    return route.fulfill({ status: request.method() === 'GET' && path === '/api/v1/auth/me' ? 401 : 404, json: { error: { code: path.includes('/track/') ? 'TOKEN_INVALID' : 'UNAUTHENTICATED' } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await page.keyboard.press('Tab'); await expect(page.getByRole('link', { name: 'Lewati ke konten' })).toBeFocused();
  await expect(page.getByLabel('Email', { exact: true })).toHaveAttribute('autocomplete', 'username');
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.goto(`${origin}/admin?preview=1`); await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await expect(page.locator('.sidebar')).toHaveCount(0);
  await page.goto(`${origin}/track/invalid`); await expect(page.getByRole('alert')).toContainText('TOKEN_INVALID');
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toHaveCount(0);
  expect(calls).toEqual(['GET /api/v1/auth/me', 'GET /api/v1/auth/me', 'GET /api/v1/track/invalid']);
  expect(errors).toEqual([]);
});
