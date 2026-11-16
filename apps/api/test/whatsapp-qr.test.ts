import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { createBrowserClient } from '../src/integrations/whatsapp/web.js';

test('actual Chromium generates QR in isolated profile without scan or send', { skip: process.env.RUN_WA_QR_TEST !== '1', timeout: 120000 }, async () => {
  // Never start/disconnect the shared worker: its existing session belongs to the user.
  const root = await mkdtemp(join(tmpdir(), 'cicuci-qr-test-'));
  const client = await createBrowserClient(root);
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let destroyed = false;
  try {
    const qr = new Promise<string>((resolve, reject) => {
      client.on('qr', resolve);
      client.on('auth_failure', () => reject(new Error('AUTH_FAILED')));
      timeout = setTimeout(() => reject(new Error('QR_TIMEOUT')), 100000);
    });
    const initialization = client.initialize();
    await Promise.race([qr.then(value => assert.ok(value.length > 0)), initialization.then(() => qr).then(value => assert.ok(value.length > 0))]);
    await initialization;
    await client.destroy();
    destroyed = true;
  } finally {
    clearTimeout(timeout);
    if (!destroyed) await client.destroy().catch(() => {});
    await rm(root, { recursive: true, force: true });
  }
});
