import assert from 'node:assert/strict';
import { test } from 'node:test';
process.env.DATABASE_URL = 'mysql://test:test@127.0.0.1:3306/test';
process.env.REDIS_URL = 'redis://127.0.0.1:6379';
process.env.APP_BASE_URL = 'http://localhost:5173';
const { app } = await import('../src/app.js');
test('HTTP boundaries without external services', async () => {
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  try {
    assert.equal((await fetch(`${base}/health`)).status, 200);
    assert.equal((await fetch(`${base}/auth/me`)).status, 401);
    assert.equal((await fetch(`${base}/auth/logout`, { method: 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' })).status, 403);
    assert.equal((await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' }, body: '{}' })).status, 400);
    for (const path of ['/whatsapp/status', '/whatsapp/start', '/whatsapp/disconnect', '/whatsapp/activate']) assert.equal((await fetch(`${base}${path}`, { method: path.endsWith('status') ? 'GET' : 'POST' })).status, 401);
    assert.equal((await fetch(`${base}/missing`)).status, 404);
    for (let i = 0; i < 9; i++) await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.example' }, body: '{}' });
    const limited = await fetch(`${base}/auth/login`, { method: 'POST' });
    assert.equal(limited.status, 429);
    assert.equal((await limited.json()).error.code, 'RATE_LIMITED');
  } finally { await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); }
});
