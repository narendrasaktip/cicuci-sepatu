import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import express, { type RequestHandler } from 'express';
import sharp from 'sharp';
import type { Tx } from '../src/repositories/orders.js';

test('new photo WebP bytes, orientation, bounds, metadata, fail-closed writes and private serving; memory only', async () => {
  const item = { id: 'shoe', orderId: 'order', assignedUserId: 'staff', status: 'RECEIVED', inspection: null as object | null, photos: [] as object[], order: { archivedAt: null } };
  const photos: { id: string; itemId: string; kind: string; mime: string; customerVisible: boolean; content: Buffer }[] = [];
  let audits = 0;
  const fake = {
    $queryRaw: async () => [{ id: 'order', archivedAt: null }],
    orderItem: { findUnique: async () => item },
    order: { findUnique: async ({ where }: { where: { trackingHash: string } }) => where.trackingHash === hash('a'.repeat(64)) ? { id: 'order' } : null },
    photo: {
      create: async ({ data }: { data: Omit<typeof photos[number], 'id'> }) => { const photo = { ...data, id: `photo${photos.length}` }; photos.push(photo); return photo; },
      findUnique: async ({ where }: { where: { id: string } }) => { const photo = photos.find(p => p.id === where.id); return photo ? { ...photo, item: { assignedUserId: item.assignedUserId } } : null; },
      findFirst: async ({ where }: { where: { id: string; item: { orderId: string }; customerVisible: boolean; kind: { in: string[] } } }) => photos.find(p => p.id === where.id && where.item.orderId === 'order' && p.customerVisible === where.customerVisible && where.kind.in.includes(p.kind)),
      delete: async () => { throw Error('Unexpected evidence deletion'); },
    },
    auditLog: { create: async () => { audits++; } },
  };
  const key = Symbol.for('cicuci.photo.optimization'); Reflect.set(globalThis, key, fake);
  // Hooks precede ALL service/controller imports. No config, real DB, Redis or WA module can load.
  const hook = registerHooks({ resolve(s, c, next) {
    if (/(?:^|\/)db\.js$/.test(s)) return { url: 'data:text/javascript,export const db=globalThis[Symbol.for("cicuci.photo.optimization")]', shortCircuit: true };
    if (/(?:^|\/)config\.js$/.test(s)) return { url: 'data:text/javascript,export const config={APP_BASE_URL:"http://invalid.test",NODE_ENV:"test"}', shortCircuit: true };
    if (s.endsWith('/lib/whatsapp-control.js')) return { url: 'data:text/javascript,export function notificationBlocker(){throw Error("Forbidden WhatsApp access")}', shortCircuit: true };
    if (/whatsapp\/|ioredis|bullmq|dotenv/.test(s)) throw Error(`Forbidden runtime import: ${s}`);
    return next(s, c);
  } });
  const { createHash } = await import('node:crypto');
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  try {
    const { uploadPhoto, deletePhoto, validateImage, optimizeImage } = await import('../src/services/photos.js');
    const { operations, publicApi } = await import('../src/controllers/operations.js');
    const actor = { id: 'owner', role: 'OWNER' as const }; const tx = fake as unknown as Tx;
    async function upload(bytes: Buffer, mime: 'image/png' | 'image/jpeg' = 'image/png', extra = {}) {
      return uploadPhoto(tx, 'shoe', { kind: 'BEFORE', customerVisible: true, mime, base64: bytes.toString('base64'), ...extra }, actor);
    }
    const source = await sharp({ create: { width: 2400, height: 1200, channels: 3, background: '#714d35' } }).png().toBuffer();
    const first = await upload(source);
    assert.equal(first.mime, 'image/webp'); assert.equal(photos.length, 1); assert.equal(audits, 1);
    const stored = photos[0]!; assert.notDeepEqual(stored.content, source);
    assert.equal(stored.content.toString('ascii', 0, 4), 'RIFF'); assert.equal(stored.content.toString('ascii', 8, 12), 'WEBP');
    let meta = await sharp(stored.content).metadata(); assert.equal(meta.format, 'webp'); assert.equal(meta.width, 1600); assert.equal(meta.height, 800);
    const small = await sharp({ create: { width: 40, height: 80, channels: 3, background: '#abcdef' } }).png().toBuffer();
    await upload(small); meta = await sharp(photos.at(-1)!.content).metadata(); assert.equal(meta.width, 40); assert.equal(meta.height, 80);
    const oriented = await sharp(source).withMetadata({ orientation: 6 }).jpeg().toBuffer();
    assert.equal((await sharp(oriented).metadata()).orientation, 6);
    await upload(oriented, 'image/jpeg'); meta = await sharp(photos.at(-1)!.content).metadata();
    assert.equal(meta.width, 800); assert.equal(meta.height, 1600);
    for (const field of ['exif', 'icc', 'iptc', 'xmp', 'orientation'] as const) assert.equal(meta[field], undefined);

    // The old JPEG structural checker accepts this incomplete scan; the decoder must reject it without saving.
    const corrupt = Buffer.from('ffd8ffc00011080001000103012200021101031101ffda000c03010002110311003f00ffd9', 'hex');
    validateImage(corrupt.toString('base64'), 'image/jpeg');
    const before = photos.length;
    await assert.rejects(upload(corrupt, 'image/jpeg'), /UPLOAD_INVALID/); assert.equal(photos.length, before); assert.equal(audits, before);
    await assert.rejects(optimizeImage(Buffer.from('not an image')), /UPLOAD_INVALID/);
    const oversized = await sharp({ create: { width: 4001, height: 4000, channels: 3, background: '#000000' } }).png().toBuffer();
    assert.throws(() => validateImage(oversized.toString('base64'), 'image/png'), /UPLOAD_INVALID/);
    await assert.rejects(optimizeImage(oversized), /UPLOAD_INVALID/);
    await assert.rejects(upload(small, 'image/jpeg'), /UPLOAD_INVALID/);
    await assert.rejects(upload(small, 'image/png', { kind: 'INSPECTION' }), /PRIVATE_INSPECTION/);
    item.status = 'HANDED_OVER'; await assert.rejects(upload(small), /ITEM_CLOSED/); item.status = 'RECEIVED';
    item.photos = Array.from({ length: 20 }, () => ({})); await assert.rejects(upload(small), /PHOTO_LIMIT/); item.photos = [];
    await assert.rejects(uploadPhoto(tx, 'shoe', { kind: 'BEFORE', customerVisible: true, mime: 'image/png', base64: small.toString('base64') }, { id: 'other', role: 'STAFF' }), /FORBIDDEN/);
    item.inspection = {}; await assert.rejects(deletePhoto(tx, stored.id, actor), /EVIDENCE_LOCKED/); item.inspection = null;
    item.status = 'READY_FOR_PICKUP'; await assert.rejects(deletePhoto(tx, stored.id, actor), /PHOTO_LOCKED/); item.status = 'RECEIVED';

    // Invoke actual route handlers with memory request/response doubles: no HTTP server/network.
    async function serve(router: typeof operations, path: string, id: string, role = 'OWNER', token = 'a'.repeat(64)) {
      const stack = (router as unknown as { stack: { route?: { path: string; methods: { get?: boolean }; stack: { handle: RequestHandler }[] } }[] }).stack;
      const handler = stack.find(layer => layer.route?.path === path && layer.route.methods.get)!.route!.stack.at(-1)!.handle;
      let mime = ''; let bytes: Buffer | undefined;
      await new Promise<void>((resolve, reject) => {
        const response = { locals: { session: { user: { id: role === 'STAFF' ? 'other' : 'owner', role } } }, type(value: string) { mime = value; return this; }, set() { return this; }, send(value: Buffer) { bytes = value; resolve(); return this; } };
        handler({ query: {}, params: { id, token } } as unknown as express.Request, response as unknown as express.Response, reject);
      });
      return { mime, bytes };
    }
    for (const [router, path] of [[operations, '/photos/:id'], [publicApi, '/track/:token/photos/:id']] as const) {
      const result = await serve(router, path, stored.id); assert.equal(result.mime, 'image/webp'); assert.deepEqual(result.bytes, stored.content);
    }
    await assert.rejects(serve(operations, '/photos/:id', stored.id, 'STAFF'), /FORBIDDEN/);
    await assert.rejects(serve(publicApi, '/track/:token/photos/:id', stored.id, 'OWNER', 'b'.repeat(64)), /TOKEN_INVALID/);
    stored.customerVisible = false; await assert.rejects(serve(publicApi, '/track/:token/photos/:id', stored.id), /NOT_FOUND/); stored.customerVisible = true;
    stored.kind = 'INSPECTION'; await assert.rejects(serve(publicApi, '/track/:token/photos/:id', stored.id), /NOT_FOUND/); stored.kind = 'BEFORE';
    const historical = { ...stored, id: 'old', mime: 'image/png', content: small }; photos.push(historical);
    for (const [router, path] of [[operations, '/photos/:id'], [publicApi, '/track/:token/photos/:id']] as const) {
      const result = await serve(router, path, 'old'); assert.equal(result.mime, 'image/png'); assert.deepEqual(result.bytes, small);
    }
    assert.equal(photos.length, before + 1); assert.equal(audits, before);
  } finally { hook.deregister(); Reflect.deleteProperty(globalThis, key); }
});
