import process from 'node:process';
import { test, expect } from '@playwright/test';
test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const defaults = { 'admin.RECEIVED': 'Pemeriksaan', 'order.READY_FOR_PICKUP': 'Siap Diambil', 'shoe.READY_FOR_PICKUP': 'Selesai Dicuci', 'history.READY_FOR_PICKUP': 'Selesai Dikerjakan' };

const stageDefaults = ['RECEIVED', 'QUEUED', 'WASHING', 'DRYING', 'READY_FOR_PICKUP'].map((anchor, index) => ({ id: `builtin.${anchor}`, anchor, name: ['Sepatu Diterima', 'Pemeriksaan Selesai', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', 'Selesai Dikerjakan'][index], visible: true }));
for (const legacy of [false, true, 'unavailable']) test(`settings preserve tracking configuration, legacy API ${legacy}`, async ({ page, context }) => {
  let saved = { name: 'Cicuci Sepatu', pickupInstructions: '', consentHours: 48, publicOrigin: 'http://127.0.0.1:5173', ...(legacy ? {} : { trackingStages: [stageDefaults[4], { id: 'custom.existing', anchor: 'DRYING', name: 'Tersimpan', visible: false }], trackingStagesVersion: 1 }) };
  let role = 'OWNER', fail = false; const unexpected = [], writes = [];
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', ''); let body;
    if (path === '/auth/me' && req.method() === 'GET') body = { user: { id: 'owner', name: 'Owner', role }, csrfToken: 'fixture' };
    else if (path === '/display-settings' && req.method() === 'GET') body = { statusLabels: defaults };
    else if (path === '/dashboard' && req.method() === 'GET') body = {};
    else if (path === '/orders' && req.method() === 'GET') body = { data: [], page: { nextCursor: null } };
    else if (path === '/settings' && req.method() === 'GET') { if (legacy === 'unavailable') return route.fulfill({ status: 500, json: { error: { code: 'REQUEST_INTERNAL_ERROR' } } }); body = saved; }
    else if (path === '/settings' && req.method() === 'PATCH') {
      writes.push(req.postDataJSON());
      if (fail) return route.fulfill({ status: 400, json: { error: { code: 'VALIDATION_ERROR' } } });
      saved = { ...saved, ...req.postDataJSON() }; body = saved;
    } else unexpected.push(req.method() + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.getByRole('button', { name: 'Menu', exact: true }).click(); await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expect(page.getByText('Tahap Pengerjaan Pelanggan')).toHaveCount(0);
  await expect(page.locator('.stage-editor')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Tambah tahap tampilan' })).toHaveCount(0);
  if (legacy) {
    await expect(page.getByRole('status').filter({ hasText: 'perlu aktivasi' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Simpan pengaturan', exact: true })).toBeDisabled();
    expect(writes).toHaveLength(0); expect(unexpected).toEqual([]); return;
  }
  await page.getByLabel('Domain website publik').fill('https://tracking.example/');
  await page.getByLabel('Nama toko').fill('Toko baru');
  // Simulate another session changing stages after this form loaded.
  saved.trackingStages = [{ id: 'custom.concurrent', anchor: 'WASHING', name: 'Perubahan lain', visible: false }];
  const concurrentStages = structuredClone(saved.trackingStages);
  await page.getByRole('button', { name: 'Simpan pengaturan', exact: true }).click(); fail = true;
  await page.getByRole('dialog').getByRole('button', { name: /Simpan|Konfirmasi/ }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('VALIDATION_ERROR');
  fail = false; await page.getByRole('dialog').getByRole('button', { name: /Simpan|Konfirmasi/ }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  expect(writes).toHaveLength(2);
  expect(writes[1].trackingStages).toBeUndefined(); expect(writes[1].statusLabels).toBeUndefined();
  expect(saved.trackingStages).toEqual(concurrentStages);
  await page.reload(); await page.getByRole('button', { name: 'Menu', exact: true }).click(); await page.getByRole('button', { name: 'Pengaturan', exact: true }).click();
  await expect(page.getByLabel('Nama toko')).toHaveValue('Toko baru');
  await expect(page.getByLabel('Domain website publik')).toHaveValue('https://tracking.example/');
  await expect(page.locator('.stage-editor')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  role = 'STAFF'; await page.reload(); await expect(page.getByRole('button', { name: 'Pengaturan', exact: true })).toHaveCount(0);
  expect(unexpected).toEqual([]);
});

test('manual sharing reuses server link, rotates only explicitly, then revokes', async ({ page, context }) => {
  const shortToken = 'short_tracking_token_01'; const unexpected = []; let origin = 'https://tracking.example', current = shortToken;
  const order = () => ({ id: 'fixture', publicOrigin: origin, number: 'FIXTURE', createdAt: '2026-11-11T01:00:00Z', estimatedCompletionAt: '2026-11-15T16:59:59Z', aggregateStatus: 'RECEIVED', customer: { name: 'Fixture', whatsapp: '628123456789' }, pickupInstructions: '', items: [], payments: [], totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID' });
  await context.route('**/api/**', async route => {
    const req = route.request(), path = new URL(req.url()).pathname.replace('/api/v1', ''); let body;
    if (path === '/auth/me') return route.fulfill({ status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
    if (path === '/orders/fixture' && req.method() === 'GET') body = order();
    else if ((path.startsWith('/services?') || path === '/services' || path === '/users') && req.method() === 'GET') body = { data: [] };
    else if (path === '/orders/fixture/tracking-token' && req.method() === 'GET') body = { trackingToken: current, publicOrigin: origin };
    else if (path === '/orders/fixture/tracking-token/rotate' && req.method() === 'POST') { origin = 'https://new.example'; current = 'short_tracking_token_02'; body = { trackingToken: current, publicOrigin: origin }; }
    else if (path === '/orders/fixture/tracking-token/revoke' && req.method() === 'POST') { current = ''; body = {}; }
    else unexpected.push(req.method() + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.goto(`${process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173'}/admin`);
  await page.evaluate(async () => {
    const source = await (await fetch('/src/main.ts')).text();
    const vuePath = source.match(/from ["']([^"']*\/vue[^"']*)["']/)[1];
    const { createApp } = await import(vuePath);
    const { default: component } = await import('/src/components/OrderDetail.vue');
    const root = document.createElement('div'); document.body.append(root);
    createApp(component, { id: 'fixture', user: { id: 'owner', name: 'Owner', role: 'OWNER' } }).mount(root);
  });
  await expect(page.locator('#secure-link')).toHaveValue(`https://tracking.example/track/${shortToken}`);
  await expect(page.getByRole('button', { name: 'Buat tautan', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Rotasi tautan', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.locator('#secure-link')).toHaveValue('https://new.example/track/short_tracking_token_02');
  await page.getByRole('button', { name: 'Cabut tautan', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.locator('#secure-link')).toHaveCount(0);
  const link = await page.evaluate(async () => (await import('/src/services/domain.ts')).trackingUrl('tracking', '', '', 'https://new.example'));
  expect(link).toBe('https://new.example/track/tracking');
  expect(unexpected).toEqual([]);
});

for (const custom of [false, 'legacy', true]) test(`tracking contextual labels, fallback, literal text ${custom}`, async ({ page, context }) => {
  const unexpected = [], statusLabels = custom === true ? { ...defaults, 'order.READY_FOR_PICKUP': 'Pesanan tersedia', 'shoe.READY_FOR_PICKUP': 'Bersih <literal>', 'history.READY_FOR_PICKUP': 'Pekerjaan rampung' } : custom === 'legacy' ? defaults : undefined;
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET' || !path.startsWith('/api/v1/track/')) { unexpected.push(path); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED' } } }); }
    await route.fulfill({ json: { statusLabels, number: 'FIXTURE', createdAt: '2026-11-11T01:00:00Z', estimatedCompletionAt: '2026-11-15T16:59:59Z', aggregateStatus: 'READY_FOR_PICKUP', pickupInstructions: '', totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', items: [{ id: 'shoe', brand: 'Fixture', model: '', color: '', serviceName: 'Cuci', status: 'READY_FOR_PICKUP', outcome: 'APPROVED', quotedPriceIdr: 50000, finalPriceIdr: 50000, consents: [], photos: [], timeline: [{ status: 'READY_FOR_PICKUP', at: '2026-11-12T01:00:00Z' }] }] } });
  });
  await page.goto('http://127.0.0.1:5173/track/' + 'a'.repeat(64));
  await expect(page.getByLabel('Status Pesanan', { exact: true })).toHaveText('Selesai Dikerjakan');
  await expect(page.locator('article .badge')).toHaveText(custom === true ? 'Bersih <literal>' : 'Selesai Dikerjakan');
  await expect(page.locator('.timeline li strong')).toHaveText([custom === true ? 'Pekerjaan rampung' : 'Selesai Dikerjakan']);
  expect(unexpected).toEqual([]);
});

for (const width of [320, 1440]) test(`simple public history preserves actual and legacy events ${width}`, async ({ page, context }) => {
  const unexpected = [];
  const trackingStages = [stageDefaults[4], { id: 'custom.reached', anchor: 'WASHING', name: 'Informasi Pencucian', visible: true }, { id: 'custom.future', anchor: 'DRYING', name: 'Informasi Pengeringan', visible: true }];
  const timeline = ['RECEIVED', 'AWAITING_CONSENT', 'WASHING', 'FINISHING', 'QC', 'REWORK', 'WASHING'].map((status, index) => ({ status, at: `2026-11-10T0${index + 1}:00:00Z` }));
  await context.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (route.request().method() !== 'GET' || !path.startsWith('/api/v1/track/')) { unexpected.push(path); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED' } } }); }
    await route.fulfill({ json: { trackingStages, number: 'FIXTURE', createdAt: timeline[0].at, estimatedCompletionAt: '2026-11-15T16:59:59Z', aggregateStatus: 'WASHING', pickupInstructions: '', totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', items: [{ id: 'shoe', brand: 'Fixture', model: '', color: '', serviceName: 'Cuci', status: 'WASHING', outcome: 'APPROVED', quotedPriceIdr: 50000, finalPriceIdr: 50000, consents: [], photos: [], timeline }] } });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5173/track/' + 'a'.repeat(64));
  await expect(page.getByRole('heading', { name: 'Riwayat Pengerjaan', exact: true })).toHaveCount(1);
  await expect(page.locator('.shoe-history ol')).toHaveCount(1);
  await expect(page.locator('.display-stages')).toHaveCount(0);
  await expect(page.locator('body')).not.toContainText(/Tahap Pengerjaan Pelanggan|Urutan tampilan, bukan kronologi|Kejadian nyata, kronologis|Tidak berubah saat tahap tampilan|Kejadian acuan tercatat|Belum tercatat|Acuan belum tercatat|Informasi Pencucian|Informasi Pengeringan/);
  await expect(page.locator('.timeline li strong')).toHaveText(['Sepatu Diterima', 'Menunggu Persetujuan Customer', 'Dalam Proses Pencucian', 'Pengeringan · Finishing', 'Pengeringan · Pemeriksaan Mutu', 'Pengerjaan Ulang', 'Dalam Proses Pencucian']);
  await expect(page.locator('.timeline time')).toHaveText(timeline.map((_, index) => `Selasa, 10 November 2026 | ${String(index + 8).padStart(2, '0')}:00 WIB.`));
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]);
});
