import { test, expect } from '@playwright/test';
import process from 'node:process';

test.use({ serviceWorkers: 'block', launchOptions: { executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
const origin = process.env.TEST_WEB_ORIGIN || 'http://127.0.0.1:5173';

async function mockApi(page) {
  const state = { authenticated: false, status: 401, gate: null, calls: [], unexpected: [], errors: [] };
  page.on('pageerror', error => state.errors.push(error.message));
  await page.route('**/api/**', async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const call = `${request.method()} ${path}`;
    state.calls.push(call);
    if (call === 'GET /api/v1/auth/me') return route.fulfill(state.authenticated
      ? { json: { user: { id: 'login-test', name: 'Login Test', email: 'login@example.test', role: 'OWNER' }, csrfToken: 'test-only' } }
      : { status: 401, json: { error: { code: 'UNAUTHENTICATED' } } });
    if (call === 'POST /api/v1/auth/login') {
      expect(request.postDataJSON()).toEqual({ email: 'login@example.test', password: 'test-password-only' });
      if (state.gate) await state.gate;
      state.authenticated = state.status === 200;
      return route.fulfill({ status: state.status, json: state.authenticated ? {} : { error: { code: 'UNAUTHENTICATED' } } });
    }
    if (state.authenticated && call === 'GET /api/v1/display-settings') return route.fulfill({ json: { statusLabels: {} } });
    if (state.authenticated && call === 'GET /api/v1/dashboard') return route.fulfill({ json: {} });
    if (state.authenticated && call === 'GET /api/v1/orders') return route.fulfill({ json: { data: [], page: { nextCursor: null } } });
    if (call === 'GET /api/v1/track/login-regression') return route.fulfill({ json: {
      number: 'LOGIN-TRACKING', aggregateStatus: 'WAITING_INSPECTION', items: [],
      totalIdr: 0, paidIdr: 0, balanceIdr: 0, paymentStatus: 'UNPAID',
    } });
    state.unexpected.push(call);
    return route.fulfill({ status: 501, json: { error: { code: 'UNMOCKED_API' } } });
  });
  return state;
}

for (const width of [320, 390, 1440]) for (const query of ['', '?preview=1']) {
  test(`login logo/layout without preview at ${width}px ${query || 'root'}`, async ({ page }, testInfo) => {
    const state = await mockApi(page);
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${origin}/admin${query}`);
    await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toBeEnabled();
    const brand = page.getByRole('link', { name: 'Cicuci Sepatu', exact: true });
    await expect(brand).toHaveAttribute('href', '/');
    const logo = brand.getByRole('img', { name: 'Cicuci Sepatu', exact: true });
    await expect(logo).toBeVisible();
    await expect(logo).toHaveAttribute('width', '540');
    await expect(logo).toHaveAttribute('height', '360');
    await expect.poll(() => logo.evaluate(img => img.complete && img.naturalWidth)).toBe(540);
    const dimensions = await logo.evaluate(img => {
      const box = img.getBoundingClientRect();
      return { ratio: box.width / box.height, height: img.naturalHeight, src: img.currentSrc,
        contained: box.left >= 0 && box.right <= innerWidth, overflow: document.documentElement.scrollWidth > innerWidth };
    });
    expect(dimensions.ratio).toBeCloseTo(1.5);
    expect(dimensions.height).toBe(360);
    expect(new URL(dimensions.src).pathname).toMatch(/\/logo(?:-[\w-]+)?\.webp$/);
    expect(dimensions.contained).toBe(true);
    expect(dimensions.overflow).toBe(false);
    await expect(page.locator('a[href*="preview"]')).toHaveCount(0);
    await expect(page.getByText(/Preview dashboard/i)).toHaveCount(0);
    await expect(page.locator('.sidebar')).toHaveCount(0);
    await expect(page.getByRole('alert')).toHaveCount(0);
    await expect(page.locator('.login-page')).toHaveCSS('display', 'grid');
    await expect(page.getByRole('button', { name: 'Masuk', exact: true })).toHaveCSS('background-color', 'rgb(23, 104, 186)');
    await brand.focus();
    await expect(brand).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByLabel('Email', { exact: true })).toBeFocused();
    expect(state.calls).toEqual(['GET /api/v1/auth/me']);
    expect(state.unexpected).toEqual([]);
    expect(state.errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath(`login-${width}${query ? '-preview-query' : ''}.png`), fullPage: true });
  });
}

test('login preserves validation, autocomplete, keyboard, errors, pending and authenticated handoff', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/admin?preview=1`);
  const email = page.getByLabel('Email', { exact: true });
  const password = page.getByLabel('Password', { exact: true });
  const submit = page.getByRole('button', { name: 'Masuk', exact: true });
  await expect(submit).toBeEnabled();
  await expect(email).toHaveAttribute('autocomplete', 'username');
  await expect(password).toHaveAttribute('autocomplete', 'current-password');
  await expect(email).toHaveAttribute('maxlength', '191');
  await expect(password).toHaveAttribute('maxlength', '128');
  await submit.click();
  await expect(email).toBeFocused();
  await email.fill('invalid-email');
  await password.fill('test-password-only');
  await submit.click();
  expect(state.calls).toEqual(['GET /api/v1/auth/me']);
  await email.fill('login@example.test');
  await password.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('alert')).toContainText('UNAUTHENTICATED');
  await expect(submit).toBeEnabled();
  await expect(password).toHaveValue('test-password-only');
  state.status = 200;
  let release;
  state.gate = new Promise(resolve => { release = resolve; });
  await password.focus();
  await page.keyboard.press('Enter');
  try {
    await expect(page.getByRole('button', { name: 'Memuat…', exact: true })).toBeDisabled();
    await expect(page.locator('form')).toHaveAttribute('aria-busy', 'true');
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally { release(); }
  await expect(page.getByRole('navigation', { name: 'Navigasi utama' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
  await expect(page.locator('.login-page')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Terapkan / muat ulang', exact: true })).toBeEnabled();
  expect(state.calls).toEqual(['GET /api/v1/auth/me', 'POST /api/v1/auth/login', 'POST /api/v1/auth/login', 'GET /api/v1/auth/me', 'GET /api/v1/display-settings', 'GET /api/v1/dashboard', 'GET /api/v1/orders']);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('landing/admin/tracking navigation preserves public isolation', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sepatu Kotor?');
  expect(state.calls).toEqual([]);
  await expect(page.getByRole('link', { name: /admin/i })).toHaveCount(0);
  await page.goto(`${origin}/admin`);
  await expect(page).toHaveURL(`${origin}/admin`);
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await page.getByRole('link', { name: 'Cicuci Sepatu', exact: true }).click();
  await expect(page).toHaveURL(`${origin}/`);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Sepatu Kotor?');
  expect(state.calls).toEqual(['GET /api/v1/auth/me']);
  await page.goto(`${origin}/track/login-regression`);
  await expect(page.getByRole('heading', { name: 'Tracking Pesanan', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Tracking Pesanan', exact: true })).toBeVisible();
  expect(state.calls).toEqual(['GET /api/v1/auth/me', 'GET /api/v1/track/login-regression', 'GET /api/v1/track/login-regression']);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});

test('tracking remains public without login/session requests', async ({ page }) => {
  const state = await mockApi(page);
  await page.goto(`${origin}/track/login-regression?preview=1`);
  await expect(page.getByRole('heading', { name: 'Tracking Pesanan', exact: true })).toBeVisible();
  await expect(page.locator('.login-page')).toHaveCount(0);
  expect(state.calls).toEqual(['GET /api/v1/track/login-regression']);
  expect(state.unexpected).toEqual([]);
  expect(state.errors).toEqual([]);
});
