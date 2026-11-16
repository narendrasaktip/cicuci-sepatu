import { test, expect } from '@playwright/test';
test.use({ launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [768, 820, 1024]) test(`reviews tablet layout ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1024 });
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith('/auth/me') ? { user: { id: 'owner', name: 'Owner', role: 'OWNER' }, csrfToken: 'fixture' }
      : path.endsWith('/display-settings') ? { statusLabels: {} }
      : path.endsWith('/feedback') ? { data: [{ id: 'review', rating: 5, review: 'Hasil perawatan bersih. '.repeat(20), publicationConsent: true, isPublished: false, createdAt: '2026-11-16T10:00:00Z', order: { id: 'order', number: 'CC-20261116-1234567890', customer: { name: 'Pelanggan Dengan Nama Panjang' } } }], page: { nextCursor: null } }
      : { state: 'stopped', ready: false } });
  });
  await page.goto('http://127.0.0.1:5173/admin/reviews');
  await expect(page.getByRole('heading', { name: 'Ulasan Pelanggan' })).toBeVisible();
  await expect(page.getByText('Pelanggan Dengan Nama Panjang', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('.feedback-filters')).toHaveCSS('display', 'grid');
  const publication = await page.locator('.feedback-filters select').nth(0).boundingBox();
  const rating = await page.locator('.feedback-filters select').nth(1).boundingBox();
  const apply = await page.getByRole('button', { name: 'Terapkan Filter' }).boundingBox();
  expect(publication.y).toBe(rating.y);
  expect(publication.height).toBe(44);
  expect(rating.height).toBe(44);
  expect(apply.height).toBe(44);
  if (width < 1024) expect(apply.y).toBeGreaterThanOrEqual(publication.y + publication.height);
  else expect(apply.y).toBe(publication.y);
  for (const control of await page.locator('.feedback-filters select, .entry-footer button').all()) {
    const box = await control.boundingBox();
    expect(box.width).toBeGreaterThan(100);
    expect(box.x + box.width).toBeLessThanOrEqual(width);
  }
});
