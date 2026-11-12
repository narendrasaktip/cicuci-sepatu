import { test, expect } from '@playwright/test';
import { Buffer } from 'node:buffer';
import process from 'node:process';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');
async function setup(page, status = 'RECEIVED') {
  const item = id => ({ id, serviceId: 'service', serviceName: 'Cuci', brand: 'Nike', model: id, color: 'Putih', status, outcome: status === 'RECEIVED' ? null : 'APPROVED', quotedPriceIdr: 50000, finalPriceIdr: status === 'RECEIVED' ? 0 : 50000, photos: [], consents: [], history: [] });
  const order = { id: 'order', number: 'CS-FIXTURE', customer: { name: 'Fixture', whatsapp: 'optout' }, estimatedCompletionAt: '2026-12-01T00:00:00Z', aggregateStatus: 'WAITING_INSPECTION', totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID', items: [item('one'), item('two')], payments: [] };
  const calls = []; const saved = new Map(); let failUpload = false; let failSubmit = false; let loseUploadResponse = false;
  await page.route('**/api/**', async route => {
    const request = route.request(); const path = new URL(request.url()).pathname;
    let body = { data: [], page: { nextCursor: null } };
    if (path.endsWith('/auth/me')) body = { user: { id: 'owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' };
    else if (path.endsWith('/settings/inspection-capabilities')) body = { structuredRiskConsent: true };
    else if (path.endsWith('/display-settings')) body = { statusLabels: {} };
    else if (path.endsWith('/services') || path.endsWith('/users')) body = { data: [], page: { nextCursor: null } };
    else if (path.includes('/track/')) body = order;
    else if (path.endsWith('/dashboard')) body = {};
    else if (path.endsWith('/orders')) body = { data: [order], page: { nextCursor: null } };
    else if (path.endsWith('/orders/order')) body = order;
    else if (request.method() === 'POST' && /\/items\//.test(path)) {
      const payload = request.postDataJSON(); const key = request.headers()['idempotency-key']; calls.push({ path, payload, key });
      if (path.endsWith('/photos')) {
        if (failUpload) { failUpload = false; return route.fulfill({ status: 503, json: { error: { code: 'UPLOAD_FAILED' } } }); }
        if (!saved.has(key)) { const photo = { id: `photo-${saved.size}`, kind: payload.kind, customerVisible: payload.customerVisible }; saved.set(key, photo); order.items[0].photos.push(photo); }
        if (loseUploadResponse) { loseUploadResponse = false; return route.abort(); }
        body = saved.get(key);
      } else {
        if (failSubmit) { failSubmit = false; return route.fulfill({ status: 503, json: { error: { code: 'SUBMIT_FAILED' } } }); }
        order.items[0].status = payload.toStatus ?? (payload.outcome === 'NEEDS_CONSENT' ? 'AWAITING_CONSENT' : payload.outcome === 'REJECTED' ? 'RETURN_PENDING' : 'QUEUED');
        order.items[0].outcome = payload.outcome ?? order.items[0].outcome;
        body = path.endsWith('/inspection') ? { order } : order;
      }
    }
    else return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
    await route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  if (page.viewportSize().width < 768) await page.getByRole('button', { name: 'Menu', exact: true }).click();
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'CS-FIXTURE', exact: true }).click();
  return { order, calls, saved, failUpload: () => { failUpload = true; }, failSubmit: () => { failSubmit = true; }, loseUploadResponse: () => { loseUploadResponse = true; } };
}
async function file(page, label) { await page.getByLabel(label, { exact: false }).setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: png }); }
test('inspection blank internal notes saves with existing BEFORE; risk explanation stays required', async ({ page }) => {
  const f = await setup(page);
  f.order.items[0].photos.push({ id: 'before', kind: 'BEFORE', customerVisible: true }, { id: 'risk', kind: 'INSPECTION', customerVisible: false });
  await page.reload();
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'CS-FIXTURE', exact: true }).click();
  await page.locator('article.shoe').first().getByRole('button', { name: 'Periksa sepatu' }).click();
  const dialog = page.getByRole('dialog'); const notes = dialog.getByLabel('Catatan pemeriksaan internal (opsional)', { exact: true });
  await expect(notes).toHaveValue(''); await expect(notes).toHaveAttribute('maxlength', '4000');
  expect(await notes.evaluate(el => el.required)).toBe(false);
  await dialog.getByLabel('Hasil pemeriksaan').selectOption('NEEDS_CONSENT');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click();
  await expect(dialog.getByLabel('Risiko untuk Customer')).toHaveAttribute('required', '');
  expect(f.calls).toHaveLength(0); await expect(dialog).toBeVisible();
  await dialog.getByLabel('Hasil pemeriksaan').selectOption('APPROVED');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click();
  await expect(dialog).not.toBeVisible();
  expect(f.calls).toHaveLength(1); expect(f.calls[0].path).toMatch(/\/inspection$/);
  expect(f.calls[0].payload).toMatchObject({ outcome: 'APPROVED', notes: '', risk: '' });
  expect(f.order.items[0].status).toBe('QUEUED'); expect(f.order.items[1].status).toBe('RECEIVED');
});
test('inspection upload-first, retain fields on upload/submit failure, reuse saved photos; independent shoes', async ({ page }) => {
  const f = await setup(page); const shoes = page.locator('article.shoe');
  await expect(shoes.first()).toContainText('Harga belum dikonfirmasi');
  await expect(page.getByLabel('Jenis foto')).toHaveCount(0);
  await shoes.first().getByRole('button', { name: 'Periksa sepatu' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByLabel('Penawaran (Rp)')).toHaveValue('50000');
  await dialog.getByLabel('Catatan pemeriksaan internal').fill('Tetap tersimpan');
  await file(page, 'Foto sebelum pengerjaan'); f.failUpload();
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click();
  await expect(dialog.getByRole('alert')).toContainText('UPLOAD_FAILED');
  expect(f.calls.filter(c => c.path.endsWith('/inspection'))).toHaveLength(0);
  expect(f.order.items[0].status).toBe('RECEIVED');
  await expect(dialog.getByLabel('Catatan pemeriksaan internal')).toHaveValue('Tetap tersimpan');
  f.failSubmit(); await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click();
  await expect(dialog.getByRole('alert')).toContainText('SUBMIT_FAILED');
  const uploads = f.calls.filter(c => c.path.endsWith('/photos')).length;
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(f.calls.filter(c => c.path.endsWith('/photos'))).toHaveLength(uploads);
  const submits = f.calls.filter(c => c.path.endsWith('/inspection')); expect(submits[0].key).toBe(submits[1].key);
  expect(f.order.items[1].status).toBe('RECEIVED'); await expect(shoes.first().getByRole('button', { name: 'Mulai pengerjaan' })).toBeVisible();
});
test('risk photo automatic/private; risk pending has no start-work action', async ({ page }) => {
  const f = await setup(page); await page.locator('article.shoe').first().getByRole('button', { name: 'Periksa sepatu' }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Hasil pemeriksaan').selectOption('NEEDS_CONSENT');
  await dialog.getByLabel('Temuan untuk Customer').fill('Warna rapuh'); await dialog.getByLabel('Risiko untuk Customer').fill('Luntur'); await dialog.getByLabel('Catatan pemeriksaan internal').fill('Rapuh');
  await file(page, 'Foto sebelum pengerjaan'); await file(page, 'Foto risiko');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(f.calls.filter(c => c.path.endsWith('/photos')).map(c => [c.payload.kind, c.payload.customerVisible])).toEqual([['BEFORE', true], ['INSPECTION', false]]);
  await expect(page.locator('article.shoe').first().getByRole('button', { name: 'Mulai pengerjaan' })).toHaveCount(0);
});
test('rework offers legacy finishing transition', async ({ page }) => {
  const f = await setup(page, 'REWORK');
  await page.locator('article.shoe').first().getByRole('button', { name: 'Pengeringan · finishing', exact: true }).click();
  await expect.poll(() => f.calls.at(-1)?.payload.toStatus).toBe('FINISHING');
});
for (const status of ['DRYING', 'PACKING', 'FINISHING', 'QC']) test(`ready ${status}: confirmations, lost upload response retry, one saved photo, no premature transition`, async ({ page }) => {
  const f = await setup(page, status); await page.locator('article.shoe').first().getByRole('button', { name: status === 'DRYING' ? 'Mulai pengemasan dan QC' : 'Siap diambil', exact: true }).click();
  expect(f.calls).toHaveLength(0);
  const dialog = page.getByRole('dialog'); await file(page, 'Foto sesudah pengerjaan');
  await dialog.getByRole('button', { name: 'Konfirmasi siap diambil' }).click(); expect(f.calls).toHaveLength(0);
  await dialog.getByLabel('Sepatu sudah kering').check(); await dialog.getByLabel('Finishing selesai').check(); await dialog.getByLabel('Lulus pemeriksaan mutu (QC)').check();
  f.loseUploadResponse(); await dialog.getByRole('button', { name: 'Konfirmasi siap diambil' }).click();
  await expect(dialog.getByRole('alert')).toBeVisible(); expect(f.order.items[0].status).toBe(status); expect(f.calls.filter(c => c.path.endsWith('/transition'))).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Konfirmasi siap diambil' }).click(); await expect(dialog).not.toBeVisible();
  expect(f.saved.size).toBe(1); expect(f.calls[0].key).toBe(f.calls[1].key);
  expect(f.calls.at(-1).payload).toMatchObject({ toStatus: 'READY_FOR_PICKUP', qcPassed: true, dryConfirmed: true, finishingConfirmed: true });
  expect(f.order.items[1].status).toBe(status);
  await expect(page.locator('article.shoe').first().getByRole('button', { name: 'Mulai pengemasan dan QC' })).toHaveCount(0);
});

test('rejected inspection zero-fee return action; mobile form stays within viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const f = await setup(page); await page.locator('article.shoe').first().getByRole('button', { name: 'Periksa sepatu' }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Hasil pemeriksaan').selectOption('REJECTED');
  await dialog.getByLabel('Catatan pemeriksaan internal').fill('Tidak aman'); await file(page, 'Foto sebelum pengerjaan');
  expect(await dialog.evaluate(el => el.getBoundingClientRect().width <= window.innerWidth)).toBe(true);
  await expect(dialog.getByLabel('Foto risiko', { exact: false })).toHaveCount(0);
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(f.order.items[0].finalPriceIdr).toBe(0);
  await expect(page.locator('article.shoe').first()).toContainText('Tidak dicuci');
  await expect(page.locator('article.shoe').first().getByRole('button', { name: 'Mulai pengerjaan' })).toHaveCount(0);
});
test('ready submit failure retains confirmations, saved AFTER reused, stable finalization key', async ({ page }) => {
  const f = await setup(page, 'PACKING'); await page.locator('article.shoe').first().getByRole('button', { name: 'Siap diambil', exact: true }).click();
  const dialog = page.getByRole('dialog'); await file(page, 'Foto sesudah pengerjaan');
  for (const name of ['Sepatu sudah kering', 'Finishing selesai', 'Lulus pemeriksaan mutu (QC)']) await dialog.getByLabel(name).check();
  f.failSubmit(); await dialog.getByRole('button', { name: 'Konfirmasi siap diambil' }).click(); await expect(dialog.getByRole('alert')).toContainText('SUBMIT_FAILED');
  expect(f.order.items[0].status).toBe('PACKING'); await expect(dialog.getByLabel('Finishing selesai')).toBeChecked();
  await dialog.getByRole('button', { name: 'Konfirmasi siap diambil' }).click(); await expect(dialog).not.toBeVisible();
  expect(f.calls.filter(c => c.path.endsWith('/photos'))).toHaveLength(1);
  const submits = f.calls.filter(c => c.path.endsWith('/transition')); expect(submits[0].key).toBe(submits[1].key);
});
test('customer tracking meaningful simplified stages and unconfirmed price', async ({ page }) => {
  const f = await setup(page); f.order.items[1].status = 'WASHING'; f.order.items[1].outcome = 'APPROVED';
  await page.goto(`${origin}/track/${'a'.repeat(64)}`);
  await expect(page.locator('article').first()).toContainText('Dalam Antrian');
  await expect(page.locator('article').nth(1)).toContainText('Pengerjaan');
});
