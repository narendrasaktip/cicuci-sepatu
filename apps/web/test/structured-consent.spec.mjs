import process from 'node:process';
import { Buffer } from 'node:buffer';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const token = 'b'.repeat(64);
function fixture() {
  const item = { id: 'shoe', serviceId: 'service', serviceName: 'Cuci', brand: 'Nike', model: '', color: '', status: 'RECEIVED', outcome: null, quotedPriceIdr: 50000, finalPriceIdr: 0, photos: [{ id: 'before', kind: 'BEFORE', customerVisible: true }], consents: [], history: [], timeline: [] };
  return { id: 'order', number: 'CS-STRUCTURED', createdAt: '2026-11-11T03:00:00Z', customer: { name: 'Fixture', whatsapp: 'optout' }, estimatedCompletionAt: '2026-12-01T00:00:00Z', aggregateStatus: 'WAITING_INSPECTION', totalIdr: 50000, paidIdr: 0, balanceIdr: 50000, paymentStatus: 'UNPAID', items: [item], payments: [] };
}
async function setup(page) {
  const state = { order: fixture(), posts: [], uploads: [], unexpected: [], errors: [], capability: true, capabilityStatus: 200, postStatus: 200 };
  page.on('pageerror', e => state.errors.push(e.message));
  await page.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname, method = request.method();
    const get = method === 'GET';
    if (get && path === '/api/v1/auth/me') return route.fulfill({ json: { user: { id: 'owner', name: 'Fixture', role: 'OWNER' }, csrfToken: 'fixture' } });
    if (get && path === '/api/v1/display-settings') return route.fulfill({ json: { statusLabels: {} } });
    if (get && path === '/api/v1/dashboard') return route.fulfill({ json: {} });
    if (get && path === '/api/v1/orders') return route.fulfill({ json: { data: [state.order], page: { nextCursor: null } } });
    if (get && ['/api/v1/services', '/api/v1/users'].includes(path)) return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
    if (get && [ '/api/v1/orders/order', '/api/v1/orders/order/tracking-token', `/api/v1/track/${token}` ].includes(path)) return route.fulfill({ json: state.order });
    if (get && path === '/api/v1/settings/inspection-capabilities') {
      if (state.capabilityStatus === 0) return route.abort('failed');
      return route.fulfill({ status: state.capabilityStatus, json: state.capabilityStatus === 200 ? { structuredRiskConsent: state.capability } : { error: { code: state.capabilityStatus === 404 ? 'NOT_FOUND' : state.capabilityStatus === 403 ? 'FORBIDDEN' : 'INTERNAL_ERROR' } } });
    }
    if (method === 'POST' && path === '/api/v1/items/shoe/photos') {
      state.uploads.push(request.postDataJSON()); return route.fulfill({ json: { id: 'uploaded' } });
    }
    if (method === 'POST' && path === '/api/v1/items/shoe/inspection') {
      const body = request.postDataJSON(); state.posts.push(body); Object.assign(state.order.items[0], { status: 'AWAITING_CONSENT', outcome: body.outcome, inspection: body });
      return route.fulfill({ json: { order: state.order } });
    }
    if (method === 'POST' && path === `/api/v1/track/${token}/consent`) {
      const body = request.postDataJSON(); state.posts.push(body);
      if (state.postStatus !== 200) return route.fulfill({ status: state.postStatus, json: { error: { code: 'TOKEN_EXPIRED' } } });
      expect(body).toEqual({ itemId: 'shoe', decision: body.decision }); Object.assign(state.order.items[0], { status: body.decision === 'APPROVE' ? 'QUEUED' : 'RETURN_PENDING' }); state.order.items[0].consents[0].decision = body.decision;
      return route.fulfill({ json: { decision: body.decision } });
    }
    state.unexpected.push(`${method} ${path}`); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  return state;
}
function clean(state) { expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]); }
async function inspection(page) {
  await page.goto(`${origin}/admin`);
  await page.getByRole('navigation').getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'CS-STRUCTURED', exact: true }).click();
  await page.locator('article.shoe').first().getByRole('button', { name: 'Periksa sepatu' }).click();
  const dialog = page.getByRole('dialog'); await dialog.getByLabel('Hasil pemeriksaan').selectOption('NEEDS_CONSENT'); return dialog;
}
for (const note of ['', 'Coba cuci semaksimal atas/bawah lebih bersih']) test(`separate inspection fields; optional customer note ${!!note}`, async ({ page }) => {
  const state = await setup(page), dialog = await inspection(page);
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); expect(state.posts).toHaveLength(0);
  await dialog.getByLabel('Temuan untuk Customer').fill('   '); await dialog.getByLabel('Risiko untuk Customer').fill('   ');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog.getByRole('alert')).toContainText('minimal 3 karakter'); expect(state.posts).toHaveLength(0);
  await dialog.getByLabel('Temuan untuk Customer').fill('  Bagian atas kelupas/debu menempel  ');
  await dialog.getByLabel('Risiko untuk Customer').fill('Tidak akan bersih/tak bisa dihapus');
  await dialog.getByLabel('Catatan untuk Customer (Opsional)').fill(note);
  await dialog.getByLabel('Catatan pemeriksaan internal (opsional)').fill('PRIVATE_INTERNAL');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(state.posts).toEqual([{ outcome: 'NEEDS_CONSENT', findings: 'Bagian atas kelupas/debu menempel', risk: 'Tidak akan bersih/tak bisa dihapus', customerNote: note, notes: 'PRIVATE_INTERNAL', quotedPriceIdr: 50000 }]); clean(state);
});
test('old API capability blocks submission; fields retained, actionable activation message', async ({ page }) => {
  const state = await setup(page); state.capabilityStatus = 404; state.order.items[0].photos = []; const dialog = await inspection(page);
  await expect(dialog.getByRole('alert')).toContainText('Deployment diperlukan');
  await dialog.getByLabel('Foto sebelum pengerjaan').setInputFiles(image);
  await dialog.getByLabel('Foto risiko').setInputFiles(image);
  await dialog.getByLabel('Temuan untuk Customer').fill('Atas kelupas'); await dialog.getByLabel('Risiko untuk Customer').fill('Tidak bersih');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog.getByRole('alert')).toContainText('migrasi dan aktivasi API baru');
  expect(state.posts).toHaveLength(0); expect(state.uploads).toHaveLength(0);
  await expect(dialog.getByLabel('Temuan untuk Customer')).toHaveValue('Atas kelupas');
  await expect(dialog.getByLabel('Risiko untuk Customer')).toHaveValue('Tidak bersih');
  expect(await dialog.getByLabel('Foto risiko').evaluate(el => el.files[0].name)).toBe(image.name); clean(state);
});
const image = { name: 'risk.png', mimeType: 'image/png', buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64') };
test('optional supplied risk photo stays private; BEFORE remains required', async ({ page }) => {
  const state = await setup(page); state.order.items[0].photos = []; const dialog = await inspection(page);
  await dialog.getByLabel('Temuan untuk Customer').fill('Atas kelupas'); await dialog.getByLabel('Risiko untuk Customer').fill('Tidak bersih');
  await expect(dialog.getByLabel('Foto risiko')).not.toHaveAttribute('required', '');
  await dialog.getByLabel('Foto risiko').setInputFiles(image);
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); expect(state.uploads).toHaveLength(0); expect(state.posts).toHaveLength(0);
  await dialog.getByLabel('Foto sebelum pengerjaan').setInputFiles(image);
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(state.uploads.map(({ kind, customerVisible }) => ({ kind, customerVisible }))).toEqual([{ kind: 'BEFORE', customerVisible: true }, { kind: 'INSPECTION', customerVisible: false }]);
  expect(state.posts).toHaveLength(1); clean(state);
});
for (const status of [200, 403, 500, 0]) test(`capability unavailable ${status}; truthful warning, no mutation, retry preserves fields`, async ({ page }) => {
  const state = await setup(page); state.capability = false; state.capabilityStatus = status; const dialog = await inspection(page);
  await expect(dialog.getByRole('alert')).toContainText(status === 200 ? 'Deployment diperlukan' : 'Gagal memeriksa dukungan inspeksi');
  if (status !== 200) await expect(dialog.getByRole('alert')).not.toContainText('Deployment diperlukan');
  await dialog.getByLabel('Temuan untuk Customer').fill('Atas kelupas'); await dialog.getByLabel('Risiko untuk Customer').fill('Tidak bersih');
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click();
  await expect(dialog.getByRole('button', { name: 'Simpan pemeriksaan' })).toBeEnabled();
  expect(state.posts).toHaveLength(0); expect(state.uploads).toHaveLength(0);
  state.capability = true; state.capabilityStatus = 200;
  await dialog.getByRole('button', { name: 'Simpan pemeriksaan' }).click(); await expect(dialog).not.toBeVisible();
  expect(state.posts[0].findings).toBe('Atas kelupas'); expect(state.posts[0].risk).toBe('Tidak bersih'); clean(state);
});
function pending(state, { legacy = false, note = 'Coba semaksimal mungkin', expired = false } = {}) {
  const findings = 'Atas <img src=x onerror=alert(1)> kelupas', risk = 'Tak bisa dihapus <script>alert(1)</script>';
  Object.assign(state.order.items[0], { status: 'AWAITING_CONSENT', outcome: 'NEEDS_CONSENT', findings: legacy ? null : findings, risk, customerNote: note, photos: [], inspection: { notes: 'PRIVATE_INTERNAL' }, consents: [{ id: 'consent', findings: legacy ? null : findings, risk, customerNote: legacy ? null : note, quotedPriceIdr: 50000, expiresAt: '2026-12-01T00:00:00Z', decision: null, expired }] });
}
async function consentOrder(card, labels) {
  for (const record of await card.locator('.records > li').all()) {
    await expect(record.locator('strong')).toHaveText([...labels, 'Batas Konfirmasi']);
    await expect(record.locator(':scope > p').last().locator('span')).not.toBeEmpty();
  }
  const order = await card.evaluate(node => {
    const fields = [...node.querySelectorAll('.consent-intro, .records > li > p, .consent-footer')];
    return fields.slice(1).map((field, i) => ({
      follows: !!(fields[i].compareDocumentPosition(field) & Node.DOCUMENT_POSITION_FOLLOWING),
      gap: field.getBoundingClientRect().top - fields[i].getBoundingClientRect().bottom,
    }));
  });
  expect(order.every(({ follows, gap }) => follows && gap >= 0)).toBe(true);
}
for (const note of ['', 'Coba semaksimal mungkin']) test(`public structured evidence escaped; private notes absent; optional note ${!!note}`, async ({ page }) => {
  const state = await setup(page); pending(state, { note }); await page.goto(`${origin}/track/${token}`);
  const card = page.locator('section.notice').filter({ has: page.getByRole('heading', { name: 'Menunggu Persetujuan Customer', exact: true }) });
  await expect(card).toContainText('Atas <img src=x onerror=alert(1)> kelupas'); await expect(card).toContainText('Tak bisa dihapus <script>alert(1)</script>');
  await expect(card.locator('strong', { hasText: /^Catatan dari Toko$/ })).toHaveCount(note ? 1 : 0); await expect(card.locator('img, script')).toHaveCount(0);
  await expect(card).not.toContainText('Rp'); await expect(card).not.toContainText('Penanganan'); await expect(page.locator('body')).not.toContainText('PRIVATE_INTERNAL');
  await expect(page.getByText('Risiko yang diinformasikan:', { exact: false })).toHaveCount(0);
  await consentOrder(card, ['Temuan', 'Risiko Pencucian', ...(note ? ['Catatan dari Toko'] : [])]); clean(state);
});
test('legacy description remains single original, no invented findings', async ({ page }) => {
  const state = await setup(page); pending(state, { legacy: true }); await page.goto(`${origin}/track/${token}`);
  const card = page.locator('section.notice'); await expect(card).toContainText('Deskripsi risiko (legacy)'); await expect(card.locator('strong', { hasText: /^Temuan$/ })).toHaveCount(0); await expect(card).toContainText('Tak bisa dihapus');
  await consentOrder(card, ['Deskripsi risiko (legacy)']); clean(state);
});
for (const decision of ['APPROVE', 'DECLINE']) test(`public consent ${decision} explicit confirmation`, async ({ page }) => {
  const state = await setup(page); pending(state); await page.goto(`${origin}/track/${token}`);
  await page.getByRole('button', { name: decision === 'APPROVE' ? 'Setujui Risiko & Lanjutkan' : 'Tolak Pencucian', exact: true }).click(); expect(state.posts).toHaveLength(0);
  await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  expect(state.posts).toEqual([{ itemId: 'shoe', decision }]);
  if (decision === 'DECLINE') await expect(page.locator('article.panel').first().locator('.badge')).toHaveText('Tidak Dicuci');
  clean(state);
});
test('staff rejection identifies store in return timeline', async ({ page }) => {
  const state = await setup(page), item = state.order.items[0];
  Object.assign(item, { status: 'RETURN_PENDING', outcome: 'REJECTED', timeline: [{ status: 'RECEIVED', at: '2026-11-11T03:00:00Z' }, { status: 'RETURN_PENDING', at: '2026-11-12T03:00:00Z' }] });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.timeline li').last()).toContainText('Pencucian Ditolak oleh Toko'); clean(state);
});
test('expired consent hides actions; expiry race rejected without success', async ({ page }) => {
  const state = await setup(page); pending(state, { expired: true }); await page.goto(`${origin}/track/${token}`);
  await expect(page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toHaveCount(0); await expect(page.locator('section.notice')).toContainText('Persetujuan sudah kedaluwarsa.');
  pending(state); state.postStatus = 410; await page.goto('about:blank'); await page.goto(`${origin}/track/${token}`);
  await page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true }).click(); await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('kedaluwarsa'); await expect(page.locator('body')).not.toContainText('Keputusan tersimpan'); clean(state);
});

for (const width of [320, 1440]) for (const mode of ['missing', 'wrong-item', 'actionable', 'expired', 'decided', 'reissued']) test(`consent copy spacing ${mode} ${width}`, async ({ page }) => {
  const state = await setup(page); pending(state, { note: width === 320 ? '   ' : 'Catatan asli\nBaris kedua', expired: mode === 'expired' });
  const item = state.order.items[0], entry = item.consents[0];
  entry.expiresAt = '2026-11-14T06:27:00Z';
  item.timeline = [{ status: 'RECEIVED', at: '2026-11-11T03:00:00Z' }, { status: 'AWAITING_CONSENT', at: '2026-11-12T03:00:00Z' }];
  state.order.statusLabels = { 'history.RECEIVED': 'Diterima sesuai label toko' };
  if (mode === 'decided') entry.decision = 'DECLINE';
  if (mode === 'reissued') item.consents.unshift({ ...entry, id: 'old', decision: 'REISSUED', expired: true });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  const card = page.locator('section.notice'), actionable = !['expired', 'decided'].includes(mode);
  await expect(card.locator('h3')).toHaveText('Menunggu Persetujuan Customer');
  await expect(card.locator('.consent-intro')).toHaveText('Pencucian dilanjutkan setelah Anda menyetujui risiko berikut.');
  await expect(card.locator('.records > li').last().locator('p').last().locator('span')).toHaveText('Sabtu, 14 November 2026 | 13:27 WIB.');
  await consentOrder(card, ['Temuan', 'Risiko Pencucian', ...(width === 320 ? [] : ['Catatan dari Toko'])]);
  if (width === 1440) await expect(card.locator('.records > li').last().locator('.preserve').filter({ has: page.locator('strong', { hasText: /^Catatan dari Toko$/ }) }).locator('span')).toHaveText('Catatan asli\nBaris kedua');
  await expect(card).not.toContainText('Menunggu Keputusan');
  await expect(card).not.toContainText('Rp'); await expect(card).not.toContainText('Penanganan');
  await expect(card.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toHaveCount(actionable ? 1 : 0);
  await expect(card.getByRole('button', { name: 'Tolak Pencucian', exact: true })).toHaveCount(actionable ? 1 : 0);
  if (actionable) {
    await expect(card.locator('.consent-footer')).toContainText('Dengan menyetujui, Anda menerima risiko pencucian di atas. Menolak berarti sepatu dikembalikan tanpa biaya cuci.');
    await expect(card).not.toContainText('Untuk memberikan keputusan');
  } else await expect(card.locator('.consent-footer')).toHaveText(mode === 'expired' ? 'Persetujuan sudah kedaluwarsa. Hubungi toko. Pencucian tetap menunggu persetujuan Anda.' : 'Keputusan sudah tersimpan.');
  if (mode !== 'expired') await expect(card).not.toContainText('kedaluwarsa');
  if (mode === 'reissued') await expect(card).toContainText('Tautan Diganti');
  if (mode === 'decided') await expect(card.locator('.records > li > p').first()).toHaveText('Tidak Setuju');
  const gaps = await card.evaluate(node => {
    const box = selector => node.querySelector(selector).getBoundingClientRect();
    const fields = [...node.querySelector('.records > li:last-child').children];
    return {
      titleIntro: box('.consent-intro').top - box('h3').bottom,
      introDetails: box('.records').top - box('.consent-intro').bottom,
      sections: fields.slice(1).map((field, i) => field.getBoundingClientRect().top - fields[i].getBoundingClientRect().bottom),
      labelValues: [...node.querySelectorAll('.preserve')].map(field => field.querySelector('span').getBoundingClientRect().top - field.querySelector('strong').getBoundingClientRect().bottom),
      divider: box('.consent-footer').top - box('.records').bottom,
      footer: parseFloat(getComputedStyle(node.querySelector('.consent-footer')).paddingTop),
    };
  });
  expect(gaps.titleIntro).toBe(8); expect(gaps.introDetails).toBe(12);
  expect(gaps.sections.every(gap => gap === 12)).toBe(true); expect(gaps.labelValues.every(gap => gap === 4)).toBe(true);
  expect(gaps.divider).toBe(12); expect(gaps.footer).toBe(12);
  await expect(page.locator('.timeline li')).toHaveCount(2);
  await expect(page.locator('.timeline li').first().locator('strong')).toHaveText('Diterima sesuai label toko');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(state.posts).toEqual([]); clean(state);
});
