import process from 'node:process';
import { test, expect } from '@playwright/test';

const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const record = { id: 'audit-test', actorUserId: 'owner-test', actorUser: { name: 'Pemilik Uji' }, action: 'HTTP_REQUEST', entityType: 'Order', entityId: 'order-test', createdAt: '2026-11-11T08:00:00Z', metadata: { outcome: 'FAILED', requestId: 'request-test', errorCode: 'VALIDATION_ERROR', status: 400, method: 'PATCH', route: '/api/v1/settings', note: '<img src=x onerror=alert(1)>' } };
async function fixture(page, role = 'OWNER', records = [record, { ...record, id: 'audit-legacy', actorUserId: 'legacy-user', actorUser: null, metadata: {} }]) {
  const queries = []; const unexpected = [];
  let fail = false; let empty = false; let reason = 'BROWSER_PROFILE_LOCKED';
  await page.route('**/*', async route => {
    const request = route.request(); const url = new URL(request.url());
    if (url.origin === origin && !url.pathname.startsWith('/api/')) return route.continue();
    const path = url.pathname.replace('/api/v1', '');
    let body;
    if (url.origin !== origin || request.method() !== 'GET') { unexpected.push(request.url()); return route.abort(); }
    if (path === '/auth/me') body = { user: { id: 'owner-test', name: 'Akun Uji', role }, csrfToken: 'test-only' };
    else if (path === '/display-settings') body = { statusLabels: {} };
    else if (path === '/dashboard') body = {};
    else if (path === '/orders' || path === '/notifications') body = { data: [], page: { nextCursor: null } };
    else if (path === '/whatsapp/status') body = { state: 'error', ready: false, realSendEnabled: false, provider: 'whatsapp-web.js', error: reason, lastCommand: { command: 'start', status: 'failed', error: reason } };
    else if (path === '/audit') {
      queries.push(Object.fromEntries(url.searchParams));
      if (fail) return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE', message: 'Audit sementara tidak tersedia.' } } });
      const second = url.searchParams.has('cursor');
      body = { data: empty ? [] : second ? [{ ...record, id: 'audit-system', actorUserId: null, actorUser: null, metadata: null }] : records, page: { nextCursor: !empty && !second ? 'cursor-test' : null } };
    } else { unexpected.push(request.url()); return route.abort(); }
    return route.fulfill({ json: body });
  });
  await page.goto(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Ringkasan', exact: true })).toBeVisible();
  return { queries, unexpected, fail(value) { fail = value; }, empty() { empty = true; }, reason(value) { reason = value; } };
}
async function openAudit(page) { await page.getByRole('button', { name: 'Audit', exact: true }).click(); await expect(page.getByRole('list', { name: 'Catatan audit' }).getByRole('listitem')).toHaveCount(2); }
const apply = page => page.getByRole('button', { name: 'Terapkan / muat ulang', exact: true });

test('audit readable actor/time, escaped expandable metadata, legacy fallback, request correlation', async ({ page }) => {
  const mock = await fixture(page); await openAudit(page);
  const list = page.getByRole('list', { name: 'Catatan audit' });
  await expect(list).toContainText('Pemilik Uji'); await expect(list).toContainText('Pengguna lama');
  await expect(list).toContainText('15.00'); await expect(list).toContainText('WIB');
  await expect(list).toContainText('Gagal'); await expect(list).toContainText('VALIDATION_ERROR');
  await expect(list.locator('details').first()).not.toHaveAttribute('open', '');
  await list.locator('summary').first().click();
  await expect(list.locator('pre').first()).toContainText('"status": 400');
  await expect(list.locator('pre').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(list.locator('img')).toHaveCount(0);
  await list.getByRole('button', { name: 'Lihat aktivitas terkait', exact: true }).first().click();
  await expect.poll(() => mock.queries.at(-1)).toEqual({ limit: '25', requestId: 'request-test' });
  expect(mock.unexpected).toEqual([]);
});

test('historical WhatsApp error lifecycle displays failure without rewriting metadata', async ({ page }) => {
  const mock = await fixture(page, 'OWNER', [{ ...record, action: 'WA_STATE_CHANGED', metadata: { fromState: 'starting', state: 'error', reason: 'INITIALIZATION_FAILED' } }]);
  await page.getByRole('button', { name: 'Audit', exact: true }).click();
  const row = page.getByRole('list', { name: 'Catatan audit' }).getByRole('listitem');
  await expect(row.locator('.audit-outcome')).toHaveText('Gagal');
  await row.locator('summary').click();
  await expect(row.locator('pre')).not.toContainText('"outcome"');
  expect(mock.unexpected).toEqual([]);
});

for (const width of [1440, 768, 390, 320]) {
  test(`audit compact layout ${width}px; friendly labels, technical IDs and correlation`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const longId = 'a'.repeat(160);
    const mock = await fixture(page, 'OWNER', [
      { ...record, action: 'API_ACTIVITY', entityType: 'Request', entityId: null, metadata: { method: 'PATCH', route: '/api/v1/settings', status: 200, outcome: 'SUCCESS', requestId: longId } },
      { ...record, id: 'audit-settings', action: 'SETTINGS_UPDATED', metadata: null },
      { ...record, id: 'audit-future', action: 'FUTURE_ACTION', actorUser: { name: 'Nama pengguna panjang untuk menguji pembungkusan teks' } },
    ]);
    await page.getByRole('button', { name: 'Audit', exact: true }).click();
    const list = page.getByRole('list', { name: 'Catatan audit' });
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Permintaan API');
    await expect(rows.nth(0)).toContainText('PATCH · /api/v1/settings · HTTP 200');
    await expect(rows.nth(1)).toContainText('Pengaturan diperbarui');
    await expect(rows.nth(1)).toContainText('Tidak tercatat');
    await expect(rows.nth(2)).toContainText('Aktivitas lainnya');
    await expect(rows.nth(2).locator('.danger-text')).toContainText('VALIDATION_ERROR');
    await expect(rows.nth(0).getByText(longId, { exact: true })).not.toBeVisible();
    await expect(rows.nth(0).getByText('API_ACTIVITY', { exact: true })).not.toBeVisible();
    await expect(rows.nth(0).locator('summary')).toHaveText('Detail teknis');
    const boxes = await rows.nth(0).locator('.audit-row > *').evaluateAll(nodes => nodes.map(node => {
      const { x, y, width, height } = node.getBoundingClientRect(); return { x, y, width, height };
    }));
    const rowBox = await rows.nth(0).boundingBox();
    expect(boxes[0].x - rowBox.x).toBeGreaterThanOrEqual(16);
    expect(rowBox.height).toBeLessThan(width === 320 ? 210 : 185);
    if (width === 1440) {
      await expect(page.locator('.audit-columns')).toBeVisible();
      const headings = await page.locator('.audit-columns > span').evaluateAll(nodes => nodes.map(node => node.getBoundingClientRect().x));
      boxes.forEach((box, i) => expect(Math.abs(box.x - headings[i])).toBeLessThan(2));
      expect(Math.max(...boxes.map(box => box.y)) - Math.min(...boxes.map(box => box.y))).toBeLessThan(2);
    } else {
      await expect(page.locator('.audit-columns')).not.toBeVisible();
      expect(boxes[2].y).toBeGreaterThan(boxes[1].y);
    }
    await rows.nth(0).locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(rows.nth(0).getByText(longId, { exact: true })).toBeVisible();
    await expect(rows.nth(0).getByText('API_ACTIVITY', { exact: true })).toBeVisible();
    await rows.nth(1).locator('summary').click();
    await expect(rows.nth(1)).toContainText('Tidak ada metadata.');
    await rows.nth(2).locator('summary').click();
    await expect(rows.nth(2).getByText('FUTURE_ACTION', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await rows.nth(0).getByRole('button', { name: 'Lihat aktivitas terkait' }).click();
    await expect.poll(() => mock.queries.at(-1)).toEqual({ limit: '25', requestId: longId });
    expect(mock.unexpected).toEqual([]);
  });
}

test('audit applies all filters; pagination retains applied values; reset clears cursor', async ({ page }) => {
  const mock = await fixture(page); await openAudit(page);
  await page.getByLabel('Cari aksi / entitas / ID').fill('order');
  await page.getByLabel('Aksi', { exact: true }).fill('HTTP_REQUEST');
  await page.getByLabel('Jenis entitas').fill('Order');
  await page.getByLabel('Hasil', { exact: true }).selectOption('FAILED');
  await page.getByLabel('ID permintaan', { exact: true }).fill('request-test');
  await page.getByLabel('Dari', { exact: true }).fill('2026-11-10T00:00');
  await page.getByLabel('Sampai', { exact: true }).fill('2026-11-12T00:00');
  await apply(page).click();
  await expect.poll(() => mock.queries.at(-1)?.q).toBe('order');
  const applied = { ...mock.queries.at(-1) };
  expect(applied).toMatchObject({ action: 'HTTP_REQUEST', entityType: 'Order', outcome: 'FAILED', requestId: 'request-test' });
  expect(Number.isFinite(Date.parse(applied.from))).toBe(true); expect(Number.isFinite(Date.parse(applied.to))).toBe(true);
  await page.getByLabel('Aksi', { exact: true }).fill('UNAPPLIED');
  await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page.getByText('Halaman 2', { exact: true })).toBeVisible();
  expect(mock.queries.at(-1)).toEqual({ ...applied, cursor: 'cursor-test' });
  await expect(page.getByRole('list', { name: 'Catatan audit' })).toContainText('Sistem');
  await page.getByRole('button', { name: 'Sebelumnya', exact: true }).click();
  await expect(page.getByText('Halaman 1', { exact: true })).toBeVisible();
  expect(mock.queries.at(-1)).toEqual(applied);
  await page.getByRole('button', { name: 'Reset filter' }).click();
  await expect.poll(() => mock.queries.at(-1)).toEqual({ limit: '25' });
  await expect(page.getByLabel('Hasil', { exact: true })).toHaveValue('');
  expect(mock.unexpected).toEqual([]);
});

test('audit invalid date range, failed pagination, retry and empty results', async ({ page }) => {
  const mock = await fixture(page); await openAudit(page);
  await page.getByLabel('Dari', { exact: true }).fill('2026-11-12T00:00');
  await page.getByLabel('Sampai', { exact: true }).fill('2026-11-10T00:00');
  await apply(page).click(); await expect(page.getByRole('alert')).toContainText('Waktu mulai');
  expect(mock.queries).toHaveLength(1);
  mock.fail(true);
  await page.getByRole('button', { name: 'Berikutnya', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Audit sementara tidak tersedia');
  await expect(page.getByText('Halaman 1', { exact: true })).toBeVisible();
  await expect(page.getByText('Tidak ada catatan audit.', { exact: true })).toHaveCount(0);
  mock.fail(false); mock.empty();
  await page.getByRole('button', { name: 'Reset filter' }).click();
  await expect(page.getByText('Tidak ada catatan audit.', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Berikutnya', exact: true })).toBeDisabled();
  expect(mock.unexpected).toEqual([]);
});

test('audit mobile filters remain reachable; admin cannot see audit', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const mock = await fixture(page); await openAudit(page);
  await page.getByLabel('Hasil', { exact: true }).selectOption('SUCCESS');
  await apply(page).click(); await expect.poll(() => mock.queries.at(-1)?.outcome).toBe('SUCCESS');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.unrouteAll({ behavior: 'wait' });
  const admin = await fixture(page, 'ADMIN');
  await expect(page.getByRole('button', { name: 'Audit', exact: true })).toHaveCount(0);
  expect(mock.unexpected).toEqual([]); expect(admin.unexpected).toEqual([]);
});

for (const [code, text] of [
  ['BROWSER_PROFILE_LOCKED', 'Sesi browser sedang dipakai'],
  ['BROWSER_PERMISSION_DENIED', 'Browser tidak memiliki izin akses'],
  ['BROWSER_NOT_FOUND', 'Browser tidak ditemukan'],
  ['BROWSER_SANDBOX_FAILED', 'Perlindungan sandbox browser gagal'],
  ['WHATSAPP_NETWORK_FAILED', 'Jaringan WhatsApp bermasalah'],
  ['INITIALIZATION_TIMEOUT', 'Penyiapan koneksi melewati batas waktu'],
  ['BROWSER_LAUNCH_FAILED', 'Browser gagal berjalan atau tertutup'],
  ['INVALID_COMMAND', 'Perintah tidak dikenali'],
  ['FORBIDDEN', 'Perintah tidak diizinkan'],
]) {
  test(`safe WhatsApp diagnostic ${code}; read only`, async ({ page }) => {
    const mock = await fixture(page); mock.reason(code);
    await page.getByRole('button', { name: 'WhatsApp', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText(text);
    await expect(page.getByText('Perintah gagal.', { exact: false })).toContainText(text);
    expect(mock.unexpected).toEqual([]);
  });
}
