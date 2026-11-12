import { test, expect } from '@playwright/test';
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'node:crypto';
import process from 'node:process';
import { Buffer } from 'node:buffer';
import { fileURLToPath } from 'node:url';
process.loadEnvFile(fileURLToPath(new URL('../../../.env', import.meta.url)));
const db = new PrismaClient();
const origin = process.env.TEST_WEB_ORIGIN ?? process.env.APP_BASE_URL ?? 'http://127.0.0.1:5173';
const prefix = `web-${randomUUID()}`;
const password = `Browser-${randomUUID()}`;
let owner;
const errors = [];
test.beforeAll(async () => { owner = await db.user.create({ data: { name: prefix, email: `${prefix}@example.test`, passwordHash: await argon2.hash(password), role: 'OWNER' } }); });
test.afterAll(async () => {
  if (!owner) { await db.$disconnect(); return; }
  const customers = await db.customer.findMany({ where: { name: { startsWith: prefix } } });
  const orders = await db.order.findMany({ where: { customerId: { in: customers.map(c => c.id) } } });
  const orderIds = orders.map(o => o.id);
  const items = await db.orderItem.findMany({ where: { orderId: { in: orderIds } } });
  const itemIds = items.map(i => i.id);
  const events = await db.notificationEvent.findMany({ where: { orderId: { in: orderIds } } });
  await db.notificationAttempt.deleteMany({ where: { eventId: { in: events.map(e => e.id) } } });
  await db.notificationEvent.deleteMany({ where: { orderId: { in: orderIds } } });
  for (const model of ['photo', 'consentDecision', 'inspection', 'statusHistory']) await db[model].deleteMany({ where: { itemId: { in: itemIds } } });
  await db.payment.deleteMany({ where: { orderId: { in: orderIds } } });
  await db.orderItem.deleteMany({ where: { id: { in: itemIds } } });
  await db.order.deleteMany({ where: { id: { in: orderIds } } });
  await db.customer.deleteMany({ where: { id: { in: customers.map(c => c.id) } } });
  await db.service.deleteMany({ where: { name: { startsWith: prefix } } });
  const sessions = await db.session.findMany({ where: { userId: owner.id } });
  // Fixture mutation caches are encrypted/session-scoped; remove only captured keys below.
  const { createHash } = await import('node:crypto');
  for (const session of sessions) for (const key of keys) await db.idempotency.deleteMany({ where: { id: createHash('sha256').update(`${owner.id}:${session.csrfToken}:${key}`).digest('hex') } });
  await db.session.deleteMany({ where: { userId: owner.id } });
  await db.auditLog.deleteMany({ where: { OR: [{ actorUserId: owner.id }, { entityId: { in: [...orderIds, ...itemIds, ...events.map(e => e.id)] } }] } });
  await db.user.delete({ where: { id: owner.id } });
  await db.$disconnect();
});
const keys = new Set();
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC', 'base64');
test('real browser: operational multi-shoe workflow, secure public consent, ledger, mobile and WhatsApp blocking', async ({ page, browser }) => {
  test.setTimeout(90000); page.setDefaultTimeout(12000);
  page.on('pageerror', e => errors.push(e.message));
  page.on('request', r => { const key = r.headers()['idempotency-key']; if (key) keys.add(key); });
  await page.goto(`${origin}/admin`);
  await page.getByLabel('Email', { exact: true }).fill(owner.email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Masuk', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Ringkasan', exact: true })).toBeVisible();
  const nav = page.getByRole('navigation', { name: 'Navigasi utama' });
  await nav.getByRole('button', { name: 'Tarif pesanan', exact: true }).click();
  await page.getByText('Lanjutan: layanan lama', { exact: true }).click();
  await page.getByRole('button', { name: 'Layanan baru', exact: true }).last().click();
  await page.getByLabel('Nama *', { exact: true }).fill(`${prefix}-clean`);
  await page.getByLabel('Harga dasar (Rp)').fill('50000');
  await page.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await nav.getByRole('button', { name: 'Pelanggan', exact: true }).click();
  await page.getByRole('button', { name: 'Pelanggan baru', exact: true }).click();
  await page.getByLabel('Nama *', { exact: true }).fill(prefix);
  await page.getByLabel('Nomor WhatsApp').fill('081234567890');
  // Fixture opts out: never enqueue real outbound notifications.
  await page.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await nav.getByRole('button', { name: 'Pesanan', exact: true }).click();
  await page.getByRole('button', { name: 'Pesanan baru', exact: true }).click();
  await page.getByLabel('Cari pelanggan').fill(prefix);
  await page.getByLabel('Cari pelanggan').fill(prefix);
  await page.getByRole('button', { name: `${prefix} · +6281234567890`, exact: true }).click();
  await expect(page.locator('input[type="datetime-local"]')).toHaveCount(0);
  for (let i = 0; i < 3; i++) {
    if (i) await page.getByRole('button', { name: 'Tambah sepatu', exact: true }).click();
    const shoe = page.getByRole('group', { name: `Sepatu ${i + 1}`, exact: true });
    await shoe.getByRole('combobox').selectOption({ value: (await db.service.findFirstOrThrow({ where: { name: `${prefix}-clean` } })).id });
    await shoe.getByLabel('Merek *', { exact: true }).fill('Nike');
    await shoe.getByLabel('Model (opsional)', { exact: true }).fill(`Shoe ${i + 1}`);
    await shoe.getByLabel('Warna (opsional)', { exact: true }).fill('Putih');
  }
  await page.getByRole('button', { name: 'Buat pesanan', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Akses pelanggan' })).toBeVisible();
  await expect(page.getByText('WhatsApp tidak diantrekan.', {exact:false})).toBeVisible();
  const trackLink = await page.getByLabel('Tautan rahasia untuk dibagikan manual').inputValue();
  const shoes = page.locator('article.shoe');
  async function confirm() { await page.getByRole('dialog').getByRole('button', { name: 'Konfirmasi', exact: true }).click(); await expect(page.getByRole('dialog')).not.toBeVisible(); }
  async function step(shoe, name) { await shoe.getByRole('button', { name, exact: true }).click(); await confirm(); }
  for (let i = 0; i < 3; i++) {
    const shoe = shoes.nth(i);
    await shoe.getByRole('button', { name: 'Periksa sepatu', exact: true }).click();
    await page.getByLabel('Hasil pemeriksaan').selectOption(['APPROVED', 'NEEDS_CONSENT', 'REJECTED'][i]);
    await page.getByLabel('Catatan pemeriksaan internal').fill('Bukti diperiksa');
    await page.getByLabel('Foto sebelum pengerjaan', { exact: false }).setInputFiles({ name: 'before.png', mimeType: 'image/png', buffer: png });
    if (i === 1) {
      await page.getByLabel('Risiko untuk pelanggan', { exact: true }).fill('Warna dapat luntur');
      await page.getByLabel('Foto risiko', { exact: false }).setInputFiles({ name: 'risk.png', mimeType: 'image/png', buffer: png });
    }
    await page.getByRole('button', { name: 'Simpan pemeriksaan', exact: true }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  }
  const consentLink = await page.getByLabel('Tautan rahasia untuk dibagikan manual').inputValue();
  expect(consentLink).toContain('#approval=');
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const publicPage = await context.newPage(); publicPage.on('pageerror', e => errors.push(e.message));
  await publicPage.goto(consentLink);
  await expect(publicPage.getByRole('heading', { name: 'Persetujuan risiko diperlukan' })).toBeVisible();
  expect(publicPage.url()).not.toContain('#');
  await expect(publicPage.getByText('Bukti diperiksa')).toHaveCount(0);
  await publicPage.getByRole('button', { name: 'Setujui risiko & biaya' }).click();
  await publicPage.getByRole('button', { name: 'Konfirmasi', exact: true }).click();
  await expect(publicPage.getByRole('dialog')).not.toBeVisible();
  await expect(publicPage.getByText('Keputusan tersimpan.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Muat ulang', exact: true }).click();
  await expect(shoes.nth(1).locator('.badge').getByText('Pemeriksaan · disetujui', { exact: true })).toBeVisible();
  const shoe = shoes.first();
  for (const name of ['Mulai pengerjaan', 'Mulai pengeringan']) await step(shoe, name);
  await shoe.getByRole('button', { name: 'Ulangi pengerjaan', exact: true }).click();
  await page.getByLabel('Alasan gagal QC').fill('Masih ada noda'); await confirm();
  for (const name of ['Mulai pengerjaan', 'Mulai pengeringan']) await step(shoe, name);
  await shoe.getByRole('button', { name: 'Siap diambil', exact: true }).click();
  await page.getByLabel('Foto sesudah pengerjaan', { exact: false }).setInputFiles({ name: 'after.png', mimeType: 'image/png', buffer: png });
  await page.getByLabel('Sepatu sudah kering').check(); await page.getByLabel('Finishing selesai').check(); await page.getByLabel('Lulus pemeriksaan mutu (QC)').check();
  await page.getByRole('button', { name: 'Konfirmasi siap diambil' }).click(); await expect(page.getByRole('dialog')).not.toBeVisible();
  await page.getByRole('button', { name: 'Catat pembayaran', exact: true }).click();
  await expect(page.getByLabel('Jumlah (Rp)')).toHaveValue('100000'); await expect(page.getByLabel('Metode *')).toHaveValue('QRIS'); await confirm();
  await expect(page.getByText('Lunas', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Pengembalian dana', exact: true }).click();
  await page.getByLabel('Jumlah (Rp)').fill('10000'); await page.getByLabel('Metode *').selectOption('CASH'); await page.getByLabel('Alasan *', { exact: true }).fill('Koreksi pembayaran'); await confirm();
  await step(shoes.nth(2), 'Dikembalikan');
  await page.getByRole('button', { name: 'Terbitkan / rotasi tautan', exact: true }).click(); await confirm();
  await publicPage.goto(trackLink); await expect(publicPage.getByRole('alert')).toContainText('TOKEN_INVALID');
  const rotated = await page.getByLabel('Tautan rahasia untuk dibagikan manual').inputValue();
  await publicPage.goto(rotated); await expect(publicPage.getByRole('heading', { name: 'Estimasi & pengambilan' })).toBeVisible();
  expect(await publicPage.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Cabut tautan', exact: true }).click(); await confirm();
  await publicPage.reload(); await expect(publicPage.getByRole('alert')).toContainText('TOKEN_INVALID');
  await nav.getByRole('button', { name: 'WhatsApp', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'WhatsApp toko' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Aktifkan pengiriman', exact: true })).toHaveCount(0);
  await expect(page.getByText('Pengiriman nonaktif.', { exact: false })).toBeVisible();
  for (const name of ['Pengguna', 'Pengaturan', 'Audit']) { await nav.getByRole('button', { name, exact: true }).click(); await expect(page.getByRole('heading', { name, exact: true }).first()).toBeVisible(); }
  await page.setViewportSize({ width: 390, height: 844 });
  await nav.getByRole('button', { name: 'Ringkasan', exact: true }).click();
  expect(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Keluar', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Masuk Cicuci Admin' })).toBeVisible();
  await page.goto(`${origin}/admin?preview=1`); await expect(page.getByText('Fondasi sistem siap.', { exact: false })).toHaveCount(0);
  await context.close(); expect(errors).toEqual([]);
});
