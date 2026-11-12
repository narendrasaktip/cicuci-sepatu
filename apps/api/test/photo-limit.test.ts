import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { Readable } from 'node:stream';
import { test } from 'node:test';
import { deflateSync } from 'node:zlib';
import express from 'express';
import { z } from 'zod';

const max = 10 * 1024 * 1024;
function chunk(type: string, data: Buffer) {
  const bytes = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0); }
  const result = Buffer.alloc(data.length + 12); result.writeUInt32BE(data.length); bytes.copy(result, 4); result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4); return result;
}
function png(size: number) {
  const header = Buffer.alloc(13); header.writeUInt32BE(1); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 6;
  const parts = [Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.alloc(5))), chunk('IEND', Buffer.alloc(0))];
  parts.splice(2, 0, chunk('tEXt', Buffer.alloc(size - parts.reduce((n, b) => n + b.length, 0) - 12, 65)));
  return Buffer.concat(parts);
}

test('10 MiB image boundaries: real service, schema, bounded parsers and client; memory only', async () => {
  // Only pure image functions run. Fail closed before config/DB/orders can load.
  const hooks = registerHooks({ resolve(s, c, next) {
    if (c.parentURL?.endsWith('/services/photos.ts') || c.parentURL?.endsWith('/services/photos.js')) {
      if (s.endsWith('/repositories/orders.js')) return { url: 'data:text/javascript,export function audit(){throw Error("Forbidden audit write")}', shortCircuit: true };
      if (s === './orders.js') return { url: 'data:text/javascript,export class ApiError extends Error{constructor(status,code){super(code);this.status=status;this.code=code}} export function check(v,code,status){if(!v)throw new ApiError(status,code)} export function ownedItem(){throw Error("Forbidden DB access")}', shortCircuit: true };
    }
    if (/\/(lib\/(config|db|whatsapp-control)|integrations\/whatsapp)\//.test(s) || /\/(config|db|whatsapp-control)\.js$/.test(s)) throw Error('Forbidden runtime import');
    return next(s, c);
  } });
  try {
    const { validateImage, optimizeImage } = await import('../src/services/photos.js');
    const exact = png(max); const over = png(max + 1);
    assert.equal(validateImage(exact.toString('base64'), 'image/png').length, max);
    const optimized = await optimizeImage(validateImage(exact.toString('base64'), 'image/png'));
    assert.ok(optimized); assert.equal(optimized.toString('ascii', 8, 12), 'WEBP');
    assert.throws(() => validateImage(over.toString('base64'), 'image/png'), /UPLOAD_INVALID/);
    assert.equal(exact.toString('base64').length, over.toString('base64').length);
    for (const value of ['', 'aGVsbG8=', exact.toString('base64') + '\n']) assert.throws(() => validateImage(value, 'image/png'), /UPLOAD_INVALID/);
    const broken = Buffer.from(exact); broken[40] = broken[40]! ^ 1;
    assert.throws(() => validateImage(broken.toString('base64'), 'image/png'), /UPLOAD_INVALID/);
    assert.throws(() => validateImage(exact.toString('base64'), 'image/jpeg'), /UPLOAD_INVALID/);

    const controller = readFileSync(new URL('../src/controllers/operations.ts', import.meta.url), 'utf8');
    const route = controller.split('\n').find(line => line.startsWith("operations.post('/items/:id/photos'"))!;
    // Evaluate the actual inline schema, not a separately maintained copy.
    const schema = new Function('z', `return ${route.split('mutation(')[1]!.split(',(tx,')[0]}`)(z) as z.ZodType;
    const payload = { kind: 'BEFORE', customerVisible: true, mime: 'image/png', base64: exact.toString('base64') };
    assert.ok(schema.safeParse(payload).success);
    assert.ok(schema.safeParse({ ...payload, base64: over.toString('base64') }).success); // decoded check is essential
    assert.equal(schema.safeParse({ ...payload, base64: payload.base64 + 'AAAA' }).success, false);
    assert.equal(schema.safeParse({ ...payload, mime: 'image/svg+xml' }).success, false);
    assert.equal(schema.safeParse({ ...payload, extra: true }).success, false);
    const appSource = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8');
    const appLimit = Number(appSource.match(/\? (\d+) : '16kb'/)![1]);
    const routeLimit = Number(route.match(/limit:(\d+)/)![1]);
    assert.equal(appLimit, Math.ceil(max / 3) * 4 + 1024); assert.equal(routeLimit, appLimit);
    assert.ok(appSource.includes('^\\/api\\/v1\\/items\\/[^/]+\\/photos$'));
    async function parse(body: string, limit: number | string) {
      const stream = Readable.from([Buffer.from(body)]);
      Object.assign(stream, { headers: { 'content-type': 'application/json', 'content-length': String(Buffer.byteLength(body)) } });
      return new Promise<void>((resolve, reject) => express.json({ limit })(stream as unknown as express.Request, {} as express.Response, error => error ? reject(error) : resolve()));
    }
    for (const limit of [appLimit, routeLimit]) {
      await parse(JSON.stringify(payload), limit);
      await assert.rejects(parse(' '.repeat(limit + 1), limit), { status: 413 });
    }
    await assert.rejects(parse(JSON.stringify(payload), '16kb'), { status: 413 });

    // domain has no runtime imports/setup. FileReader mock avoids browser/network/files.
    const domainSource = readFileSync(new URL('../../web/src/services/domain.ts', import.meta.url), 'utf8');
    assert.equal(/^import(?! type).*from/gm.test(domainSource), false);
    const { photoInput } = await import(new URL('../../web/src/services/domain.ts', import.meta.url).href) as { photoInput(file: File): Promise<{ mime: string; base64: string }> };
    const original = Object.getOwnPropertyDescriptor(globalThis, 'FileReader'); let reads = 0;
    Object.defineProperty(globalThis, 'FileReader', { configurable: true, value: class {
      result = 'data:image/png;base64,AQ=='; onload?: () => void;
      readAsDataURL() { reads++; this.onload?.(); }
    } });
    try {
      assert.equal((await photoInput({ type: 'image/png', size: max } as File)).mime, 'image/png');
      assert.equal((await photoInput({ type: 'image/jpeg', size: max } as File)).mime, 'image/jpeg');
      for (const file of [{ type: 'image/png', size: max + 1 }, { type: 'image/png', size: 0 }, { type: 'image/svg+xml', size: 1 }]) await assert.rejects(photoInput(file as File), /10 MiB/);
      assert.equal(reads, 2);
    } finally { if (original) Object.defineProperty(globalThis, 'FileReader', original); else Reflect.deleteProperty(globalThis, 'FileReader'); }
  } finally { hooks.deregister(); }
});
