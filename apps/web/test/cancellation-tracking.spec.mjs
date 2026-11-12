import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [320, 390, 1440]) for (const scenario of ['singles', 'bundle', 'per-pair', 'pending', 'all', 'historic', 'mixed']) {
  test(`cancellation ${scenario} ${width}: authoritative breakdown, truthful ledger, services`, async ({ page, context }) => {
    const unexpected = [], errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const pending = scenario === 'pending', all = scenario === 'all', historic = scenario === 'historic';
    const bundle = scenario === 'bundle', pairs = all ? 0 : bundle ? 3 : 2;
    const total = all ? 0 : bundle ? 130000 : historic ? 86667 : 90000;
    const pricing = { version: 2, name: 'Promo', stage: pending ? 'ESTIMATE' : historic ? 'LOCKED' : 'FINAL', pairs, initialTotalIdr: 130000, originalTotalIdr: 130000, originalPairs: 3, totalIdr: total, basis: historic ? 'HISTORICAL_AGREEMENT' : 'CANCELLATION', excludedPairs: all ? 3 : 1, calculationMatches: !historic, breakdown: all || historic ? [] : [{ kind: scenario === 'per-pair' ? 'PER_PAIR' : 'PACKAGE', quantity: bundle ? 1 : 2, pairs: bundle ? 3 : 1, priceIdr: bundle ? 130000 : 45000, totalIdr: total }] };
    const order = { number: 'CS-CANCEL', estimatedCompletionAt: '2026-12-01T10:00:00Z', aggregateStatus: pending ? 'AWAITING_CONSENT' : 'QUEUED', pricing, totalIdr: total, paidIdr: 120000, balanceIdr: total - 120000, refundDueIdr: Math.max(0, 120000 - total), paymentStatus: total <= 120000 ? 'PAID' : 'PARTIAL', items: Array.from({ length: all ? 3 : pairs + 1 }, (_, n) => ({ id: String(n), brand: `Shoe ${n}`, model: '', color: '', serviceName: scenario === 'mixed' && n === 1 ? 'Reguler' : 'Fast', status: all || n === pairs ? 'RETURN_PENDING' : pending ? 'AWAITING_CONSENT' : 'QUEUED', outcome: all || n === pairs ? 'DECLINED' : pending ? 'NEEDS_CONSENT' : 'APPROVED', finalPriceIdr: 0, quotedPriceIdr: 0, consents: [], photos: [], timeline: [] })) };
    await context.route('**/api/**', async route => {
      if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/cancellation-fixture') return route.fulfill({ json: order });
      unexpected.push(route.request().url()); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:5173/track/cancellation-fixture');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Tracking Pesanan');
    await expect(page.locator('.summary-rows')).toBeVisible();
    await expect(page.locator('.order-summary details, .order-summary .panel')).toHaveCount(0);
    const summary = page.locator('.order-summary');
    await expect(summary.locator('.service-snapshot')).toHaveText('Layanan — Promo');
    await expect(summary.locator('.summary-rows > div').filter({ has: page.getByText('Jumlah Sepatu Awal', { exact: true }) }).locator('dd')).toHaveText('3 pasang');
    await expect(summary.locator('.progress-counts li')).toHaveText(all ? ['3 pasang sepatu tidak dicuci — tanpa biaya pencucian'] : [`${pairs} pasang sepatu ${pending ? 'menunggu persetujuan customer' : 'menunggu pencucian'}`, '1 pasang sepatu tidak dicuci — tanpa biaya pencucian']);
    const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
    await expect(summary).not.toContainText('Perhitungan Tarif Saat Ini');
    await expect(summary.locator('.calculation-line')).toHaveCount(0);
    await expect(summary.locator('.summary-total dd')).toHaveText(money(total));
    await expect(summary.getByText('Sebelum Pembatalan', { exact: true })).toHaveCount(0);
    if (width === 1440) for (const dt of await summary.locator('.summary-rows dt').all()) expect(await dt.evaluate(el => { const range = document.createRange(); range.selectNodeContents(el); return range.getClientRects().length; })).toBe(1);
    if (historic) { await expect(summary).not.toContainText('Mengikuti harga yang disepakati sebelumnya.'); await expect(summary).toContainText('Total mengikuti alokasi historis tersimpan'); }
    else await expect(summary).toContainText('Kelayakan paket/promo dihitung ulang');
    if (pending) { await expect(summary.getByText('Estimasi Biaya', { exact: true })).toBeVisible(); await expect(summary.getByText('Sisa Pembayaran', { exact: true })).toHaveCount(0); }
    if (!pending && total < 120000) await expect(summary).toContainText('Pengembalian belum dicatat');
    await expect(summary.getByText('Dibayar Bersih', { exact: true })).toBeVisible();
    await expect(summary.getByText('Total Harga Awal', { exact: true })).toHaveCount(1);
    await expect(summary.locator('.summary-payment')).not.toContainText('pasang ditolak/dibatalkan');
    await expect(summary.getByText('Mengikuti harga yang disepakati sebelumnya.', { exact: true })).toHaveCount(0);
    await expect(summary.getByText('Dibayar', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Harga Disetujui Dan Terkunci', { exact: true })).toHaveCount(0);
    if (scenario === 'mixed') {
      await expect(page.locator('article .eyebrow').nth(0)).toHaveText('Sepatu 1 · Fast');
      await expect(page.locator('article .eyebrow').nth(1)).toHaveText('Sepatu 2 · Reguler');
    } else {
      await expect(summary.locator('.service-snapshot')).toHaveText('Layanan — Promo');
      await expect(page.locator('article').getByText('Fast', { exact: true })).toHaveCount(0);
      await expect(page.locator('article .eyebrow').nth(0)).toHaveText('Sepatu 1');
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  });
}

test('snapshot tariff shown once; refunded net remains net; no invented agreement', async ({ page, context }) => {
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const order = { number: 'CS-NET', aggregateStatus: 'QUEUED', totalIdr: 45000, paidIdr: 45000, balanceIdr: 0, refundDueIdr: 0, paymentStatus: 'PAID', pickupInstructions: 'Instruksi asli toko.', pricing: { version: 2, name: 'Tarif unik', stage: 'LOCKED', lockedAt: null, basis: 'INSPECTION', pairs: 1, initialTotalIdr: 90000, totalIdr: 45000 }, items: [{ id: 'shoe', brand: 'Nike', serviceName: 'Tarif unik', status: 'QUEUED', outcome: 'APPROVED', finalPriceIdr: 45000, consents: [], photos: [], timeline: [] }] };
  await context.route('**/api/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/net-fixture') return route.fulfill({ json: order });
    unexpected.push(route.request().url()); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  await page.goto('http://127.0.0.1:5173/track/net-fixture');
  const summary = page.locator('.order-summary');
  await expect(summary.getByText('Tarif unik', { exact: false })).toHaveCount(1);
  await expect(summary.locator('.summary-rows > div').filter({ has: page.getByText('Dibayar Bersih', { exact: true }) })).toHaveText(/Dibayar BersihRp\s*45\.000/);
  await expect(summary.getByText('Mengikuti harga yang disepakati sebelumnya.', { exact: true })).toHaveCount(0);
  await expect(summary.getByText(/Pembayaran Masuk|Dibayar \(Kotor\)/)).toHaveCount(0);
  await expect(page.locator('.pickup-instructions .preserve')).toHaveText('Instruksi asli toko.');
  await expect(page.locator('.pickup-instructions a')).toHaveCount(0);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});

for (const width of [320, 1440]) for (const scenario of ['shown', 'bundle', 'net-adjustment', 'increase', 'unchanged', 'no-cancellation', 'legacy', 'initial-only', 'snapshot', 'refund-due', 'refunded', 'pending', 'nonzero-fee']) {
  test(`payment clarity ${scenario} ${width}`, async ({ page, context }) => {
    const unexpected = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const bundle = ['bundle', 'net-adjustment', 'increase', 'unchanged'].includes(scenario);
    const count = bundle ? 3 : 2, original = scenario === 'net-adjustment' ? 210000 : bundle ? 130000 : 160000;
    const total = scenario === 'net-adjustment' ? 130000 : scenario === 'increase' ? 160000 : scenario === 'unchanged' ? original : bundle ? 90000 : 80000;
    const paid = scenario === 'refund-due' ? 160000 : scenario === 'refunded' ? 80000 : 0;
    const order = {
      number: 'CS-CLARITY', aggregateStatus: 'QUEUED', totalIdr: total, paidIdr: paid, balanceIdr: total - paid, refundDueIdr: Math.max(0, paid - total), paymentStatus: paid ? 'PAID' : 'UNPAID',
      pricing: { version: 2, name: 'Fast', stage: scenario === 'pending' ? 'ESTIMATE' : 'FINAL', pairs: count - 1, initialTotalIdr: scenario === 'snapshot' ? 240000 : original, originalTotalIdr: original, originalPairs: count, totalIdr: total, basis: 'CANCELLATION', calculationMatches: true, breakdown: [{ kind: 'PACKAGE', quantity: count - 1, pairs: 1, priceIdr: total / (count - 1), totalIdr: total }] },
      items: Array.from({ length: count }, (_, n) => ({ id: String(n), brand: 'Nike', serviceName: 'Fast', status: n ? 'RETURN_PENDING' : 'QUEUED', outcome: n ? 'DECLINED' : 'APPROVED', finalPriceIdr: n ? 0 : total, consents: [], photos: [], timeline: [] })),
    };
    // Exactly one cancelled shoe, including the three-to-two bundle case.
    order.items.forEach((item, n) => Object.assign(item, n === count - 1 ? {} : { status: 'QUEUED', outcome: 'APPROVED', finalPriceIdr: total / (count - 1) }));
    if (scenario === 'legacy') { delete order.pricing.initialTotalIdr; delete order.pricing.originalTotalIdr; delete order.pricing.originalPairs; }
    if (scenario === 'initial-only') { delete order.pricing.originalTotalIdr; delete order.pricing.originalPairs; }
    if (scenario === 'no-cancellation') Object.assign(order.items[1], { status: 'QUEUED', outcome: 'APPROVED', finalPriceIdr: 0 });
    if (scenario === 'nonzero-fee') order.items[1].finalPriceIdr = 10000;
    await context.route('**/api/**', async route => {
      if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/payment-clarity') return route.fulfill({ json: order });
      unexpected.push(route.request().url()); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
    });
    await page.setViewportSize({ width, height: 900 });
    await page.goto('http://127.0.0.1:5173/track/payment-clarity');
    const payment = page.locator('.summary-payment');
    const row = name => payment.locator('.summary-rows > div').filter({ has: page.getByText(name, { exact: true }) }).locator('dd');
    const money = value => new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value);
    await expect(payment.locator('.summary-total dd')).toHaveText(money(total));
    await expect(row('Jumlah Sepatu Awal')).toHaveCount(scenario === 'legacy' ? 0 : 1);
    if (scenario !== 'legacy') {
      await expect(row('Jumlah Sepatu Awal')).toHaveText(`${count} pasang`);
      await expect(row('Total Harga Awal')).toHaveText(money(original));
    } else await expect(row('Total Harga Awal')).toHaveCount(0);
    const reduction = !['increase', 'unchanged', 'no-cancellation', 'legacy', 'pending', 'nonzero-fee'].includes(scenario);
    await expect(payment.locator('dt').filter({ hasText: /Pasang Tidak Dicuci|Penyesuaian Bersih/ })).toHaveCount(reduction ? 1 : 0);
    if (reduction) await expect(row(bundle ? 'Penyesuaian Bersih' : '1 Pasang Tidak Dicuci')).toHaveText(`- ${money(original - total)}`);
    await expect(payment.locator('p').filter({ hasText: /Pasang Tidak Dicuci|selisih total tersimpan/i })).toHaveCount(0);
    await expect(page.locator('.summary-info .progress-counts')).toContainText(scenario === 'no-cancellation' ? '2 pasang sepatu menunggu pencucian' : '1 pasang sepatu tidak dicuci');
    if (bundle && reduction) { await expect(row('1 Pasang Tidak Dicuci')).toHaveCount(0); await expect(payment).toContainText('Kelayakan paket/promo dihitung ulang'); }
    await expect(row('Dibayar Bersih')).toHaveText(money(paid));
    if (scenario === 'refund-due') {
      await expect(row('Perlu Pengembalian')).toHaveText(`${money(80000)}Pengembalian belum dicatat.`);
      await expect(row('Sisa Pembayaran')).toHaveCount(0);
    } else if (scenario !== 'pending') await expect(row('Sisa Pembayaran')).toHaveText(money(total - paid));
    await expect(payment.locator('.online-note')).toHaveText('Ini bukan halaman pembayaran online.');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(unexpected).toEqual([]); expect(errors).toEqual([]);
  });
}
