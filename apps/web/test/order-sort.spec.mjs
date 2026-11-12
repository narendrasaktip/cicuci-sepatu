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
      body = { data: [{ id: 'fixture-order', number: 'CS-FIXTURE', customer: { name: 'Fixture Customer' }, aggregateStatus: 'RECEIVED', estimatedCompletionAt: '2026-12-01T00:00:00Z', totalIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID', itemCount: 1 }], page: { nextCursor: url.searchParams.has('cursor') ? null : 'fixture-order' } };
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  const table = page.getByRole('table');
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
  await page.getByRole('button', { name: 'Terapkan / muat ulang' }).click();
  await expect(table.getByRole('button', { name: 'Estimasi' })).toBeEnabled();
  expect(requests.at(-1).get('q')).toBe('needle'); expect(requests.at(-1).get('sort')).toBe('estimatedCompletionAt');
  await page.getByRole('button', { name: 'Berikutnya' }).click();
  await expect(table.getByRole('columnheader', { name: /Pesanan/ }).getByRole('button')).toBeEnabled();
  expect(requests.at(-1).get('cursor')).toBe('fixture-order');
  await table.getByRole('button', { name: 'Pelanggan' }).click();
  await expect(table.getByRole('button', { name: 'Pelanggan' })).toBeEnabled();
  expect(requests.at(-1).has('cursor')).toBe(false); expect(requests.at(-1).get('q')).toBe('needle');
  await expect(page.getByRole('button', { name: 'Sebelumnya' })).toBeDisabled();
});
