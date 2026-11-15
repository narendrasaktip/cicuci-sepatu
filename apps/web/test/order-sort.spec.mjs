import process from 'node:process';
import { test, expect } from '@playwright/test';

const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
test('order headers toggle server sorting, retain filters and reset pagination', async ({ page }) => {
  const requests = [];
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    let body = { data: [], page: { nextCursor: null } };
    if (url.pathname.endsWith('/auth/me')) body = { user: { id: 'fixture-owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' };
    else if (url.pathname.endsWith('/dashboard')) body = {};
    else if (url.pathname.endsWith('/orders')) {
      requests.push(url.searchParams);
      body = { data: [{ id: 'fixture-order', number: 'CS-FIXTURE', customer: { name: 'Fixture Customer' }, aggregateStatus: 'RECEIVED', createdAt: '2026-11-13T18:00:00Z', estimatedCompletionAt: '2026-12-01T00:00:00Z', totalIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID', itemCount: 1 }], page: { nextCursor: url.searchParams.has('cursor') ? null : 'fixture-order' } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  const table = page.getByRole('table');
  expect(requests.at(-1).get('sort')).toBe('createdAt');
  expect(requests.at(-1).get('direction')).toBe('desc');
  await expect(table.getByText(/Dibuat: 14 Nov 2026, 01\.00/)).toBeVisible();
  await expect(table.getByRole('columnheader', { name: /Pesanan/ })).toHaveAttribute('aria-sort', 'descending');
  for (const [title, key] of [['Pesanan', 'createdAt'], ['Pelanggan', 'customer'], ['Status', 'status'], ['Estimasi', 'estimatedCompletionAt']]) {
    const header = table.getByRole('columnheader', { name: new RegExp(title) });
    const button = header.getByRole('button');
    await button.click();
    await expect(header).toHaveAttribute('aria-sort', 'ascending');
    await expect(button).toBeEnabled();
    expect(requests.at(-1).get('sort')).toBe(key); expect(requests.at(-1).get('direction')).toBe('asc');
    await button.focus(); await page.keyboard.press('Enter');
    await expect(header).toHaveAttribute('aria-sort', 'descending');
    await expect(button).toBeEnabled();
    expect(requests.at(-1).get('direction')).toBe('desc');
  }
  await page.getByLabel('Cari', { exact: true }).fill('needle');
  await page.getByRole('button', { name: 'Cari', exact: true }).click();
  await expect(table.getByRole('button', { name: 'Estimasi' })).toBeEnabled();
  expect(requests.at(-1).get('q')).toBe('needle'); expect(requests.at(-1).get('sort')).toBe('estimatedCompletionAt');
  await page.getByRole('button', { name: 'Berikutnya' }).click();
  await expect(table.getByRole('columnheader', { name: /Pesanan/ }).getByRole('button')).toBeEnabled();
  expect(requests.at(-1).get('cursor')).toBe('fixture-order');
  await table.getByRole('button', { name: 'Pelanggan' }).click();
  await expect(table.getByRole('button', { name: 'Pelanggan' })).toBeEnabled();
  expect(requests.at(-1).has('cursor')).toBe(false); expect(requests.at(-1).get('q')).toBe('needle');
  await expect(page.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reset', exact: true })).toBeHidden();
  expect(requests.at(-1).has('q')).toBe(false);
  await expect(table.locator('td[data-label="Keuangan"] p br')).toHaveCount(1);
  for (const width of [320, 390, 768, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.locator('.topbar').getByRole('button', { name: 'Pesanan baru' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Pesanan baru' })).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Daftar Pesanan' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Cari', exact: true })).toBeVisible();
    const wrap = page.locator('.order-table');
    expect(await wrap.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
    await expect(table.getByText('Fixture Customer')).toBeVisible();
    await expect(table.getByRole('button', { name: 'Hapus pesanan CS-FIXTURE' })).toBeVisible();
    await expect(table.getByRole('button', { name: 'Status', exact: true })).toBeVisible();
  }
  await page.getByRole('button', { name: 'Pesanan baru' }).click();
  await expect(page.locator('.topbar').getByRole('button', { name: 'Batal' })).toBeVisible();
  await page.getByRole('button', { name: 'Batal' }).click();
  await expect(page.getByRole('button', { name: 'Pesanan baru' })).toBeVisible();
});
