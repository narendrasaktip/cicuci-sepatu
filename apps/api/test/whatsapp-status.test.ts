import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import express from 'express';

test('status GET reads worker only; never enqueues control, exposes activation or trusts last command', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  const state = { state: 'ready', ready: true, realSendEnabled: true, activation: 'private-activation', workerId: 'private-instance', lastCommand: { command: 'disconnect', status: 'completed' } };
  Reflect.set(globalThis, Symbol.for('cicuci.test.snapshot'), state);
  const module = (code: string) => ({ url: 'data:text/javascript,' + encodeURIComponent(code), shortCircuit: true });
  const hooks = registerHooks({ resolve(specifier, context, next) {
    if (context.parentURL?.includes('/controllers/whatsapp.')) {
      if (specifier.endsWith('/middleware/auth.js')) return module('export const authenticate = (_req,_res,next) => next(); export const authorize = () => authenticate;');
      if (specifier.endsWith('/lib/audit.js')) return module('export async function recordActivity() { throw new Error("UNEXPECTED_AUDIT_WRITE"); }');
      if (specifier.endsWith('/lib/whatsapp-control.js')) return module('export async function workerSnapshot() { return globalThis[Symbol.for("cicuci.test.snapshot")]; } export function controlQueue() { throw new Error("UNEXPECTED_COMMAND"); } export function controlRedis() { throw new Error("UNEXPECTED_REDIS_WRITE"); } export function sign() { throw new Error("UNEXPECTED_COMMAND"); } export const lockKey = "fake";');
    }
    return next(specifier, context);
  } });
  const { whatsapp } = await import('../src/controllers/whatsapp.js');
  const app = express(); app.use(whatsapp);
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  try {
    for (let i = 0; i < 4; i++) {
      const response: Response = await fetch(`http://127.0.0.1:${address.port}/status`);
      assert.equal(response.status, 200); assert.match(response.headers.get('cache-control') ?? '', /no-store/);
      const result = await response.json();
      assert.equal(result.state, 'ready'); assert.equal(result.realSendEnabled, true);
      assert.equal(result.activation, undefined); assert.equal(result.workerId, undefined);
      assert.equal(state.activation, 'private-activation'); assert.equal(state.realSendEnabled, true);
    }
    Reflect.set(globalThis, Symbol.for('cicuci.test.snapshot'), undefined);
    const response = await fetch(`http://127.0.0.1:${address.port}/status`);
    assert.equal((await response.json()).state, 'offline');
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.snapshot'));
  }
});
