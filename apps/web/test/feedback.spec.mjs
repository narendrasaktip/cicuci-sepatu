import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const saved = { rating: 5, review: 'Bersih sekali', createdAt: '2026-11-15T10:00:00Z' };
const tracking = (extra = {}) => ({ number: 'CS-TEST', aggregateStatus: 'COMPLETED', totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'PAID', items: [{ id: 'i', brand: 'Test', status: 'HANDED_OVER', outcome: 'APPROVED', serviceName: 'Reguler', finalPriceIdr: 0, consents: [], photos: [], timeline: [] }], ...extra });
async function mock(context, handler) {
  const unexpected = [];
  await context.route('**/api/v1/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const result = await handler(request, url.pathname.replace('/api/v1', ''), url);
    if (!result) unexpected.push(request.method() + ' ' + url.pathname);
    await route.fulfill(result ?? { status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  return unexpected;
}
for (const extra of [{ feedbackEligible: false, feedback: null }, {}]) test(`tracking hides ineligible/missing eligibility ${JSON.stringify(extra)}`, async ({ page, context }) => {
  const unexpected = await mock(context, (req, path) => req.method() === 'GET' && path === '/track/test' ? { json: tracking(extra) } : undefined);
  await page.goto(origin + '/feedback/test');
  await expect(page.getByText('CS-TEST', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Seberapa Puas Kamu?' })).toHaveCount(0); expect(unexpected).toEqual([]);
});
test('tracking links to separate feedback page without embedded form', async ({ page, context }) => {
  const unexpected = await mock(context, (req, path) => req.method() === 'GET' && path === '/track/test' ? { json: tracking({ feedbackEligible: true, feedback: null }) } : undefined);
  await page.goto(origin + '/track/test');
  await expect(page.getByRole('link', { name: 'Berikan Ulasan' })).toHaveAttribute('href', '/feedback/test');
  await expect(page.getByRole('group', { name: 'Seberapa Puas Kamu?' })).toHaveCount(0);
  await page.getByRole('link', { name: 'Berikan Ulasan' }).click();
  await expect(page.getByRole('group', { name: 'Seberapa Puas Kamu?' })).toBeVisible(); expect(unexpected).toEqual([]);
});
test('invalid token shows error without form', async ({ page, context }) => {
  const unexpected = await mock(context, (req, path) => path === '/track/test' ? { status: 404, json: { error: { message: 'Tautan tidak valid' } } } : undefined);
  await page.goto(origin + '/feedback/test');
  await expect(page.getByRole('alert')).toContainText('Tautan tidak valid');
  await expect(page.getByRole('group', { name: 'Seberapa Puas Kamu?' })).toHaveCount(0); expect(unexpected).toEqual([]);
});
test('existing feedback immutable, escaped, never exposes private list', async ({ page, context }) => {
  const unexpected = await mock(context, (req, path) => req.method() === 'GET' && path === '/track/test' ? { json: tracking({ feedbackEligible: true, feedback: { ...saved, review: '<script>bad()</script>' } }) } : undefined);
  await page.goto(origin + '/feedback/test');
  await expect(page.getByRole('heading', { name: 'Ulasan Terkirim', exact: true })).toBeVisible();
  await expect(page.getByText('<script>bad()</script>', { exact: true })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Seberapa Puas Kamu?' })).toHaveCount(0); expect(unexpected).toEqual([]);
});
test('submit validates, trims, retains error/input, prevents double submit, then thank-you', async ({ page, context }) => {
  const posts = []; let release;
  const unexpected = await mock(context, async (req, path) => {
    if (req.method() === 'GET' && path === '/track/test') return { json: tracking({ feedbackEligible: true, feedback: null }) };
    if (req.method() === 'POST' && path === '/track/test/feedback') {
      posts.push(req.postDataJSON());
      if (posts.length === 1) return { status: 503, json: { error: { message: 'Coba lagi' } } };
      await new Promise(resolve => { release = resolve; });
      return { json: saved };
    }
  });
  await page.goto(origin + '/feedback/test');
  await page.getByRole('radio', { name: '5 bintang — Sangat Puas', exact: true }).check();
  const review = page.getByLabel('Ulasan singkat');
  await expect(review).toHaveAttribute('maxlength', '1000');
  await review.fill('   '); await page.getByRole('button', { name: 'Kirim Ulasan' }).click();
  await expect(page.getByRole('alert')).toContainText('1–1000'); expect(posts).toHaveLength(0);
  await review.fill(' Bersih sekali '); await page.getByRole('button', { name: 'Kirim Ulasan' }).click();
  await expect(page.getByRole('alert')).toContainText('Coba lagi'); await expect(review).toHaveValue(' Bersih sekali ');
  await page.getByRole('button', { name: 'Kirim Ulasan' }).click();
  await expect(page.getByRole('button', { name: 'Mengirim…' })).toBeDisabled();
  await expect(review).toBeDisabled(); await expect.poll(() => posts.length).toBe(2);
  release();
  await expect(page.getByRole('heading', { name: 'Ulasan Terkirim', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Gimana Hasil Cuci Sepatumu?' })).toHaveCount(0);
  await expect(review).toHaveCount(0); expect(posts).toEqual([{ rating: 5, review: 'Bersih sekali', publicationConsent: false }, { rating: 5, review: 'Bersih sekali', publicationConsent: false }]); expect(unexpected).toEqual([]);
});
test('409 blocks retries, refresh retrieves existing feedback', async ({ page, context }) => {
  let duplicate = false; let posts = 0;
  const unexpected = await mock(context, (req, path) => {
    if (req.method() === 'GET' && path === '/track/test') return { json: tracking({ feedbackEligible: !duplicate, feedback: duplicate ? saved : null }) };
    if (req.method() === 'POST' && path === '/track/test/feedback') { posts++; duplicate = true; return { status: 409, json: { error: { code: 'CONFLICT' } } }; }
  });
  await page.goto(origin + '/feedback/test');
  await page.getByRole('radio', { name: '5 bintang — Sangat Puas', exact: true }).check(); await page.getByLabel('Ulasan singkat').fill('Bersih sekali');
  await page.getByRole('button', { name: 'Kirim Ulasan' }).click();
  await expect(page.getByRole('alert')).toContainText('sudah tersimpan'); await expect(page.getByRole('button', { name: 'Kirim Ulasan' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Perbarui Status' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Kembali ke Beranda' })).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Ulasan Terkirim', exact: true })).toBeVisible(); expect(posts).toBe(1); expect(unexpected).toEqual([]);
});
test('feedback mobile layout fits, touch targets stay usable, rating works', async ({ page, context }) => {
  await mock(context, (req, path) => req.method() === 'GET' && path === '/track/test' ? { json: tracking({ feedbackEligible: true, feedback: null }) } : undefined);
  for (const width of [320, 360, 390, 430, 768]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(origin + '/feedback/test');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Gimana Hasil Cuci Sepatumu?');
    const layout = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth > innerWidth,
      stars: [...document.querySelectorAll('.star-choice')].map(el => { const rect = el.getBoundingClientRect(); return { width: rect.width, height: rect.height, left: rect.left, right: rect.right }; }),
      inputSize: getComputedStyle(document.querySelector('textarea')).fontSize,
    }));
    expect(layout.overflow).toBe(false);
    expect(layout.inputSize).toBe('16px');
    for (const star of layout.stars) { expect(star.width).toBeGreaterThanOrEqual(44); expect(star.height).toBeGreaterThanOrEqual(44); expect(star.left).toBeGreaterThanOrEqual(0); expect(star.right).toBeLessThanOrEqual(width); }
    await page.getByRole('radio', { name: '5 bintang — Sangat Puas', exact: true }).check();
    await expect(page.getByRole('radio', { name: '5 bintang — Sangat Puas', exact: true })).toBeChecked();
  }
});

for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`private feedback menu ${role}, pagination and retry`, async ({ page, context }) => {
  const requests = []; let fail = false;
  const unexpected = await mock(context, (req, path, url) => {
    if (req.method() !== 'GET') return;
    if (path === '/auth/me') return { json: { user: { id: 'u', name: 'Test', email: 'test@example.invalid', role }, csrfToken: 'test' } };
    if (path === '/whatsapp/status' && role === 'OWNER') return { json: { state: 'ready', ready: true } };
    if (path === '/display-settings') return { json: { statusLabels: {} } };
    if (path === '/dashboard') return { json: {} };
    if (path === '/orders') return { json: { data: [], page: { nextCursor: null } } };
    if (path === '/feedback' && role !== 'STAFF') {
      requests.push(url.searchParams.get('cursor'));
      if (fail) { fail = false; return { status: 503, json: { error: { message: 'Ulasan gagal' } } }; }
      const second = url.searchParams.get('cursor') === 'next';
      return { json: { data: [{ ...saved, id: second ? 'f2' : 'f1', order: { number: second ? 'CS-2' : 'CS-1', customer: { name: 'Ayu' } } }], page: { nextCursor: second ? null : 'next' } } };
    }
  });
  await page.goto(origin + '/admin');
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Menu', exact: true }); if (await menu.isVisible()) await menu.click();
  const tab = page.getByRole('navigation').getByRole('button', { name: 'Ulasan', exact: true });
  if (role === 'STAFF') { await expect(tab).toHaveCount(0); expect(requests).toEqual([]); }
  else {
    await tab.click(); await expect(page.getByRole('heading', { name: 'CS-1 · Ayu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cari', exact: true })).toHaveCount(0);
    await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'CS-2 · Ayu' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Berikutnya', exact: true })).toBeDisabled();
    fail = true; await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('Ulasan gagal'); await expect(page.getByText('Halaman 2', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'CS-1 · Ayu' })).toBeVisible(); expect(requests).toEqual([null, 'next', null, null]);
  }
  expect(unexpected).toEqual([]);
});
test('sample reviews are labeled and swipe horizontally on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(origin + '/?preview=ulasan#ulasan');
  await expect(page.getByText('PREVIEW — Data contoh, bukan ulasan pelanggan asli.')).toBeVisible();
  await expect(page.locator('.review-card')).toHaveCount(4);
  const layout = await page.locator('.reviews-grid').evaluate(el => ({ swipe: el.scrollWidth > el.clientWidth, overflow: document.documentElement.scrollWidth > innerWidth }));
  expect(layout).toEqual({ swipe: true, overflow: false });
  await page.locator('.reviews-grid').evaluate(el => { el.scrollLeft = el.scrollWidth; });
  await page.locator('.reviews-grid').focus();
  await page.keyboard.press('ArrowRight');
  await expect.poll(() => page.locator('.reviews-grid').evaluate(el => el.scrollLeft)).toBeLessThan(5);
  await page.setViewportSize({ width: 1280, height: 844 });
  expect(await page.locator('.reviews-grid').evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
});

test('public landing has no private feedback menu/request', async ({ page, context }) => {
  const unexpected = await mock(context, (req, path) => req.method() === 'GET' && path === '/public/feedback' ? { json: { data: [{ name: 'A***', rating: 5, review: '<script>Ulasan asli</script>' }] } } : undefined);
  await page.goto(origin + '/');
  await expect(page.getByRole('button', { name: 'Ulasan', exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Kata Pelanggan' })).toBeVisible();
  await expect(page.getByText('A***', { exact: true })).toBeVisible();
  await expect(page.getByText('<script>Ulasan asli</script>', { exact: true })).toBeVisible();
  expect(unexpected).toEqual([]);
});
