import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WhatsAppWeb, type BrowserClient } from '../src/integrations/whatsapp/web.js';

test('reconnects with bounded backoff and explicit stop cancels retries', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let count = 0;
  const handlers: Record<string, (...args: string[]) => void> = {};
  const client: BrowserClient = {
    on(event, listener) { handlers[event] = listener; },
    async initialize() {}, async destroy() {}, async logout() {}, async sendMessage() { throw new Error('unexpected send'); },
  };
  const web = new WhatsAppWeb(async () => { count++; return client; }, () => {}, async () => {}, true);
  await web.start();
  for (const delay of [1000, 2000, 4000, 8000, 16000, 16000, 16000]) {
    handlers.disconnected!(); await new Promise(resolve => setImmediate(resolve));
    t.mock.timers.tick(delay); await new Promise(resolve => setImmediate(resolve));
  }
  assert.equal(count, 8);
  handlers.ready!(); handlers.disconnected!(); await new Promise(resolve => setImmediate(resolve));
  t.mock.timers.tick(999); await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 8);
  t.mock.timers.tick(1); await new Promise(resolve => setImmediate(resolve)); assert.equal(count, 9);
  handlers.disconnected!(); await new Promise(resolve => setImmediate(resolve));
  await web.stop(true); t.mock.timers.tick(60000); await new Promise(resolve => setImmediate(resolve));
  assert.equal(count, 9);
  await web.startManually(); assert.equal(count, 10);
  await web.stop(true);
});
