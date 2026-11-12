import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const presentation of ['classic', 'new']) for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`${presentation} ${role}: optional assignment, pricing guard, assignment scope`, async ({ page, context }) => {
  const item = { id: 'shoe', serviceId: 'service', serviceName: 'Cuci', brand: 'Nike', model: '', color: '', status: 'QUEUED', outcome: 'APPROVED', assignedUserId: null, quotedPriceIdr: 50000, finalPriceIdr: 50000, photos: [], consents: [], history: [] };
  const order = { id: 'order', number: 'CS-OPTIONAL', customer: { name: 'Fixture' }, estimatedCompletionAt: '2026-12-01T00:00:00Z', aggregateStatus: 'QUEUED', pricing: { version: 1, mode: 'NORMAL', stage: 'FINAL', totalIdr: 50000 }, totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', items: [item], payments: [] };
  const unexpected = [], mutations = [], assignments = [], cancellations = [];
  await context.addInitScript(value => localStorage.setItem('cicuci-presentation', value), presentation);
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', '');
    let body;
    if (request.method() === 'GET' && path === '/auth/me') body = { user: { id: 'operator', name: 'Fixture', role }, csrfToken: 'fixture-only' };
    else if (request.method() === 'GET' && path === '/dashboard') body = {};
    else if (request.method() === 'GET' && path === '/orders') body = { data: [order], page: { nextCursor: null } };
    else if (request.method() === 'GET' && path === '/orders/order') body = order;
    else if (request.method() === 'GET' && ['/services', '/users'].includes(path)) body = { data: [], page: { nextCursor: null } };
    else if (request.method() === 'POST' && path === '/items/shoe/transition') {
      mutations.push({ body: request.postDataJSON(), headers: request.headers() });
      item.status = mutations.at(-1).body.toStatus; body = order;
    } else if (request.method() === 'POST' && path === '/items/shoe/assignment') {
      assignments.push(request.postDataJSON());
      item.assignedUserId = assignments.at(-1).assignedUserId; body = order;
    } else if (request.method() === 'POST' && path === '/items/shoe/decline-cleaning') {
      cancellations.push(request.postDataJSON()); body = order;
    } else {
      unexpected.push(`${request.method()} ${path}`);
      await route.fulfill({ status: 501, json: { error: { code: 'UNEXPECTED_MOCK_ROUTE' } } }); return;
    }
    await route.fulfill({ json: body });
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: order.number, exact: true }).click();
  const start = page.getByRole('button', { name: 'Mulai pengerjaan', exact: true });
  await expect(page.getByText('Petugas (opsional): Belum ditugaskan', { exact: true })).toBeVisible();
  if (role === 'STAFF') {
    // Deliberately overinclusive mocked response: UI must not expose unauthorized actions.
    await expect(start).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Batalkan cuci pasangan', exact: true })).toHaveCount(0);
    item.assignedUserId = 'another-staff';
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await expect(start).toHaveCount(0);
    item.assignedUserId = 'operator';
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await expect(start).toBeEnabled();
    await expect(page.getByRole('button', { name: 'Tugaskan (opsional)', exact: true })).toHaveCount(0);
  } else {
    await expect(start).toBeEnabled();
    for (const stage of ['ESTIMATE']) {
      order.pricing.stage = stage;
      await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
      await expect(start).toBeDisabled();
      await expect(page.getByText('Pengerjaan menunggu pemeriksaan lengkap dan persetujuan risiko.', { exact: true })).toBeVisible();
    }
    order.pricing.stage = 'FINAL';
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await expect(start).toBeEnabled();
    const assign = page.getByRole('button', { name: 'Tugaskan (opsional)', exact: true });
    const cancel = page.getByRole('button', { name: 'Batalkan cuci pasangan', exact: true });
    const row = page.locator('article.shoe > .actions');
    await expect(row.getByRole('button')).toHaveText(['Mulai pengerjaan', 'Tugaskan (opsional)']);
    await expect(assign).toHaveClass('secondary');
    await expect(cancel).toHaveCount(0);
    await start.focus();
    await page.keyboard.press('Tab'); await expect(assign).toBeFocused();
    const desktop = await row.getByRole('button').evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect().top));
    expect(Math.max(...desktop) - Math.min(...desktop)).toBeLessThan(1);
    for (const width of [320, 375]) {
      await page.setViewportSize({ width, height: 850 });
      const boxes = await row.getByRole('button').evaluateAll(buttons => buttons.map(button => {
        const { x, y, width, height } = button.getBoundingClientRect(); return { x, y, width, height };
      }));
      for (const box of boxes) {
        expect(box.height).toBeGreaterThanOrEqual(44); expect(box.width).toBeGreaterThanOrEqual(44);
        expect(box.x).toBeGreaterThanOrEqual(0); expect(box.x + box.width).toBeLessThanOrEqual(width);
      }
      expect(boxes.at(-1).y).toBeGreaterThan(boxes[0].y);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 850 });
    await assign.click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Penugasan staf' })).toBeVisible();
    if (role === 'OWNER') await dialog.getByLabel('Petugas', { exact: true }).selectOption('unassigned');
    await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(assignments).toEqual([{ assignedUserId: null }]);
    item.status = 'RECEIVED'; item.outcome = null;
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await expect(cancel).toHaveClass('danger');
    await cancel.click();
    await expect(dialog.getByText('Biaya pasangan menjadi nol.', { exact: false })).toBeVisible();
    await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
    await expect(dialog).toBeVisible();
    expect(cancellations).toEqual([]);
    await dialog.getByLabel('Alasan penolakan/pembatalan pelanggan', { exact: false }).fill('Pelanggan membatalkan');
    await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(cancellations).toEqual([]);
    item.status = 'QUEUED'; item.outcome = 'APPROVED';
    await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
    await expect(cancel).toHaveCount(0);
    await page.locator('article.shoe summary', { hasText: 'Detail lainnya' }).click();
    await expect(page.locator('article.shoe > details > .actions')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /Foto [Dd]okumentasi/ })).toBeVisible();
    await expect(page.getByText('Riwayat status', { exact: true })).toBeVisible();
  }
  await expect(page.getByRole('button', { name: 'Catat persetujuan harga', exact: true })).toHaveCount(0);
  await start.click();
  await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(mutations).toHaveLength(1);
  expect(mutations[0].body).toEqual({ reason: '', toStatus: 'WASHING' });
  expect(mutations[0].headers['x-csrf-token']).toBe('fixture-only');
  expect(mutations[0].headers['idempotency-key']).toMatch(/^[0-9a-f-]{36}$/);
  expect(item.assignedUserId).toBe(role === 'STAFF' ? 'operator' : null);
  expect(unexpected).toEqual([]);
});
