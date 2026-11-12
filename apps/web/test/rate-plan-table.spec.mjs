import process from 'node:process';
import { test, expect } from '@playwright/test';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN ?? 'http://127.0.0.1:5173';
const rules = [
  { kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 47000 },
  { kind: 'PACKAGE', minPairs: 4, maxPairs: 4, priceIdr: 160123 },
  { kind: 'PER_PAIR', minPairs: 7, maxPairs: 9, priceIdr: 39001 },
  { kind: 'PER_PAIR', minPairs: 12, maxPairs: null, priceIdr: 38007 },
];
const fastText = 'Estimasi Fast: masuk sampai tepat 17:00:00 WIB selesai besok maksimal 17:00 WIB; lewat 17:00:00 WIB selesai lusa maksimal 17:00 WIB. Hari kalender, termasuk akhir pekan. Bukan hari yang sama atau 24 jam berjalan. Waktu dihitung server saat pesanan tersimpan.';
const regularText = 'Estimasi selesai otomatis: 5 hari kalender, termasuk akhir pekan. Disimpan sebelum 12.00 WIB: hari ini hari ke-1; mulai 12.00 WIB: besok hari ke-1. Tanggal ditentukan server saat pesanan tersimpan.';
const longName = 'TarifKhusus'.repeat(8);
async function start(page, context, role = 'OWNER') {
  const state = { unexpected: [], mutations: [], previews: [], fail: false, empty: false, saveError: false, hold: null, reads: 0, plans: [
    { id: 'fast', name: 'Promo Kilat', isActive: true, revision: 3, turnaroundPolicy: 'FAST', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 80000 }] },
    { id: 'regular', name: 'Fast bernama, kebijakan reguler', isActive: true, revision: 7, turnaroundPolicy: 'REGULAR', rules: structuredClone(rules) },
    { id: 'inactive', name: longName, isActive: false, revision: 2, rules: structuredClone(rules) },
  ] };
  await context.route('**/api/**', async route => {
    const request = route.request(), path = new URL(request.url()).pathname.replace('/api/v1', ''), method = request.method();
    let body;
    if (method === 'GET' && path === '/auth/me') body = { user: { id: 'fixture', name: 'Fixture', role }, csrfToken: 'fixture-only' };
    else if (method === 'GET' && path === '/dashboard') body = {};
    else if (method === 'GET' && path === '/orders') body = { data: [], page: { nextCursor: null } };
    else if (method === 'GET' && path === '/services') body = { data: [{ id: 'legacy', name: 'Layanan historis', isActive: false, basePriceIdr: 999999 }], page: { nextCursor: null } };
    else if (method === 'GET' && path === '/pricing/plans') {
      state.reads++;
      if (state.fail) return route.fulfill({ status: 503, json: { error: { message: 'Tarif fixture gagal.' } } });
      body = state.empty ? [] : state.plans;
    } else if (method === 'POST' && path === '/pricing/preview') {
      state.previews.push(request.postDataJSON()); body = { totalIdr: 98765, breakdown: [] };
    } else if (['POST', 'PATCH', 'DELETE'].includes(method) && /^\/pricing\/plans(?:\/(?:fast|regular|inactive))?$/.test(path)) {
      const input = request.postDataJSON(); state.mutations.push({ method, path, input });
      if (state.hold) await state.hold;
      if (state.saveError) return route.fulfill({ status: 503, json: { error: { message: 'Simpan fixture gagal.' } } });
      if (method === 'DELETE') return route.fulfill({ status: 409, json: { error: { message: 'Fixture dilindungi.' } } });
      if (method === 'POST') state.plans.push({ ...input, id: 'created', revision: 1 });
      else { const index = state.plans.findIndex(p => path.endsWith('/' + p.id)); state.plans[index] = { ...state.plans[index], ...input, revision: input.revision + 1 }; }
      body = { ok: true };
    } else state.unexpected.push(method + ' ' + path);
    await route.fulfill({ status: body === undefined ? 501 : 200, json: body ?? { error: { code: 'UNMOCKED' } } });
  });
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  const menu = page.getByRole('button', { name: 'Menu', exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation').getByRole('button', { name: 'Tarif Pesanan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Promo Kilat', exact: true })).toBeVisible();
  return state;
}
const region = page => page.getByRole('region', { name: 'Daftar tarif, geser untuk kolom lainnya' });
const row = (page, name) => page.locator('.rate-table > table > tbody > tr').filter({ has: page.getByRole('heading', { name, exact: true }) });
const edit = (page, name) => page.getByRole('button', { name: `Ubah tarif ${name}`, exact: true });
const trash = (page, name) => page.getByRole('button', { name: `Hapus tarif ${name}`, exact: true });
function clean(state) { expect(state.unexpected).toEqual([]); }

for (const width of [320, 390, 768, 1440]) test(`compact semantic prices, exact estimate disclosure, keyboard and responsive ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 1000 });
  const state = await start(page, context);
  await expect(page.getByRole('heading', { name: 'Daftar Tarif', exact: true })).toBeVisible();
  await expect(page.getByText('Lanjutan: layanan lama', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Halaman data' })).toHaveCount(0);
  await expect(page.locator('.rate-table > table > thead th')).toHaveText(['Nama Tarif', 'Status', 'Estimasi', 'Rincian Harga', 'Aksi']);
  expect(await page.locator('.rate-table thead th').evaluateAll(els => els.every(el => el.scope === 'col'))).toBe(true);
  await expect(page.locator('.rate-table .badge')).toHaveText(['Aktif', 'Aktif', 'Nonaktif']);
  const regular = row(page, 'Fast bernama, kebijakan reguler');
  await expect(regular.locator('.rate-estimate')).toHaveText('Reguler · 5 hari kalender');
  await expect(row(page, 'Promo Kilat').locator('.rate-estimate')).toHaveText('Fast · batas masuk 17:00 WIB');
  await expect(regular.locator('.rate-rules tbody tr')).toHaveText(['Paket1Rp 47.000total / paket', 'Paket4Rp 160.123total / paket', 'Per pasang7–9Rp 39.001/ pasang', 'Per pasang12–tanpa batasRp 38.007/ pasang']);
  await expect(page.getByText(fastText, { exact: true })).not.toBeVisible();
  expect(await page.locator('.rate-table > table > tbody > tr > th').last().evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath(`rates-${width}.png`), fullPage: true });
  await page.keyboard.press('Tab'); await region(page).focus(); await expect(region(page)).toBeFocused();
  expect(await region(page).evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  const detail = page.getByLabel('Detail estimasi Promo Kilat', { exact: true });
  await detail.focus(); await page.keyboard.press('Enter');
  await expect(page.getByText(fastText, { exact: true })).toBeVisible();
  await detail.press('Enter');
  await page.getByLabel('Detail estimasi Fast bernama, kebijakan reguler', { exact: true }).click();
  await expect(regular.getByText(regularText, { exact: true })).toBeVisible();
  await page.getByLabel('Detail estimasi Fast bernama, kebijakan reguler', { exact: true }).click();
  await page.getByText('Ketentuan tarif & pesanan lama', { exact: true }).click();
  await expect(page.getByText(/Perubahan tarif tidak mengubah harga dan aturan/)).toBeVisible();
  await page.getByText('Ketentuan tarif & pesanan lama', { exact: true }).click();
  await page.keyboard.press('Tab');
  for (const button of [edit(page, 'Promo Kilat'), trash(page, 'Promo Kilat')]) {
    await button.focus(); const box = await button.boundingBox(); expect(box.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(el => el.closest('td') === el.closest('tr').lastElementChild)).toBe(true);
    expect(await button.evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
  }
  await page.screenshot({ path: info.outputPath(`rate-actions-${width}.png`), fullPage: true });
  clean(state); expect(state.mutations).toEqual([]); expect(state.previews).toEqual([]);
});

for (const role of ['OWNER', 'ADMIN', 'STAFF']) test(`rate actions permissions and Classic ${role}`, async ({ page, context }, info) => {
  const state = await start(page, context, role);
  await expect(trash(page, 'Promo Kilat')).toHaveCount(role === 'OWNER' ? 1 : 0);
  await expect(edit(page, 'Promo Kilat')).toHaveCount(role === 'OWNER' ? 1 : 0);
  await expect(page.getByRole('button', { name: 'Tambah Tarif', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
  await page.getByLabel('Tampilan', { exact: true }).selectOption('classic');
  await expect(region(page)).toHaveCount(0);
  const card = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Promo Kilat', exact: true }) });
  await expect(card.getByText(fastText, { exact: true })).toBeVisible();
  await expect(card.getByText(/Paket 1 pasang · harga total paket/)).toBeVisible();
  await expect(card.getByRole('button', { name: 'Ubah tarif / keaktifan', exact: true })).toHaveCount(role === 'OWNER' ? 1 : 0);
  if (role === 'OWNER') await page.screenshot({ path: info.outputPath('classic-rates.png'), fullPage: true });
  clean(state); expect(state.mutations).toEqual([]);
});

test('shared editor preserves raw rules, policy, activation, revision, preview, validation and legacy', async ({ page, context }) => {
  const state = await start(page, context);
  await edit(page, 'Fast bernama, kebijakan reguler').click();
  await expect(page.getByLabel('Nama tarif *')).toHaveValue('Fast bernama, kebijakan reguler');
  await page.getByLabel('Jumlah pasang pratinjau').fill('8');
  await expect.poll(() => state.previews.at(-1)).toEqual({ pairs: 8, rules });
  await page.getByLabel('Waktu penyelesaian').selectOption('FAST');
  await page.getByLabel('Tarif aktif untuk pesanan baru').uncheck();
  await page.getByLabel('Harga total paket (Rp)').first().fill('0');
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
  await page.getByLabel('Harga total paket (Rp)').first().fill('47000');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect.poll(() => state.mutations.length).toBe(1);
  expect(state.mutations[0]).toEqual({ method: 'PATCH', path: '/pricing/plans/regular', input: { name: 'Fast bernama, kebijakan reguler', isActive: false, turnaroundPolicy: 'FAST', revision: 7, rules } });
  await expect(row(page, 'Fast bernama, kebijakan reguler').locator('.badge')).toHaveText('Nonaktif');
  await page.getByRole('button', { name: 'Tambah Tarif', exact: true }).click();
  await page.getByLabel('Nama tarif *').fill('Tarif baru bebas');
  await page.getByLabel('Harga total paket (Rp)').fill('54321');
  await page.getByRole('button', { name: 'Tambah aturan', exact: true }).click();
  await page.getByLabel('Minimal pasang', { exact: true }).fill('5');
  await page.getByLabel('Maksimal pasang (kosong = tanpa batas)').fill('3');
  await expect(page.getByRole('button', { name: 'Simpan', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Hapus aturan 2', exact: true }).click();
  // Native modal intentionally makes the theme selector inert; simulate an external presentation change.
  await page.getByLabel('Tampilan', { exact: true }).evaluate(el => { el.value = 'classic'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByLabel('Nama tarif *')).toHaveValue('Tarif baru bebas');
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  await page.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarif baru bebas', exact: true })).toBeVisible();
  expect(state.mutations[1].input).toEqual({ name: 'Tarif baru bebas', isActive: true, turnaroundPolicy: 'REGULAR', rules: [{ kind: 'PACKAGE', minPairs: 1, maxPairs: 1, priceIdr: 54321 }] });
  await expect(page.getByText('Lanjutan: layanan lama', { exact: true })).toHaveCount(0);
  await page.getByLabel('Tampilan', { exact: true }).selectOption('classic');
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Layanan historis', exact: true })).toBeVisible();
  await page.getByLabel('Tampilan', { exact: true }).selectOption('new');
  await expect(page.getByText('Lanjutan: layanan lama', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Layanan historis', exact: true })).toHaveCount(0);
  await expect(page.getByRole('navigation', { name: 'Halaman data' })).toHaveCount(0);
  clean(state);
});

test('direct delete without confirmation; reload, empty, failure recovery', async ({ page, context }) => {
  const state = await start(page, context);
  await trash(page, 'Promo Kilat').click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('alert')).toContainText('Fixture dilindungi.');
  expect(state.mutations).toEqual([{ method: 'DELETE', path: '/pricing/plans/fast', input: { confirmed: true, confirmation: 'HAPUS' } }]);
  const reload = page.getByRole('button', { name: 'Muat Ulang', exact: true });
  state.empty = true; await reload.click(); await expect(page.getByText('Belum ada tarif.', { exact: true })).toBeVisible();
  state.fail = true; await reload.click(); await expect(page.getByRole('alert')).toContainText('Tarif fixture gagal.');
  state.fail = false; state.empty = false; await reload.click(); await expect(region(page)).toBeVisible();
  clean(state);
});

for (const width of [320, 390, 1440]) test(`rate editor modal focus, cancel, backdrop, responsive ${width}`, async ({ page, context }, info) => {
  await page.setViewportSize({ width, height: 900 });
  const state = await start(page, context);
  const opener = edit(page, 'Fast bernama, kebijakan reguler');
  await opener.click();
  const dialog = page.getByRole('dialog', { name: 'Ubah Tarif Fast bernama, kebijakan reguler', exact: true });
  await expect(dialog).toBeVisible();
  const name = dialog.getByLabel('Nama tarif *');
  await expect(name).toBeFocused();
  await expect(name).toHaveValue('Fast bernama, kebijakan reguler');
  await expect(dialog.getByLabel('Waktu penyelesaian')).toHaveValue('REGULAR');
  await expect(dialog.getByLabel('Harga total paket (Rp)').first()).toHaveValue('47000');
  await expect(dialog.getByLabel('Harga per pasang (Rp)').last()).toHaveValue('38007');
  await page.screenshot({ path: info.outputPath(`edit-${width}.png`), fullPage: true });
  expect(await dialog.evaluate(el => el.scrollWidth <= el.clientWidth && el.getBoundingClientRect().width <= innerWidth && el.getBoundingClientRect().height <= innerHeight * .91)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('button', { name: 'Batal', exact: true })).toBeFocused();
  await page.keyboard.press('Tab'); await expect(name).toBeFocused();
  await page.mouse.click(2, 2); await expect(dialog).toBeVisible();
  await page.keyboard.press('Escape'); await expect(dialog).toHaveCount(0); await expect(opener).toBeFocused();
  await opener.click(); await dialog.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(opener).toBeFocused();
  const add = page.getByRole('button', { name: 'Tambah Tarif', exact: true });
  await add.click();
  const adding = page.getByRole('dialog', { name: 'Tambah Tarif', exact: true });
  await expect(adding.getByLabel('Nama tarif *')).toBeFocused();
  await expect(adding.getByLabel('Nama tarif *')).toHaveValue('');
  await adding.getByRole('button', { name: 'Batal', exact: true }).click();
  await expect(add).toBeFocused();
  clean(state); expect(state.mutations).toEqual([]);
});

test('pending save blocks dismissal and duplicate submit; failure retains draft; successful retry restores opener', async ({ page, context }) => {
  const state = await start(page, context);
  const opener = edit(page, 'Promo Kilat'); await opener.click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Nama tarif *').fill('Draft retained');
  await dialog.getByLabel('Harga total paket (Rp)').fill('81234');
  await dialog.getByLabel('Tarif aktif untuk pesanan baru').uncheck();
  state.saveError = true;
  let release; state.hold = new Promise(resolve => { release = resolve; });
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect.poll(() => state.mutations.length).toBe(1);
  await expect(dialog.getByRole('button', { name: 'Batal', exact: true })).toBeDisabled();
  await expect(dialog.getByLabel('Nama tarif *')).toBeDisabled();
  await page.keyboard.press('Escape'); await page.mouse.click(2, 2);
  await dialog.getByRole('form', { name: 'Editor tarif' }).evaluate(el => { el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); el.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(state.mutations).toHaveLength(1); await expect(dialog).toBeVisible();
  release();
  await expect(dialog.getByRole('alert')).toContainText('Simpan fixture gagal.');
  await expect(dialog.getByLabel('Nama tarif *')).toHaveValue('Draft retained');
  await expect(dialog.getByLabel('Harga total paket (Rp)')).toHaveValue('81234');
  await expect(dialog.getByLabel('Tarif aktif untuk pesanan baru')).not.toBeChecked();
  state.saveError = false; state.hold = null;
  await dialog.getByRole('button', { name: 'Simpan', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(edit(page, 'Draft retained')).toBeFocused();
  expect(state.mutations).toHaveLength(2);
  expect(state.mutations[1].input).toEqual(state.mutations[0].input);
  expect(state.mutations[1].input.revision).toBe(3);
  clean(state);
});
