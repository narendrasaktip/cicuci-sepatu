import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', timezoneId: 'America/Los_Angeles', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
for (const width of [320, 1440]) for (const scenario of ['fast', 'late', 'edited', 'missing-created', 'package', 'mixed', 'historic', 'legacy', 'nonzero', 'pending']) test(`public information ${scenario} ${width}`, async ({ page, context }) => {
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const order = {
    number: 'CS-INFORMATION', createdAt: '2026-11-11T10:00:00.000Z', estimatedCompletionAt: '2026-11-12T10:00:00.000Z', aggregateStatus: 'READY_FOR_PICKUP',
    totalIdr: 80000, paidIdr: 30000, balanceIdr: 50000, paymentStatus: 'PARTIAL', pickupInstructions: '',
    pricing: { version: 2, name: 'Fast', turnaroundPolicy: 'FAST', stage: 'FINAL', pairs: 1, initialTotalIdr: 160000, totalIdr: 80000, calculationMatches: true, breakdown: [{ kind: 'PACKAGE', pairs: 1, quantity: 1, priceIdr: 80000, totalIdr: 80000 }] },
    items: [
      { id: 'one', brand: 'Nike', serviceName: 'Fast', status: 'READY_FOR_PICKUP', outcome: 'APPROVED', finalPriceIdr: 80000, photos: [], consents: [], timeline: [] },
      { id: 'two', brand: '<em>Adidas</em>', serviceName: 'Fast', status: 'RETURN_PENDING', outcome: 'REJECTED', finalPriceIdr: 0, risk: 'Risiko publik asli: warna dapat memudar.', inspection: { notes: 'INTERNAL_INSPECTION' }, history: [{ reason: 'INTERNAL_HISTORY' }], photos: [], consents: [], timeline: [] },
    ],
  };
  if (scenario === 'fast') order.items[1].risk += ' Catatan risiko publik panjang.'.repeat(30);
  if (scenario === 'late') { order.createdAt = '2026-11-11T10:00:00.001Z'; order.estimatedCompletionAt = '2026-11-13T10:00:00.000Z'; }
  if (scenario === 'edited') order.estimatedCompletionAt = '2026-11-15T10:00:00.000Z';
  if (scenario === 'missing-created') delete order.createdAt;
  if (scenario === 'package') order.pricing.breakdown = [{ kind: 'PACKAGE', quantity: 1, pairs: 3, priceIdr: 130000, totalIdr: 130000 }];
  if (scenario === 'mixed') { order.items[1].serviceName = 'Reguler'; order.pricing.breakdown.push({ kind: 'PACKAGE', quantity: 1, pairs: 3, priceIdr: 130000, totalIdr: 130000 }); }
  if (scenario === 'historic') { order.pricing.calculationMatches = false; order.pricing.breakdown = []; order.pricing.basis = 'HISTORICAL_AGREEMENT'; order.pricing.lockedAt = '2026-11-11T10:00:00Z'; }
  if (scenario === 'legacy') { order.pricing = null; order.items[1].serviceName = 'Reguler'; delete order.items[1].risk; }
  if (scenario === 'nonzero') order.items[1].finalPriceIdr = 100;
  if (scenario === 'pending') order.pricing.stage = 'ESTIMATE';
  await context.route('**/api/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/information-fixture') return route.fulfill({ json: order });
    unexpected.push(route.request().url()); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5173/track/information-fixture');
  const info = page.locator('.summary-info'), payment = page.locator('.summary-payment');
  await expect(info.locator(':scope > :is(h2, p, div, h3, ul, section)')).toHaveCount(7);
  const ordering = await info.locator(':scope > *').evaluateAll(nodes => nodes.map(node => node.className || node.id));
  expect(ordering).toEqual(['summary-heading', 'service-snapshot', 'price-snapshot', expect.stringContaining('summary-eta'), 'progress-title', 'progress-counts', 'customer-notes']);
  if (['package', 'mixed'].includes(scenario)) {
    await expect(info.locator('.price-snapshot')).toContainText(scenario === 'pending' ? 'Estimasi Harga:' : 'Harga:');
    await expect(info.locator('.price-lines li')).toHaveText(scenario === 'package' ? ['paket 3 pasang : Rp130.000'] : ['paket 1 pasang : Rp80.000', 'paket 3 pasang : Rp130.000']);
    await expect(info.locator('.price-snapshot')).not.toContainText('Rp43.333');
  } else if (scenario === 'historic') await expect(info.locator('.price-snapshot')).toContainText('Alokasi historis tersimpan');
  else if (scenario === 'legacy') await expect(info.locator('.price-snapshot')).toContainText('Tarif layanan lama');
  else await expect(info.locator('.price-snapshot')).toHaveText(`${scenario === 'pending' ? 'Estimasi Harga:' : 'Harga:'} Rp80.000/pasang`);
  await expect(info.locator('.price-lines')).toHaveCount(['package', 'mixed'].includes(scenario) ? 1 : 0);
  await expect(info.locator('.price-snapshot')).not.toContainText('· estimasi');
  if (scenario === 'late') await expect(info.locator('.summary-eta h3')).toHaveText('Estimasi Selesai: 2 hari kalender · melewati batas 17:00 WIB');
  else if (['edited', 'missing-created', 'legacy'].includes(scenario)) await expect(info.locator('.summary-eta h3')).toHaveText('Estimasi Selesai:');
  else await expect(info.locator('.summary-eta h3')).toHaveText('Estimasi Selesai: 1 hari kalender · nextday');
  await expect(info.locator('.completion')).toContainText('| 17:00 WIB.');
  await expect(info.locator('.progress-counts')).toHaveCSS('list-style-type', 'disc');
  await expect(info.locator('.progress-counts li')).toHaveText(['1 pasang sepatu selesai dicuci', `1 pasang sepatu tidak dicuci${scenario === 'nonzero' ? '' : ' — tanpa biaya pencucian'}`]);
  await expect(info.locator('.customer-notes')).toContainText('Sepatu 2 (<em>Adidas</em>) — tidak dicuci');
  await expect(info.locator('.customer-notes em')).toHaveCount(0);
  await expect(info.locator('.customer-notes')).toContainText('Pencucian tidak dilanjutkan setelah pemeriksaan staf.');
  if (scenario !== 'legacy') await expect(info.locator('.customer-notes')).toContainText('Risiko publik asli: warna dapat memudar.');
  await expect(page.locator('main')).not.toContainText(/INTERNAL_INSPECTION|INTERNAL_HISTORY|tidak layak|pelanggan mengonfirmasi/);
  await expect(payment).not.toContainText(/pasang ditolak\/dibatalkan|Mengikuti harga yang disepakati sebelumnya\./);
  if (scenario === 'legacy') await expect(info.locator('.service-snapshot')).toHaveText('Layanan — Campuran · sesuai rincian sepatu');
  if (scenario === 'mixed') await expect(page.locator('article .eyebrow').nth(1)).toHaveText('Sepatu 2 · Reguler');
  await expect(payment.getByLabel('Status Pembayaran')).toHaveText('Dibayar Sebagian');
  await expect(payment.getByLabel('Status Pembayaran')).toHaveCSS('color', 'rgb(121, 82, 11)');
  const primary = await info.evaluate(node => getComputedStyle(node).color);
  expect(primary).toBe('rgb(24, 44, 73)');
  for (const selector of ['.service-snapshot', '.summary-eta', '.summary-eta h3']) {
    await expect(info.locator(selector)).toHaveCSS('color', primary);
  }
  for (const selector of ['.price-snapshot', '.completion']) await expect(info.locator(selector)).toHaveCSS('color', 'rgb(86, 103, 126)');
  for (const selector of ['.service-snapshot', '.summary-eta h3', '.progress-title']) {
    await expect(info.locator(selector)).toHaveCSS('font-size', '15px');
    await expect(info.locator(selector)).toHaveCSS('font-weight', '700');
  }
  for (const selector of ['.price-snapshot', '.summary-eta', '.completion']) await expect(info.locator(selector)).toHaveCSS('font-size', '14px');
  if (scenario !== 'legacy') await expect(info.locator('.service-snapshot')).toHaveText('Layanan — Fast');
  await expect(info.locator('.summary-eta h3')).toContainText('Estimasi Selesai:');
  await expect(info.locator('.completion')).toHaveCSS('font-weight', '400');
  await expect(payment).toHaveCSS('display', 'flex');
  await expect(payment).toHaveCSS('flex-direction', 'column');
  const placement = await payment.evaluate(node => {
    const note = node.querySelector('.online-note'), previous = note.previousElementSibling;
    const card = node.getBoundingClientRect(), box = note.getBoundingClientRect(), before = previous.getBoundingClientRect();
    const style = getComputedStyle(node), noteStyle = getComputedStyle(note);
    return { last: note === node.lastElementChild, bottom: card.bottom - box.bottom, padding: parseFloat(style.paddingBottom), gap: box.top + parseFloat(noteStyle.paddingTop) - before.bottom, margin: parseFloat(noteStyle.marginTop), minHeight: style.minHeight, height: card.height };
  });
  expect(placement.last).toBe(true);
  expect(Math.abs(placement.bottom - placement.padding)).toBeLessThan(1);
  expect(placement.gap).toBeGreaterThanOrEqual(16);
  expect(placement.minHeight).toBe('auto');
  if (width === 320) { expect(placement.margin).toBe(0); expect(placement.height).toBeLessThan(650); }
  else if (scenario === 'fast') expect(placement.margin).toBeGreaterThan(16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});

for (const width of [320, 390, 1440]) for (const stage of ['ESTIMATE', 'FINAL']) test(`mixed package labels ${stage} ${width}`, async ({ page, context }) => {
  const unexpected = [], errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const order = {
    number: 'CS-MIXED-LABELS', createdAt: '2026-11-11T04:00:00Z', estimatedCompletionAt: '2026-11-15T16:59:59.999Z',
    aggregateStatus: stage === 'ESTIMATE' ? 'RECEIVED' : 'READY_FOR_PICKUP',
    totalIdr: 195000, paidIdr: 0, balanceIdr: 195000, paymentStatus: 'UNPAID', pickupInstructions: '',
    pricing: { version: 2, name: 'Normal', turnaroundPolicy: 'REGULAR', stage, pairs: 4, initialTotalIdr: 195000, totalIdr: 195000, calculationMatches: true, breakdown: [
      { kind: 'PACKAGE', quantity: 1, pairs: 3, priceIdr: 145000, totalIdr: 145000 },
      { kind: 'PACKAGE', quantity: 1, pairs: 1, priceIdr: 50000, totalIdr: 50000 },
    ] },
    items: Array.from({ length: 4 }, (_, index) => ({ id: `shoe-${index}`, brand: 'Nike', serviceName: 'Normal', status: stage === 'ESTIMATE' ? 'RECEIVED' : 'READY_FOR_PICKUP', outcome: stage === 'ESTIMATE' ? null : 'APPROVED', finalPriceIdr: stage === 'ESTIMATE' ? null : 48750, photos: [], consents: [], timeline: [] })),
  };
  await context.route('**/api/**', async route => {
    if (route.request().method() === 'GET' && new URL(route.request().url()).pathname === '/api/v1/track/mixed-labels-fixture') return route.fulfill({ json: order });
    unexpected.push(route.request().url()); return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  await page.setViewportSize({ width, height: 900 });
  await page.goto('http://127.0.0.1:5173/track/mixed-labels-fixture');
  const price = page.locator('.price-snapshot'), eta = page.locator('.summary-eta');
  await expect(price).toContainText(stage === 'ESTIMATE' ? 'Estimasi Harga:' : 'Harga:');
  await expect(price.locator('.price-lines li')).toHaveText(['paket 3 pasang : Rp145.000', 'paket 1 pasang : Rp50.000']);
  await expect(price).not.toContainText('· estimasi');
  await expect(eta.locator('h3')).toHaveText('Estimasi Selesai:');
  await expect(eta).toHaveClass(stage === 'ESTIMATE' ? 'summary-eta' : 'summary-eta inactive');
  await expect(eta.locator('.completion')).toContainText('Minggu, 15 November 2026 | 23:59 WIB.');
  const layout = await price.evaluate(node => {
    const range = document.createRange(); range.selectNodeContents(node);
    const lines = [...range.getClientRects()], box = node.getBoundingClientRect();
    return { lines: lines.length, contained: lines.every(line => line.left >= box.left - 1 && line.right <= box.right + 1), bottom: box.bottom };
  });
  if (width < 400) expect(layout.lines).toBeGreaterThan(1);
  expect(layout.contained).toBe(true);
  expect((await eta.boundingBox()).y).toBeGreaterThanOrEqual(layout.bottom);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(unexpected).toEqual([]); expect(errors).toEqual([]);
});
