import process from 'node:process';
import { test, expect } from '@playwright/test';

for (const timezoneId of ['Asia/Jakarta', 'America/Los_Angeles']) {
  test.describe(timezoneId, () => {
    test.use({ timezoneId });
    for (const mode of ['existing', 'new']) test(`${mode} customer: no date, retained form and stable retry keys`, async ({ page }) => {
      let customerPosts = 0; const submissions = []; const keys = [];
      const customer = { id: 'customer', name: 'Fixture', whatsapp: '+628111111111' };
      await page.route('**/api/**', async route => {
        const request = route.request(); const url = new URL(request.url());
        let body = { data: [], page: { nextCursor: null } };
        if (url.pathname.endsWith('/auth/me')) body = { user: { id: 'owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' };
        else if (url.pathname.endsWith('/dashboard')) body = {};
        else if (url.pathname.endsWith('/pricing/plans')) body = [{ id: 'plan', name: 'Tarif fixture', isActive: true, revision: 1, rules: [{ kind: 'PER_PAIR', minPairs: 1, maxPairs: null, priceIdr: 50000 }] }];
        else if (url.pathname.endsWith('/pricing/preview')) body = { totalIdr: 50000, breakdown: [] };
        else if (url.pathname.endsWith('/services')) body.data = [{ id: 'service', name: 'Clean', basePriceIdr: 50000 }];
        else if (url.pathname.endsWith('/customers')) {
          if (request.method() === 'POST') { customerPosts++; body = customer; }
          else body.data = [customer];
        } else if (url.pathname.endsWith('/orders') && request.method() === 'POST') {
          submissions.push(request.postDataJSON()); keys.push(request.headers()['idempotency-key']);
          if (submissions.length === 1) { await route.fulfill({ status: 503, json: { error: { message: 'Coba lagi' } } }); return; }
          body = { id: 'order', number: 'CS-FIXTURE', customer, items: [], payments: [], estimatedCompletionAt: '2026-11-15T16:59:59.999Z', trackingToken: 'a'.repeat(64), notification: { status: 'SKIPPED', actualOutbound: false } };
        }
        await route.fulfill({ json: body });
      });
      await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
      await page.getByRole('navigation', { name: 'Navigasi utama' }).getByRole('button', { name: 'Pesanan', exact: true }).click();
      await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
      await expect(page.locator('input[type="datetime-local"], input[type="date"]')).toHaveCount(0);
      await page.getByLabel('Tarif pesanan').selectOption('plan');
      await expect(page.getByText('Estimasi selesai otomatis:', { exact: false })).toContainText('5 hari kalender');
      await expect(page.getByText('Estimasi selesai otomatis:', { exact: false })).toContainText('12.00 WIB');
      if (mode === 'new') {
        await page.getByLabel('Pelanggan baru', { exact: true }).check();
        await page.getByLabel('Nama *', { exact: true }).fill('Fixture');
        await page.getByLabel('Nomor WhatsApp *', { exact: true }).fill('081111111111');
      } else {
        await page.getByLabel('Cari pelanggan').fill('Fixture');
        await page.getByRole('button', { name: 'Fixture · +628111111111', exact: true }).click();
      }
      await page.getByLabel('Tarif pesanan').selectOption('plan');
      const shoe = page.getByRole('group', { name: 'Sepatu 1', exact: true });
      await shoe.getByLabel('Merek *', { exact: true }).fill('Nike');
      await expect(shoe.getByLabel('Merek *', { exact: true })).toHaveAttribute('required', '');
      for (const label of ['Model (opsional)', 'Warna (opsional)']) {
        await expect(shoe.getByLabel(label, { exact: true })).not.toHaveAttribute('required');
        await expect(shoe.getByLabel(label, { exact: true })).toHaveValue('');
      }
      await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
      await expect(page.getByRole('alert')).toContainText('Coba lagi');
      await expect(shoe.getByLabel('Merek *', { exact: true })).toHaveValue('Nike');
      // Saving after a delayed retry never calculates or sends a browser-based date.
      await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
      await expect(page.getByRole('status').filter({ hasText: 'Pesanan tersimpan.' })).toBeVisible();
      expect(submissions[0].items[0]).toMatchObject({ brand: 'Nike', model: '', color: '' });
      expect(submissions).toHaveLength(2); expect(submissions[0]).toEqual(submissions[1]);
      expect(submissions[0]).not.toHaveProperty('estimatedCompletionAt');
      expect(keys[0]).toBeTruthy(); expect(keys[0]).toBe(keys[1]);
      expect(customerPosts).toBe(mode === 'new' ? 1 : 0);
    });
  });
}
