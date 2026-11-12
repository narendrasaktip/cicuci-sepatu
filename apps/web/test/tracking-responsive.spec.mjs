import { test, expect } from '@playwright/test';

// Standalone: no setup imports, real API calls, stored sessions or service workers.
test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = 'http://127.0.0.1:5173';
const token = 'tracking-fixture-only';
const approval = 'a'.repeat(64);
const endpoint = `/api/v1/track/${token}`;
const photo = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400"><rect width="600" height="400" fill="#dce3ec"/><text x="180" y="210" font-size="32" fill="#182c49">Foto sepatu uji</text></svg>');
function fixture() {
  const item = { id: 'shoe-fixture', brand: 'MerekSepatuSangatPanjangTanpaSpasi'.repeat(3), model: 'Model pelanggan dengan nama panjang', color: 'Biru', serviceName: 'Pembersihan menyeluruh', status: 'AWAITING_CONSENT', outcome: 'NEEDS_CONSENT', quotedPriceIdr: 45000, finalPriceIdr: 0, risk: 'Warna dapat memudar. ' + 'CatatanRisikoTanpaSpasi'.repeat(12), consents: [{ id: 'consent-fixture', risk: 'Warna dapat memudar', quotedPriceIdr: 45000, expiresAt: '2099-11-13T10:00:00Z', decision: null, expired: false }], photos: [{ id: 'before', kind: 'BEFORE', path: photo }, { id: 'after', kind: 'AFTER', path: photo }], timeline: [{ status: 'RECEIVED', at: '2026-11-11T03:00:00Z' }, { status: 'AWAITING_CONSENT', at: '2026-11-11T04:00:00Z' }] };
  return { id: 'order-fixture', number: 'CC-20261111-' + '1234567890'.repeat(8), aggregateStatus: 'AWAITING_CONSENT', estimatedCompletionAt: '2026-11-16T16:59:59.999Z', pickupInstructions: 'Ambil di toko setelah konfirmasi.\n' + 'InstruksiPengambilanTanpaSpasi'.repeat(8), totalIdr: 45000, paidIdr: 60000, balanceIdr: 0, refundDueIdr: 15000, paymentStatus: 'PAID', pricing: { version: 2, name: 'TarifPanjangTanpaSpasi'.repeat(8), stage: 'FINAL', staffVerified: true, pairs: 2, initialTotalIdr: 90000, totalIdr: 45000 }, items: [item, { ...item, id: 'ready-fixture', brand: 'Sepatu siap', model: '', status: 'READY_FOR_PICKUP', outcome: 'APPROVED', finalPriceIdr: 45000, consents: [], timeline: [{ status: 'READY_FOR_PICKUP', at: '2026-11-11T05:00:00Z' }] }] };
}
async function mockApi(page) {
  const state = { order: fixture(), status: 200, gate: null, postGate: null, postStatus: 200, calls: [], unexpected: [], errors: [], posts: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const call = `${request.method()} ${path}`;
    state.calls.push(call);
    if (call === `GET ${endpoint}`) {
      if (state.gate) await state.gate;
      return route.fulfill({ status: state.status, json: state.status === 200 ? state.order : { error: { code: state.status === 410 ? 'EXPIRED' : 'NOT_FOUND' } } });
    }
    if (request.method() === 'POST' && path === endpoint + '/consent') {
      const body = request.postDataJSON();
      state.posts.push({ path, body });
      if (state.postGate) await state.postGate;
      if (state.postStatus !== 200) return route.fulfill({ status: state.postStatus, json: { error: { code: 'CONFLICT' } } });
      expect(body.approvalToken).toBe(approval);
      expect(['APPROVE', 'DECLINE']).toContain(body.decision);
      state.order.items[0].status = body.decision === 'APPROVE' ? 'QUEUED' : 'RETURN_PENDING';
      state.order.items[0].consents[0].decision = body.decision;
      if (body.decision === 'DECLINE') { state.order.items[0].outcome = 'DECLINED'; state.order.items[0].finalPriceIdr = 0; }
      return route.fulfill({ json: {} });
    }
    state.unexpected.push(call);
    return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  return state;
}
function clean(state) { expect(state.unexpected).toEqual([]); expect(state.errors).toEqual([]); expect(state.calls.some(call => call.includes('/auth/'))).toBe(false); }
async function noOverflow(page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const escaped = await page.locator('main .panel, main .badge, main .metrics > div, main .photos img, main button, main input, main select').evaluateAll(elements => elements.filter(el => { const box = el.getBoundingClientRect(); return box.width && (box.left < 0 || box.right > innerWidth + 1); }).map(el => el.tagName + '.' + el.className));
  expect(escaped).toEqual([]);
}
async function summaryLayout(page, width) {
  const panel = page.locator('.order-summary');
  await expect(panel.locator(':scope > section')).toHaveCount(2);
  const info = panel.locator('.summary-info'), payment = panel.locator('.summary-payment');
  await expect(info.getByRole('heading', { name: 'Informasi Pesanan', exact: true })).toBeVisible();
  await expect(payment.getByRole('heading', { name: 'Pembayaran', exact: true })).toBeVisible();
  await expect(info).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(payment).toHaveCSS('background-color', 'rgb(255, 255, 255)');
  await expect(panel).toHaveCSS('padding', '0px');
  await expect(panel).toHaveCSS('border-radius', '12px');
  await expect(panel.locator('.summary-total')).toHaveCount(1);
  await expect(payment.locator('.summary-rows .summary-total')).toHaveCount(0);
  await expect(payment.getByLabel('Status Pembayaran')).toBeVisible();
  const heading = payment.locator('.payment-heading');
  await expect(heading.locator(':scope > h2 + .payment-badge')).toHaveCount(1);
  await expect(heading).toHaveCSS('flex-wrap', 'wrap');
  await expect(payment.locator('.summary-total .payment-badge')).toHaveCount(0);
  const title = await heading.locator('h2').boundingBox(), badge = await heading.locator('.payment-badge').boundingBox(), total = await payment.locator('.summary-total').boundingBox();
  expect(total.y).toBeGreaterThanOrEqual(badge.y + badge.height);
  if (width >= 768) {
    expect(Math.abs(title.y + title.height / 2 - badge.y - badge.height / 2)).toBeLessThan(1);
    expect(badge.x).toBeGreaterThanOrEqual(title.x + title.width);
  }
  const headerBox = await heading.boundingBox();
  expect(Math.abs(badge.x + badge.width - headerBox.x - headerBox.width)).toBeLessThan(1);
  await expect(payment.locator('.summary-total dd')).toHaveCSS('font-size', '28px');
  for (const line of await info.locator('.progress-counts li').all()) {
    await expect(line).toHaveCSS('font-size', '14px');
    await expect(line).toHaveCSS('font-weight', '400');
  }
  for (const selector of ['.service-snapshot', '.summary-eta h3', '.progress-title']) {
    await expect(info.locator(selector)).toHaveCSS('font-size', '15px');
    await expect(info.locator(selector)).toHaveCSS('font-weight', '700');
  }
  await expect(payment.getByText('Layanan / Tarif', { exact: true })).toHaveCount(0);
  const a = await info.boundingBox(), b = await payment.boundingBox();
  if (width >= 768) {
    expect(Math.abs(a.y - b.y)).toBeLessThan(1);
    expect(Math.abs(a.height - b.height)).toBeLessThan(1);
    expect(a.width / (a.width + b.width)).toBeCloseTo(.55, 2);
    expect(Math.abs(a.x + a.width - b.x)).toBeLessThan(1);
    await expect(payment).toHaveCSS('border-left-width', '1px');
    await expect(payment).toHaveCSS('border-top-width', '0px');
  } else {
    expect(Math.abs(a.x - b.x)).toBeLessThan(1);
    expect(Math.abs(a.width - b.width)).toBeLessThan(1);
    expect(Math.abs(a.y + a.height - b.y)).toBeLessThan(1);
    await expect(payment).toHaveCSS('border-left-width', '0px');
    await expect(payment).toHaveCSS('border-top-width', '1px');
  }
  for (const row of await panel.locator('.summary-rows > div, .info-rows > div').all()) {
    await expect(row).toHaveCSS('border-top-width', await row.evaluate(el => el.classList.contains('summary-balance')) ? '1px' : '0px');
    await expect(row).toHaveCSS('border-bottom-width', '0px');
  }
}
for (const width of [320, 360, 390, 768, 1440]) {
  test(`tracking white responsive ${width}`, async ({ page }, testInfo) => {
    const state = await mockApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/track/${token}#approval=${approval}&item=shoe-fixture`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tracking Pesanan');
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.getByText('Tautan ini bersifat rahasia.', { exact: false })).toHaveCount(0);
    await expect(page.locator('.tracking-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.locator('main')).toHaveCSS('display', 'block');
    await expect(page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toHaveCSS('background-color', 'rgb(23, 104, 186)');
    const logo = page.getByRole('img', { name: 'Cicuci Sepatu', exact: true });
    await expect.poll(() => logo.evaluate(img => img.complete && img.naturalWidth)).toBe(540);
    expect(await logo.evaluate(img => img.naturalHeight)).toBe(360);
    expect(await logo.evaluate(img => img.width / img.height)).toBeCloseTo(1.5);
    await expect(page.locator('.tracking-brand')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(page.locator('.tracking-header h1')).toHaveCSS('color', 'rgb(21, 43, 73)');
    await expect(page.locator('.order-number')).toHaveText(state.order.number);
    await expect(page.locator('.order-number')).toHaveCSS('font-size', '24px');
    await expect(page.locator('.order-number')).toHaveCSS('font-weight', '700');
    await expect(page.locator('section.order-summary.panel')).toHaveCount(1);
    await expect(page.getByRole('heading', { name: 'Informasi Pesanan', exact: true })).toBeVisible();
    await expect(page.locator('.order-summary .panel, .order-summary details, .status-summary, .cost-summary')).toHaveCount(0);
    const summaryBox = await page.locator('.order-summary').boundingBox();
    const shoeBox = await page.locator('article').first().boundingBox();
    expect(summaryBox.width).toBeCloseTo(shoeBox.width);
    expect(summaryBox.x).toBeCloseTo(shoeBox.x);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.locator('.metrics')).toHaveCount(0);
    await expect(page.locator('.order-summary')).toContainText('Total Akhir');
    await expect(page.getByText('Perlu Pengembalian', { exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Riwayat Pengerjaan', exact: true })).toHaveCount(2);
    await expect(page.locator('.shoe-photos h3')).toHaveText(state.order.items.map((item, index) => `Foto Sepatu ${index + 1} (${item.brand})`));
    await expect(page.locator('article details, article summary, .shoe-price')).toHaveCount(0);
    await expect(page.getByText(/Rincian biaya sepatu|Hasil inspeksi:|Penawaran /)).toHaveCount(0);
    for (const timeline of await page.locator('.timeline').all()) await expect(timeline).toBeVisible();
    await expect(page.locator('.timeline').first().locator('strong')).toHaveText(['Sepatu Diterima', 'Menunggu Persetujuan Customer']);
    await expect(page.locator('.timeline').first().locator('time')).toHaveText(['Rabu, 11 November 2026 | 10:00 WIB.', 'Rabu, 11 November 2026 | 11:00 WIB.']);
    await expect(page.locator('.records').first()).toContainText('Jumat, 13 November 2099 | 17:00 WIB.');
    await expect(page.locator('.summary-rows')).toBeVisible();
    await expect(page.locator('.order-summary')).toContainText(state.order.pricing.name);
    await expect(page.locator('.timeline').first()).toBeVisible();
    for (const image of await page.locator('.photos img').all()) {
      await image.scrollIntoViewIfNeeded();
      await expect.poll(() => image.evaluate(img => img.complete && img.naturalWidth > 0)).toBe(true);
      await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
    }
    await expect(page.locator('.photos button')).toHaveCount(4);
    for (const button of await page.locator('main button').all()) expect((await button.boundingBox()).height).toBeGreaterThanOrEqual(44);
    await expect(page.getByText('Memiliki Token Persetujuan Terpisah?', { exact: true })).toHaveCount(0);
    await summaryLayout(page, width);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`tracking-${width}.png`), fullPage: true });
    clean(state);
  });
}
test('staff final price never fabricates customer agreement; risk remains explicit', async ({ page }) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${origin}/track/${token}#approval=${approval}&item=shoe-fixture`);
  await expect(page.getByRole('button', { name: 'Setujui dan kunci harga' })).toHaveCount(0);
  await expect(page.getByRole('checkbox')).toHaveCount(0);
  await expect(page.locator('.order-summary')).toContainText('Harga diverifikasi staf.');
  await expect(page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toBeEnabled();
  await expect(page.locator('article').first().locator('.badge')).toHaveText('Menunggu Persetujuan Customer');
  await expect(page.locator('.notice h3')).toHaveText('Menunggu Persetujuan Customer');
  await expect(page.locator('.notice')).toContainText('Pencucian dilanjutkan setelah Anda menyetujui risiko berikut.');
  expect(state.posts).toEqual([]);
  await noOverflow(page); clean(state);
});
test('consent card risk-only copy; legacy defaults and custom labels stay compatible', async ({ page }) => {
  const state = await mockApi(page);
  const item = state.order.items[0];
  item.risk = item.consents[0].risk;
  item.inspection = { notes: 'CATATAN_INTERNAL_RAHASIA', risk: 'RISIKO_INTERNAL_RAHASIA' };
  state.order.statusLabels = Object.fromEntries(['order', 'shoe', 'history'].map(context => [`${context}.AWAITING_CONSENT`, 'Menunggu Persetujuan Client']));
  await page.setViewportSize({ width: 390, height: 900 });
  await page.goto(`${origin}/track/${token}#approval=${approval}&item=shoe-fixture`);
  const card = page.locator('.notice');
  await expect(card.getByRole('heading')).toHaveText('Menunggu Persetujuan Customer');
  await expect(card.getByText(item.consents[0].risk, { exact: true })).toHaveCount(1);
  await expect(card.locator('.preserve')).toHaveCount(2);
  await expect(card).not.toContainText(/Rp|45[.,]000|penawaran|penanganan|CATATAN_INTERNAL|RISIKO_INTERNAL/);
  await expect(card).toContainText('Batas KonfirmasiJumat, 13 November 2099 | 17:00 WIB.');
  await expect(card).toContainText('Dengan menyetujui, Anda menerima risiko pencucian di atas.');
  await expect(card).toContainText('Menolak berarti sepatu dikembalikan tanpa biaya cuci.');
  await expect(page.locator('.summary-total dd')).toHaveText(/Rp\s*45\.000/);
  await expect(page.getByLabel('Status Pesanan', { exact: true })).toHaveText('Proses Pengerjaan');
  await expect(page.locator('article').first().locator('.badge')).toHaveText('Menunggu Persetujuan Customer');
  await expect(page.locator('.timeline').first().locator('strong').last()).toHaveText('Menunggu Persetujuan Customer');
  state.order.statusLabels = Object.fromEntries(['order', 'shoe', 'history'].map(context => [`${context}.AWAITING_CONSENT`, 'Persetujuan Risiko Pelanggan']));
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.getByLabel('Status Pesanan', { exact: true })).toHaveText('Proses Pengerjaan');
  await expect(page.locator('article').first().locator('.badge')).toHaveText('Persetujuan Risiko Pelanggan');
  await expect(page.locator('.timeline').first().locator('strong').last()).toHaveText('Persetujuan Risiko Pelanggan');
  expect(state.posts).toEqual([]);
  await noOverflow(page); clean(state);
});
for (const decision of ['APPROVE', 'DECLINE']) test(`risk ${decision} keyboard dialog, pending and single use`, async ({ page }, testInfo) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${origin}/track/${token}#approval=${approval}&item=shoe-fixture`);
  const action = page.getByRole('button', { name: decision === 'APPROVE' ? 'Setujui Risiko & Lanjutkan' : 'Tolak Pencucian', exact: true });
  await action.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await typography(page);
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0);
  await expect(action).toBeFocused();
  await page.keyboard.press('Enter');
  state.postStatus = 409;
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('CONFLICT');
  state.postStatus = 200;
  let release; state.postGate = new Promise(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: 'Konfirmasi', exact: true }).focus(); await page.keyboard.press('Enter');
  try {
    await expect(dialog.getByRole('button', { name: 'Menyimpan…' })).toBeDisabled();
    await expect(dialog.getByRole('button', { name: 'Batal' })).toBeDisabled();
    await page.keyboard.press('Escape'); await expect(dialog).toBeVisible();
    expect(await dialog.evaluate(el => { const box = el.getBoundingClientRect(); return box.left >= 0 && box.right <= innerWidth && el.scrollWidth <= el.clientWidth; })).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('consent-pending-320.png'), fullPage: true });
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('status').filter({ hasText: 'Keputusan tersimpan.' })).toBeVisible();
  await expect(action).toHaveCount(0);
  expect(state.posts.map(post => post.body.decision)).toEqual([decision, decision]);
  await expect(page.getByRole('button', { name: 'Setujui dan kunci harga' })).toHaveCount(0);
  await noOverflow(page); clean(state);
});
test('loading, expired link, missing link and reload recovery', async ({ page }) => {
  const state = await mockApi(page);
  await page.setViewportSize({ width: 320, height: 800 });
  let release; state.gate = new Promise(resolve => { release = resolve; });
  state.status = 410;
  await page.goto(`${origin}/track/${token}`);
  try { await expect(page.getByRole('status')).toHaveText('Memuat pesanan…'); await expect(page.getByRole('button', { name: 'Perbarui Status' })).toBeDisabled(); } finally { release(); }
  await expect(page.getByRole('alert')).toContainText('kedaluwarsa');
  await expect(page.locator('.order-number')).toHaveCount(0);
  state.status = 404;
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.getByRole('alert')).toContainText('NOT_FOUND');
  state.status = 200;
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await noOverflow(page); clean(state);
});
test('expired consent, removed manual token UI, archive read-only', async ({ page }) => {
  const state = await mockApi(page);
  state.order.items[0].consents[0].expired = true;
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`${origin}/track/${token}#approval=${approval}&item=shoe-fixture`);
  await expect(page.getByText('Tautan sudah kedaluwarsa. Hubungi toko untuk meminta tautan baru.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toHaveCount(0);
  await expect(page.getByText('Memiliki Token Persetujuan Terpisah?', { exact: true })).toHaveCount(0);
  await expect(page.getByLabel('Token Tindakan 64 Karakter')).toHaveCount(0);
  expect(state.posts).toEqual([]);
  state.order.archivedAt = '2026-11-11T10:00:00Z';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Data ini tidak tersedia' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Setujui dan kunci harga' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Setujui Risiko & Lanjutkan', exact: true })).toHaveCount(0);
  await expect(page.locator('.shoe-history h3')).toHaveCount(2);
  expect(state.posts).toEqual([]); await noOverflow(page); clean(state);
});

for (const scenario of ['inspection', 'risk', 'final', 'partial', 'paid', 'refund-due', 'refunded', 'rejected', 'ready-declined', 'legacy-pending', 'legacy-final']) {
  test(`compact summary ${scenario}`, async ({ page }, testInfo) => {
    const state = await mockApi(page);
    const order = state.order;
    order.number = 'CC-20261111-TEST'; order.pickupInstructions = 'Ambil di toko setelah konfirmasi.';
    order.pricing.name = 'Paket cuci'; order.pricing.stage = 'LOCKED';
    order.totalIdr = 90000; order.paidIdr = 0; order.balanceIdr = 90000; order.refundDueIdr = 0; order.paymentStatus = 'UNPAID';
    order.aggregateStatus = 'WAITING_INSPECTION';
    order.items.forEach((item, index) => {
      item.brand = index ? 'Adidas' : 'Nike'; item.model = ''; item.status = 'QUEUED'; item.outcome = 'APPROVED';
      item.finalPriceIdr = 45000; item.consents = []; item.risk = '';
    });
    const pending = ['inspection', 'risk', 'legacy-pending'].includes(scenario);
    if (pending) {
      order.pricing.stage = 'ESTIMATE';
      order.items[0].status = scenario === 'risk' ? 'AWAITING_CONSENT' : 'RECEIVED';
      order.items[0].outcome = scenario === 'risk' ? 'NEEDS_CONSENT' : null;
      if (scenario === 'risk') order.aggregateStatus = 'AWAITING_CONSENT';
      order.items[0].finalPriceIdr = 0;
    }
    if (scenario === 'final') order.pricing.stage = 'FINAL';
    if (scenario === 'partial') { order.paidIdr = 30000; order.balanceIdr = 60000; order.paymentStatus = 'PARTIAL'; }
    if (scenario === 'paid') { order.paidIdr = 90000; order.balanceIdr = 0; order.paymentStatus = 'PAID'; }
    if (scenario === 'refund-due') { order.paidIdr = 100000; order.balanceIdr = -10000; order.refundDueIdr = 10000; order.paymentStatus = 'PAID'; }
    if (['rejected', 'refunded'].includes(scenario)) {
      order.totalIdr = 0; order.balanceIdr = 0; order.pricing.totalIdr = 0; order.pricing.pairs = 0;
      order.paymentStatus = scenario === 'refunded' ? 'REFUNDED' : 'UNPAID';
      order.items.forEach(item => { item.outcome = 'REJECTED'; item.status = 'RETURN_PENDING'; item.finalPriceIdr = 0; });
    }
    if (scenario === 'ready-declined') {
      order.pricing.stage = 'FINAL'; order.pricing.pairs = 1; order.pricing.totalIdr = 45000;
      order.totalIdr = 45000; order.balanceIdr = 45000; order.aggregateStatus = 'READY_FOR_PICKUP';
      order.items[0].status = 'READY_FOR_PICKUP';
      order.items[0].timeline = [{ status: 'RECEIVED', at: '2026-11-11T03:00:00Z' }, { status: 'READY_FOR_PICKUP', at: '2026-11-11T05:00:00Z' }];
      order.items[1].outcome = 'DECLINED'; order.items[1].status = 'RETURN_PENDING'; order.items[1].finalPriceIdr = 0;
      order.items[1].consents = [{ id: 'declined-risk', decision: 'DECLINE' }];
      order.items[1].photos = []; order.items[1].timeline = [{ status: 'RETURN_PENDING', at: '2026-11-11T04:00:00Z' }];
    }
    if (scenario.startsWith('legacy-')) order.pricing = null;
    await page.setViewportSize({ width: 390, height: 900 });
    await page.goto(`${origin}/track/${token}`);
    const summary = page.locator('.order-summary');
    await expect(summary.locator('.summary-total dd')).toHaveText(new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(order.totalIdr));
    await expect(summary.getByText('Dibayar Bersih', { exact: true })).toBeVisible();
    if (pending) {
      await expect(summary.getByText('Estimasi Biaya', { exact: true })).toBeVisible();
      await expect(summary.getByText('Sisa Pembayaran', { exact: true })).toHaveCount(0);
      await expect(summary.getByLabel('Status Pembayaran', { exact: true })).toBeVisible();
    } else {
      await expect(summary.getByLabel('Status Pembayaran', { exact: true })).toBeVisible();
      if (scenario === 'refund-due') {
        await expect(summary.getByText('Sisa Pembayaran', { exact: true })).toHaveCount(0);
        await expect(summary).toContainText(/Perlu PengembalianRp\s*10\.000Pengembalian belum dicatat\./);
      } else await expect(summary.locator('.summary-rows > div').filter({ has: page.getByText('Sisa Pembayaran', { exact: true }) }).locator('dd')).toHaveText(new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(order.balanceIdr));
    }
    if (scenario === 'partial') await expect(summary).toContainText('Dibayar Sebagian');
    if (scenario === 'paid') await expect(summary).toContainText('Lunas');
    if (scenario === 'refunded') await expect(summary).toContainText('Dikembalikan Seluruhnya');
    if (['rejected', 'refunded'].includes(scenario)) await expect(page.locator('article > p')).toHaveText(Array(2).fill('Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci'));
    if (scenario === 'ready-declined') {
      const shoes = page.locator('article');
      await expect(shoes.nth(0).locator('.badge')).toHaveText('Selesai Dikerjakan');
      await expect(shoes.nth(0).getByRole('region', { name: 'Foto Sepatu 1 (Nike)', exact: true })).toBeVisible();
      await expect(shoes.nth(0).locator('.photos img')).toHaveCount(2);
      await expect(shoes.nth(1).locator(':scope > p')).toHaveText('Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci');
      await expect(shoes.nth(1).locator('.shoe-photos, .photos')).toHaveCount(0);
      await expect(shoes.nth(1).locator('.timeline strong')).toHaveText('Tidak Dicuci · Menunggu Pengembalian');
      for (const history of await page.locator('.shoe-history').all()) await expect(history).toBeVisible();
      await expect(page.getByText(/Rincian biaya sepatu|Hasil inspeksi:|Penawaran /)).toHaveCount(0);
    }
    const priceAction = page.getByRole('button', { name: 'Setujui dan kunci harga' });
    await expect(priceAction).toHaveCount(0);
    if (scenario === 'final') await expect(summary).toContainText('Harga diverifikasi staf.');
    expect(state.posts).toEqual([]);
    await expect(page.locator('article details')).toHaveCount(0);
    await summaryLayout(page, 390);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`summary-${scenario}-390.png`), fullPage: true });
    clean(state);
  });
}

for (const width of [320, 390, 1440]) test(`full WIB dates, truthful rejected history and gallery keyboard ${width}`, async ({ page }, testInfo) => {
  const state = await mockApi(page);
  const order = state.order;
  order.number = 'CC-PUBLIC-ONLY';
  order.pricing.turnaroundPolicy = 'FAST';
  order.estimatedCompletionAt = '2026-11-11T17:52:00Z';
  order.items = [{ ...order.items[1], brand: 'Nike', model: 'Air', photos: [{ id: 'safe', kind: 'AFTER', path: photo }] }, {
    ...order.items[0], brand: 'adidas', model: 'originals', serviceName: 'cuci khusus', status: 'RETURN_PENDING', outcome: 'REJECTED', finalPriceIdr: 0, photos: [], consents: [],
    timeline: [{ status: 'RECEIVED', at: '2026-11-11T17:50:00Z' }, { status: 'QUEUED', at: '2026-11-11T17:51:00Z' }, { status: 'RETURN_PENDING', at: '2026-11-11T17:52:00Z' }],
  }];
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.completion')).toHaveText('Kamis, 12 November 2026 | 00:52 WIB.');
  expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe('America/Los_Angeles');
  const ready = page.locator('article').nth(0); const rejected = page.locator('article').nth(1);
  await expect(rejected.getByRole('heading', { level: 2 })).toHaveText('adidas originals');
  await expect(rejected.locator('.eyebrow')).toHaveText('Sepatu 2 · cuci khusus');
  await expect(rejected.locator('.eyebrow')).toHaveCSS('text-transform', 'none');
  await expect(rejected.locator('.badge')).toHaveAttribute('data-tone', 'amber');
  await expect(ready.locator('.badge')).toHaveAttribute('data-tone', 'green');
  await expect(rejected.locator('.rejection')).toHaveText('Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci');
  await expect(rejected.locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Pemeriksaan Selesai', 'Tidak Dicuci · Menunggu Pengembalian']);
  await expect(rejected.locator('.timeline time')).toHaveText(['Kamis, 12 November 2026 | 00:50 WIB.', 'Kamis, 12 November 2026 | 00:51 WIB.', 'Kamis, 12 November 2026 | 00:52 WIB.']);
  await expect(rejected.locator('[aria-current="step"]')).toHaveCount(1);
  await expect(rejected.getByText(/disetujui|Disetujui/)).toHaveCount(0);
  const gallery = ready.locator('.photos');
  expect(await gallery.evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(width >= 768 ? 3 : 2);
  const image = gallery.locator('img');
  await expect(image).toHaveCSS('object-fit', 'contain');
  await expect(gallery.locator('figcaption')).toHaveCSS('text-align', 'center');
  expect((await image.boundingBox()).width).toBeLessThan(width >= 768 ? 160 : 180);
  const photosBox = await ready.locator('.shoe-photos').boundingBox();
  const historyBox = await ready.locator('.shoe-history').boundingBox();
  if (width >= 768) expect(Math.abs(photosBox.y - historyBox.y)).toBeLessThan(1);
  else expect(historyBox.y).toBeGreaterThan(photosBox.y + photosBox.height);
  const trigger = gallery.getByRole('button');
  await trigger.focus(); await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const close = dialog.getByRole('button', { name: 'Tutup Foto' });
  await expect(close).toBeFocused();
  await page.keyboard.press('Tab'); await expect(trigger).not.toBeFocused();
  await page.keyboard.press('Shift+Tab'); await expect(close).toBeFocused();
  await page.keyboard.press('Escape'); await expect(dialog).not.toBeVisible(); await expect(trigger).toBeFocused();
  await page.keyboard.press('Enter'); await expect(dialog).toBeVisible(); await close.click(); await expect(trigger).toBeFocused();
  for (const time of await rejected.locator('time').all()) {
    await expect(time).toBeVisible();
    expect(await time.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  }
  await noOverflow(page);
  await page.screenshot({ path: testInfo.outputPath(`polished-${width}.png`), fullPage: true });
  clean(state);
});
test('date-only, invalid and missing dates never fabricate time; private images stay hidden', async ({ page }) => {
  const state = await mockApi(page);
  state.order.estimatedCompletionAt = '2026-11-12';
  state.order.items[0].consents[0].expiresAt = 'invalid';
  state.order.items[0].photos = [{ id: 'private-inspection', kind: 'INSPECTION', path: '/api/private-inspection' }, { id: 'private-before', kind: 'BEFORE', customerVisible: false, path: '/api/private-before' }];
  state.order.items[0].timeline = [{ status: 'RECEIVED', at: null }, { status: 'INSPECTION', at: 'invalid' }, { status: 'QUEUED', at: '2026-11-12T00:52:00' }, { status: 'WASHING', at: '2026-11-12T00:98:00+07:00' }];
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.completion')).toHaveText('Kamis, 12 November 2026 · Jam Tidak Tersedia');
  await expect(page.locator('article').first().locator('time')).toHaveText(Array(4).fill('Waktu Tidak Tersedia'));
  await expect(page.locator('article').first().locator('.records')).toContainText('Batas KonfirmasiWaktu Tidak Tersedia');
  await expect(page.locator('article').first().locator('.shoe-photos')).toHaveCount(0);
  expect(state.calls.some(call => call.includes('private-'))).toBe(false);
  clean(state);
});

test('photo headings use original shoe index and escaped brand, not photo count; empty gallery stays absent', async ({ page }) => {
  const state = await mockApi(page);
  state.order.items[0].photos = [];
  state.order.items[1].brand = 'Adidas';
  state.order.items[1].photos = [{ id: 'single', kind: 'BEFORE', path: photo }];
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('article').first().locator('.shoe-photos, .photos')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Foto Sepatu 1', exact: false })).toHaveCount(0);
  const section = page.getByRole('region', { name: 'Foto Sepatu 2 (Adidas)', exact: true });
  await expect(section.getByRole('heading', { name: 'Foto Sepatu 2 (Adidas)', exact: true })).toHaveAttribute('id', 'shoe-photos-1');
  await expect(section).toHaveAttribute('aria-labelledby', 'shoe-photos-1');
  await expect(section.locator('.photos img')).toHaveCount(1);
  state.order.items[1].brand = '<em>Adidas & Nike</em>';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.getByRole('region', { name: 'Foto Sepatu 2 (<em>Adidas & Nike</em>)', exact: true })).toBeVisible();
  await expect(page.locator('.shoe-photos h3 em')).toHaveCount(0);
  for (const kind of ['BEFORE', 'AFTER']) {
    state.order.items[1].photos = [{ id: 'single', kind, path: photo }];
    await page.getByRole('button', { name: 'Perbarui Status' }).click();
    const title = `<em>Adidas & Nike</em> - Foto ${kind === 'BEFORE' ? 'Sebelum' : 'Sesudah'}`;
    const trigger = page.getByRole('button', { name: `Perbesar ${title}`, exact: true });
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('heading')).toHaveText(title);
    await expect(dialog.getByRole('img')).toHaveAttribute('alt', title);
    await expect(dialog.locator('h2 em')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(trigger).toBeFocused();
  }
  state.order.items[1].photos = [];
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(page.locator('.shoe-photos, .photos')).toHaveCount(0);
  clean(state);
});

for (const [scenario, outcome, decisions, status, reason] of [
  ['customer risk decline', 'DECLINED', ['DECLINE'], 'RETURN_PENDING', 'Pencucian tidak dilanjutkan karena customer tidak menyetujui risiko.'],
  ['staff rejection', 'REJECTED', [], 'RETURN_PENDING', 'Pencucian tidak dilanjutkan setelah pemeriksaan staf.'],
  ['operational cancellation', 'DECLINED', ['CANCELLED'], 'RETURN_PENDING', 'Pencucian dibatalkan.'],
  ['ambiguous historical return', 'DECLINED', [], 'RETURNED', 'Pencucian dibatalkan.'],
  ['expired risk request', 'DECLINED', [null], 'RETURN_PENDING', 'Pencucian dibatalkan.'],
  ['mixed historical decisions', 'DECLINED', ['DECLINE', 'CANCELLED'], 'RETURN_PENDING', 'Pencucian dibatalkan.'],
]) test(`truthful rejection notice: ${scenario}`, async ({ page }) => {
  const state = await mockApi(page);
  const item = state.order.items[0];
  Object.assign(item, { outcome, status, finalPriceIdr: 0, inspection: { notes: 'CATATAN_INTERNAL_RAHASIA', outcome: 'REJECTED' }, consents: decisions.map(decision => ({ decision, expired: true })) });
  state.order.items = [item];
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  const notice = page.locator('.rejection');
  await expect(notice).toHaveText('Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci');
  await expect(page.locator('.customer-notes')).toContainText(reason);
  await expect(notice.locator('strong > em')).toHaveText(await notice.innerText());
  await expect(notice.locator('em')).toHaveCSS('font-style', 'italic');
  expect(Number(await notice.locator('em').evaluate(el => getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(700);
  await expect(page.getByText('CATATAN_INTERNAL_RAHASIA', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Riwayat Pengerjaan', exact: true })).toBeVisible();
  await noOverflow(page); clean(state);
});

for (const [outcome, fee] of [['REJECTED', 100], ['DECLINED', 100], ['APPROVED', 0], [null, 0]]) test(`no false waived fee ${outcome} ${fee}`, async ({ page }) => {
  const state = await mockApi(page);
  Object.assign(state.order.items[0], { outcome, status: 'RETURN_PENDING', finalPriceIdr: fee, consents: [] });
  state.order.items = [state.order.items[0]];
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.badge').last()).toHaveText('Tidak Dicuci');
  await expect(page.getByText('Sepatu Tidak Dicuci dan Tidak Ada Biaya Cuci', { exact: true })).toHaveCount(0);
  if (fee) {
    await expect(page.locator('.rejection')).toContainText(/Biaya cuci Rp\s*100\./);
    await expect(page.locator('.progress-counts')).not.toContainText('tanpa biaya');
  } else await expect(page.locator('.rejection')).toHaveCount(0);
  clean(state);
});

for (const scenario of ['mixed-ready', 'all-return', 'completed', 'active']) test(`stage-aware status and ETA ${scenario}`, async ({ page }) => {
  const state = await mockApi(page);
  const order = state.order;
  order.pickupInstructions = '';
  order.items.forEach(item => { item.outcome = 'APPROVED'; item.consents = []; item.status = 'WASHING'; item.finalPriceIdr = 0; });
  if (scenario === 'mixed-ready') { order.items[0].status = 'READY_FOR_PICKUP'; order.items[1].status = 'RETURN_PENDING'; order.items[1].outcome = 'DECLINED'; }
  if (scenario === 'all-return') order.items.forEach(item => { item.status = 'RETURN_PENDING'; item.outcome = 'REJECTED'; });
  if (scenario === 'completed') { order.items[0].status = 'HANDED_OVER'; order.items[1].status = 'RETURNED'; order.items[1].outcome = 'DECLINED'; }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  const status = page.locator('.order-summary');
  await expect(status.getByRole('heading', { name: 'Estimasi Selesai:', exact: true })).toBeVisible();
  await expect(status.getByRole('heading', { name: 'Pengambilan', exact: true })).toHaveCount(0);
  await expect(status.getByText('Instruksi pengambilan belum tersedia.', { exact: true })).toHaveCount(0);
  await expect(status.locator('.summary-eta')).toHaveClass(scenario === 'active' ? 'summary-eta' : 'summary-eta inactive');
  await expect(status.locator('.summary-eta')).toHaveCSS('color', 'rgb(24, 44, 73)');
  await expect(status.locator('.completion')).toHaveCSS('font-size', '14px');
  await expect(status.locator('a')).toHaveCount(0);
  await expect(status).not.toContainText(/semua.*dicuci|selesai aktual:/i);
  if (scenario === 'mixed-ready') await expect(status.locator('li')).toHaveText(['1 pasang sepatu selesai dicuci', '1 pasang sepatu tidak dicuci — tanpa biaya pencucian']);
  if (scenario === 'all-return') await expect(status.locator('li')).toHaveText(['2 pasang sepatu tidak dicuci — tanpa biaya pencucian']);
  if (scenario === 'completed') await expect(status.locator('li')).toHaveText(['1 pasang sepatu selesai dicuci', '1 pasang sepatu tidak dicuci — tanpa biaya pencucian']);
  if (scenario === 'active') await expect(status.locator('li')).toHaveText(['2 pasang sepatu sedang dicuci']);
  await noOverflow(page); clean(state);
});

for (const width of [320, 390, 1440]) test(`summary long amounts and statuses ${width}`, async ({ page }) => {
  const state = await mockApi(page);
  Object.assign(state.order, { totalIdr: 2147483647, paidIdr: 1147483647, balanceIdr: 1000000000, refundDueIdr: 0, paymentStatus: 'REFUNDED' });
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.summary-total dd')).toHaveText(/Rp\s*2\.147\.483\.647/);
  await expect(page.locator('.payment-badge')).toHaveText('Dikembalikan Seluruhnya');
  await summaryLayout(page, width);
  await noOverflow(page);
  for (const el of await page.locator('.order-summary dd, .order-summary .completion, .payment-badge').all()) expect(await el.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  clean(state);
});

async function typography(page, scale = 1) {
  const violations = await page.locator('.tracking *:not(.online-note)').evaluateAll((nodes, scale) => nodes.filter(el => el.getClientRects().length && (el.childNodes.length === 0 || [...el.childNodes].some(n => n.nodeType === Node.TEXT_NODE && n.textContent.trim()))).flatMap(el => {
    const style = getComputedStyle(el);
    const expected = (el.matches('h1, .order-number') ? 24 : el.matches('h2') || (el.matches('h3') && !el.closest('.order-summary')) ? 18 : el.matches('.order-summary h3, .service-snapshot') ? 15 : el.matches('.summary-total dd') ? 28 : 14) * scale;
    return Math.abs(parseFloat(style.fontSize) - expected) > .1 || Math.abs(parseFloat(style.lineHeight) - expected * 1.5) > .1 || style.textTransform !== 'none' || style.letterSpacing !== 'normal' ? [el.tagName + '.' + el.className + ': ' + style.fontSize + '/' + style.lineHeight] : [];
  }), scale);
  expect(violations).toEqual([]);
}
for (const width of [320, 390, 768, 1440]) test(`uniform typography, white sections and text zoom ${width}`, async ({ page }, testInfo) => {
  const state = await mockApi(page);
  state.order.number = 'CC-TYPOGRAPHY';
  state.order.pricing.name = 'Fast'; state.order.pricing.stage = 'FINAL'; state.order.pricing.pairs = 1;
  state.order.items = [state.order.items[0]];
  Object.assign(state.order.items[0], { brand: 'Nike', model: '', serviceName: 'Fast', status: 'QUEUED', outcome: 'APPROVED', consents: [] });
  state.order.totalIdr = 45000; state.order.paidIdr = 15000; state.order.balanceIdr = 30000; state.order.refundDueIdr = 0;
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.service-snapshot')).toHaveText('Layanan — Fast');
  await expect(page.locator('.info-rows')).toHaveCount(0);
  await expect(page.locator('.progress-counts')).toContainText('1 pasang sepatu menunggu pencucian');
  await summaryLayout(page, width); await typography(page); await noOverflow(page);
  if (width === 1440) for (const dt of await page.locator('.summary-rows dt').all()) expect(await dt.evaluate(el => { const r = document.createRange(); r.selectNodeContents(el); return r.getClientRects().length; })).toBe(1);
  await page.screenshot({ path: testInfo.outputPath(`typography-${width}.png`), fullPage: true });
  await page.getByRole('button', { name: /Perbesar .* - Foto/ }).first().click();
  await typography(page); await page.keyboard.press('Escape');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await typography(page, 2); await noOverflow(page);
  clean(state);
});

for (const width of [320, 1440]) for (const [paymentStatus, text] of [['UNPAID', 'Belum Dibayar'], ['PARTIAL', 'Dibayar Sebagian'], ['PAID', 'Lunas'], ['REFUNDED', 'Dikembalikan Seluruhnya']]) test(`payment header ${paymentStatus} ${width}`, async ({ page }) => {
  const state = await mockApi(page);
  state.order.paymentStatus = paymentStatus;
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.payment-heading .payment-badge')).toHaveText(text);
  await summaryLayout(page, width); await noOverflow(page); clean(state);
});

test('summary groups actual stages, excludes returns before completed mapping; tariff count is not washed count', async ({ page }) => {
  const state = await mockApi(page);
  const statuses = ['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'WASHING', 'DRYING', 'FINISHING', 'QC', 'REWORK', 'READY_FOR_PICKUP', 'HANDED_OVER', 'RETURN_PENDING', 'RETURNED', 'READY_FOR_PICKUP', 'HANDED_OVER'];
  state.order.items = statuses.map((status, n) => ({ ...state.order.items[0], id: `stage-${n}`, brand: `Sepatu ${n}`, status, outcome: n === 13 ? 'REJECTED' : n === 14 ? 'DECLINED' : status === 'AWAITING_CONSENT' ? 'NEEDS_CONSENT' : n < 2 ? null : 'APPROVED', consents: [], photos: [], timeline: [{ status, at: '2026-11-11T05:00:00Z' }] }));
  state.order.pricing.stage = 'ESTIMATE'; state.order.pricing.pairs = 11;
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  await expect(page.locator('.progress-counts li')).toHaveText(['2 pasang sepatu menunggu pemeriksaan', '1 pasang sepatu menunggu persetujuan customer', '1 pasang sepatu menunggu pencucian', '1 pasang sepatu sedang dicuci', '1 pasang sepatu sedang dikeringkan', '1 pasang sepatu dalam finishing', '1 pasang sepatu dalam pemeriksaan mutu', '1 pasang sepatu sedang dikerjakan ulang', '2 pasang sepatu selesai dicuci', '4 pasang sepatu tidak dicuci — tanpa biaya pencucian']);
  await expect(page.locator('.summary-rows > div').filter({ has: page.getByText('Jumlah Sepatu Awal', { exact: true }) }).locator('dd')).toHaveText('15 pasang');
  await expect(page.locator('.service-snapshot')).not.toContainText(/pasang/i);
  await expect(page.locator('article').nth(9).locator('.badge')).toHaveText('Selesai Dikerjakan');
  await expect(page.locator('article').nth(10).locator('.timeline strong')).toHaveText('Sudah Diambil');
  await expect(page.locator('article').nth(11).locator('.badge')).toHaveText('Tidak Dicuci');
  await expect(page.locator('article').nth(12).locator('.timeline strong')).toHaveText('Tidak Dicuci · Dikembalikan');
  await noOverflow(page); clean(state);
});

test('public order badge uses four customer statuses', async ({ page }) => {
  const state = await mockApi(page), item = state.order.items[0];
  state.order.items = [{ ...item, status: 'RECEIVED', outcome: null }];
  await page.goto(`${origin}/track/${token}`);
  const badge = page.getByLabel('Status Pesanan', { exact: true });
  await expect(badge).toHaveText('Dalam Antrian');
  await expect(badge).toHaveAttribute('data-tone', 'amber');
  state.order.items[0].status = 'WASHING';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(badge).toHaveText('Proses Pengerjaan');
  await expect(badge).toHaveAttribute('data-tone', 'blue');
  state.order.items[0].status = 'READY_FOR_PICKUP'; state.order.paymentStatus = 'UNPAID';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(badge).toHaveText('Selesai Dikerjakan');
  await expect(badge).toHaveAttribute('data-tone', 'green');
  state.order.paymentStatus = 'PAID';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(badge).toHaveText('Siap Diambil');
  await expect(badge).toHaveAttribute('data-tone', 'teal');
  state.order.items[0].status = 'HANDED_OVER';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(badge).toHaveText('Transaksi Selesai');
  await expect(badge).toHaveAttribute('data-tone', 'green');
  state.order.paymentStatus = 'UNPAID';
  await page.getByRole('button', { name: 'Perbarui Status' }).click();
  await expect(badge).toHaveText('Selesai Dikerjakan');
  clean(state);
});

for (const width of [320, 1440]) for (const scenario of ['ready-return', 'rejected', 'declined', 'handed-over', 'active']) test(`workmanship and order header ${scenario} ${width}`, async ({ page }) => {
  const state = await mockApi(page);
  state.order.number = 'CC-WORKMANSHIP';
  state.order.paymentStatus = 'UNPAID';
  const history = statuses => statuses.map((status, n) => ({ status, at: `2026-11-11T0${n + 1}:00:00Z` }));
  const shoe = (status, outcome, statuses = ['RECEIVED', status]) => ({ ...state.order.items[0], brand: 'Nike', model: '', status, outcome, consents: [], photos: [], timeline: history(statuses) });
  state.order.items = [shoe('READY_FOR_PICKUP', 'APPROVED', ['RECEIVED', 'QUEUED', 'WASHING', 'DRYING', 'READY_FOR_PICKUP']), { ...shoe('RETURN_PENDING', 'DECLINED', ['RECEIVED', 'AWAITING_CONSENT', 'RETURN_PENDING']), id: 'return', brand: 'Adidas' }];
  state.order.aggregateStatus = 'READY_FOR_PICKUP';
  if (scenario === 'rejected') state.order.items = [shoe('RETURNED', 'REJECTED', ['RECEIVED', 'RETURN_PENDING', 'RETURNED'])];
  if (scenario === 'declined') state.order.items = [shoe('RETURN_PENDING', 'DECLINED', ['RECEIVED', 'WASHING', 'DRYING', 'READY_FOR_PICKUP', 'RETURN_PENDING'])];
  if (scenario === 'handed-over') {
    state.order.aggregateStatus = 'COMPLETED';
    state.order.items = [shoe('HANDED_OVER', 'APPROVED', ['READY_FOR_PICKUP', 'HANDED_OVER']), { ...shoe('HANDED_OVER', 'DECLINED', ['RETURN_PENDING', 'HANDED_OVER']), id: 'historical-return' }];
  }
  const active = ['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT', 'QUEUED', 'WASHING', 'DRYING', 'FINISHING', 'QC', 'REWORK'];
  const activeLabels = ['Pemeriksaan', 'Pemeriksaan', 'Menunggu Persetujuan Customer', 'Pemeriksaan Selesai', 'Pengerjaan', 'Pengeringan', 'Pengeringan · Finishing', 'Pengeringan · Pemeriksaan Mutu', 'Pengerjaan · Ulang'];
  if (scenario === 'active') { state.order.aggregateStatus = 'IN_PROGRESS'; state.order.items = active.map((status, n) => ({ ...shoe(status, status === 'AWAITING_CONSENT' ? 'NEEDS_CONSENT' : 'APPROVED', [status]), id: `active-${n}` })); }
  await page.setViewportSize({ width, height: 900 });
  await page.goto(`${origin}/track/${token}`);
  const header = page.locator('.summary-info > .summary-heading'), badge = header.getByLabel('Status Pesanan');
  await expect(page.getByLabel('Status Pesanan', { exact: true })).toHaveCount(1);
  await expect(header.locator(':scope > h2 + .order-badge')).toHaveCount(1);
  await expect(badge).toHaveText(scenario === 'active' ? 'Proses Pengerjaan' : 'Selesai Dikerjakan');
  await expect(page.locator('.order-identity .badge')).toHaveCount(0);
  await expect(page.locator('.payment-heading .payment-badge')).toHaveText('Belum Dibayar');
  await expect(header).toHaveCSS('flex-wrap', 'wrap');
  const placement = await header.evaluate(node => {
    const heading = node.querySelector('h2').getBoundingClientRect(), badge = node.querySelector('.badge').getBoundingClientRect(), box = node.getBoundingClientRect();
    return { rightGap: box.right - badge.right, sameLine: Math.abs(heading.y + heading.height / 2 - badge.y - badge.height / 2), gap: badge.x - heading.right };
  });
  expect(Math.abs(placement.rightGap)).toBeLessThan(1);
  if (width === 1440) { expect(placement.sameLine).toBeLessThan(1); expect(placement.gap).toBeGreaterThanOrEqual(0); }
  const cards = page.locator('article');
  if (scenario === 'ready-return') {
    await expect(cards.locator('.badge')).toHaveText(['Selesai Dikerjakan', 'Tidak Dicuci']);
    await expect(cards.first().locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Pemeriksaan Selesai', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', 'Selesai Dikerjakan']);
    await expect(cards.nth(1).locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Menunggu Persetujuan Customer', 'Tidak Dicuci · Menunggu Pengembalian']);
  } else if (scenario === 'rejected') {
    await expect(cards.locator('.badge')).toHaveText('Tidak Dicuci');
    await expect(cards.locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Tidak Dicuci · Menunggu Pengembalian', 'Tidak Dicuci · Dikembalikan']);
    await expect(cards.locator('.badge').filter({ hasText: 'Selesai Dikerjakan' })).toHaveCount(0);
  } else if (scenario === 'declined') {
    await expect(cards.locator('.badge')).toHaveText('Tidak Dicuci');
    // Preserve real past work/completion even when subsequently cancelled.
    await expect(cards.locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', 'Selesai Dikerjakan', 'Tidak Dicuci · Menunggu Pengembalian']);
  } else if (scenario === 'handed-over') {
    await expect(cards.locator('.badge')).toHaveText(['Sudah Diambil', 'Sudah Diambil']);
    await expect(cards.first().locator('.timeline strong')).toHaveText(['Selesai Dikerjakan', 'Sudah Diambil']);
    await expect(cards.nth(1).locator('.timeline strong')).toHaveText(['Tidak Dicuci · Menunggu Pengembalian', 'Sudah Diambil']);
  } else {
    await expect(cards.locator('.badge')).toHaveText(activeLabels);
    await expect(cards.locator('.timeline strong')).toHaveText(['Sepatu Diterima', 'Pemeriksaan Sepatu', 'Menunggu Persetujuan Customer', 'Pemeriksaan Selesai', 'Dalam Proses Pencucian', 'Dalam Proses Pengeringan', ...activeLabels.slice(6)]);
    await expect(cards.locator('.badge').filter({ hasText: 'Selesai Dikerjakan' })).toHaveCount(0);
  }
  await expect(cards.filter({ hasText: 'Siap Diambil' })).toHaveCount(0);
  await noOverflow(page); clean(state);
});
