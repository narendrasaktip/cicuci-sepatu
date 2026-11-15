import assert from 'node:assert/strict';
import vm from 'node:vm';
import { test } from 'node:test';
import { mediaCompatibilityScript } from '../src/integrations/whatsapp/media-compat.js';

test('serialized media excludes model storage, preserves upload fields, receiver, arguments; installation idempotent', async () => {
  const key = { id: 'generated' };
  const media = { __x_id: undefined, __initialized: true, clientUrl: 'upload-url', uploadhash: 'hash', mediaHandle: null, toJSON() { return { type: 'image', preview: 'preview', filehash: 'filehash' }; } };
  let calls = 0;
  const WWebJS = { async processMediaData(...args: unknown[]) { assert.equal(this, WWebJS); assert.deepEqual(args, ['media', { forceDocument: false }]); calls++; return media; } };
  const context = vm.createContext({ WWebJS });
  vm.runInContext(mediaCompatibilityScript(), context);
  const installed = WWebJS.processMediaData;
  vm.runInContext(mediaCompatibilityScript(), context);
  assert.equal(WWebJS.processMediaData, installed);
  const result = await WWebJS.processMediaData('media', { forceDocument: false });
  assert.equal(calls, 1);
  const data = { id: key, ...result } as Record<string, unknown>;
  // Reproduce BaseModel's setter mapping: raw __x_id overwrites storage for id.
  const construct = (input: Record<string, unknown>) => Object.fromEntries(Object.entries(input).map(([k, v]) => [k === 'id' ? '__x_id' : k, v]));
  assert.equal(construct({ id: key, ...media }).__x_id, undefined);
  assert.equal(construct(data).__x_id, key);
  assert.equal(data.type, 'image'); assert.equal(data.preview, 'preview');
  assert.equal(data.clientUrl, 'upload-url'); assert.equal(data.uploadhash, 'hash');
  assert.equal(Object.hasOwn(data, '__initialized'), false);
  assert.equal(Object.hasOwn(result, 'id'), false);
});

test('plain media stays unchanged; preparation rejection stays original without retry', async () => {
  const plain = { type: 'image' };
  const context = vm.createContext({ WWebJS: { processMediaData: async () => plain } });
  vm.runInContext(mediaCompatibilityScript(), context);
  assert.equal(await context.WWebJS.processMediaData(), plain);
  const error = new Error('preparation'); let calls = 0;
  const failing = vm.createContext({ WWebJS: { processMediaData: async () => { calls++; throw error; } } });
  vm.runInContext(mediaCompatibilityScript(), failing);
  await assert.rejects(failing.WWebJS.processMediaData(), e => e === error);
  assert.equal(calls, 1);
});
