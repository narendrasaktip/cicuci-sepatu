import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('audit boundaries: isolated HTTP and fail-closed fake DB only', async t => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  const secret = 'private-provider-secret';
  const token = 'a'.repeat(64);
  const requestId = randomUUID();
  type Activity = { action: string; entityType: string; actorUserId?: string; metadata: Record<string, unknown> };
  const writes: Activity[] = [];
  const queries: Record<string, unknown>[] = [];
  const logs: unknown[][] = [];
  const unexpected: string[] = [];
  let role = 'OWNER'; let failWrite = false; let failSession = false; let failRead = false;
  let rows: object[] = [];
  // Every unconfigured method throws: no Prisma client, database, Redis or private file reads.
  const fakeDb = new Proxy({
    auditLog: {
      create: async ({ data }: { data: Activity }) => { if (failWrite) throw new Error(secret); writes.push(data); return data; },
      findMany: async (query: Record<string, unknown>) => { queries.push(query); if (failRead) throw new Error(secret); return rows; },
    },
    session: { findUnique: async () => {
      if (failSession) throw new Error(secret);
      return { user: { id: 'fixture-owner', name: 'Fixture Owner', role, isActive: true }, csrfToken: 'fixture-csrf', expiresAt: new Date(Date.now() + 60000) };
    } },
    user: { findMany: async (query: Record<string, unknown>) => { assert.deepEqual(query, { where: { id: { in: rows.length ? ['fixture-owner','fixture-owner'] : [] } }, select: { id: true, name: true } }); return [{ id: 'fixture-owner', name: 'Fixture Owner' }]; } },
    order: { findUnique: async () => null },
  }, { get(target, key, receiver) { if (!Reflect.has(target, key)) { unexpected.push(String(key)); throw new Error(`Unexpected DB access: ${String(key)}`); } return Reflect.get(target, key, receiver); } });
  const symbol = Symbol.for('cicuci.test.audit.db');
  Reflect.set(globalThis, symbol, fakeDb);
  const fakeDbUrl = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("cicuci.test.audit.db")];');
  const hooks = registerHooks({ resolve(specifier, context, next) { return /(?:^|\/)db\.js$/.test(specifier) ? { url: fakeDbUrl, shortCircuit: true } : next(specifier, context); } });
  const originalError = console.error;
  console.error = (...args: unknown[]) => { logs.push(args); };
  try {
    const { safeMetadata, recordActivity, requestActivity } = await import('../src/lib/audit.js');
    await t.test('metadata uses field-specific types, UUIDs, enums and exact token-free templates', () => {
      const allowed = { requestId, method: 'POST', route: '/api/v1/track/:token/consent', status: 403, outcome: 'FAILED', errorCode: 'FORBIDDEN', durationMs: 0, fromState: 'starting', state: 'qr', reason: 'BROWSER_PROFILE_LOCKED', generation: 0, attemptNo: 1, actualOutbound: 'unknown', delivery: 'claimed', retryable: false, realSendEnabled: false, count: 2, attemptCount: 3 };
      assert.deepEqual(safeMetadata(allowed), allowed);
      const diagnostic = { stage: 'initialize', errorType: 'TypeError', diagnosticCode: 'INVALID_PARAMETERS', operation: 'setUserAgent', reason: 'BROWSER_PROTOCOL_FAILED', outcome: 'FAILED' };
      assert.deepEqual(safeMetadata(diagnostic), diagnostic);
      assert.deepEqual(safeMetadata({ state: 'ready', fromState: 'authenticated', reason: 'AMBIGUOUS_SEND_MANUAL_REVIEW', delivery: 'submitted', actualOutbound: true }), { state: 'ready', fromState: 'authenticated', reason: 'AMBIGUOUS_SEND_MANUAL_REVIEW', delivery: 'submitted', actualOutbound: true });
      for (const value of [secret, 'https://provider.test/token', 'http://provider.test', '+628123456789', '628123456789', 'QR SECRET', 'QRCODE', token, true, 42, null, {}, []]) {
        for (const key of ['requestId','route','method','outcome','errorCode','state','fromState','reason','delivery','stage','errorType','diagnosticCode','operation']) assert.deepEqual(safeMetadata({ [key]: value }), {}, `${key}: ${String(value)}`);
      }
      for (const route of ['/api/v1/track/shortsecret', `/api/v1/track/${token}`, '/api/v1/orders/private-id', '/api/v1/track/:token?token=secret', 'http://provider.test']) assert.deepEqual(safeMetadata({ route }), {});
      for (const value of [-1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1, '1', true]) assert.deepEqual(safeMetadata({ count: value, generation: value, durationMs: value }), {});
      assert.deepEqual(safeMetadata({ status: 600, actualOutbound: 'submitted', retryable: 'true', realSendEnabled: 1, qr: secret, phone: secret, payload: { secret } }), {});
    });
    await t.test('write failure resolves, logs no caller/provider secrets; helper contract preserved', async () => {
      failWrite = true;
      await assert.doesNotReject(recordActivity({ action: secret, entityType: secret, metadata: { reason: secret } }));
      assert.deepEqual(logs.pop(), ['AUDIT_WRITE_FAILED']);
      failWrite = false;
      await recordActivity({ action: 'WA_STATE_CHANGED', entityType: 'WhatsApp', entityId: 'fixture-wa', actorId: 'fixture-owner', metadata: { state: 'ready', qr: secret } });
      assert.deepEqual(writes.pop(), { action: 'WA_STATE_CHANGED', entityType: 'WhatsApp', entityId: 'fixture-wa', actorUserId: 'fixture-owner', metadata: { state: 'ready' } });
    });
    // Actual app/router/error handlers; all persistence resolves to the fake above.
    const { app } = await import('../src/app.js');
    const express = (await import('express')).default;
    const mutationApp = express();
    mutationApp.use(requestActivity);
    mutationApp.post('/api/v1/orders', (_req, res) => { res.status(201).json({ token: secret }); });
    const server = app.listen(0, '127.0.0.1');
    const mutationServer = mutationApp.listen(0, '127.0.0.1');
    await Promise.all([server, mutationServer].map(s => new Promise<void>(resolve => s.once('listening', resolve))));
    const baseOf = (s: typeof server) => { const address = s.address(); assert.ok(address && typeof address !== 'string'); return `http://127.0.0.1:${address.port}`; };
    const base = baseOf(server);
    const cookie = { Cookie: `cicuci_session=${token}` };
    const call = async (path: string, init?: RequestInit) => {
      const response = await fetch(`${base}${path}`, init);
      const body = await response.json();
      await new Promise<void>(resolve => setImmediate(resolve));
      const id = response.headers.get('x-request-id');
      assert.match(id ?? '', /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      return { response, body, id };
    };
    try {
      await t.test('mutations correlate server UUID; successful polling omitted', async () => {
        writes.length = 0;
        const response = await fetch(`${baseOf(mutationServer)}/api/v1/orders?token=${token}`, { method: 'POST', headers: { 'X-Request-ID': secret } });
        await response.text(); await new Promise<void>(resolve => setImmediate(resolve));
        assert.equal(writes.length, 1);
        assert.equal(writes[0]?.action, 'API_ACTIVITY');
        assert.equal(writes[0]?.metadata.requestId, response.headers.get('x-request-id'));
        assert.equal(writes[0]?.metadata.route, '/api/v1/orders');
        writes.length = 0;
        await call('/api/v1/health'); await call('/api/v1/auth/me', { headers: cookie });
        assert.equal(writes.length, 0);
      });
      await t.test('malformed JSON, auth, missing routes, public tokens, uncaught failures stay safe', async () => {
        const ids = new Set<string | null>();
        for (const [path, init, status, code, route] of [
          [`/api/v1/track/${token}/consent`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: `{"secret":"${secret}"` }, 400, 'VALIDATION_ERROR', '/unmatched'],
          ['/api/v1/orders', {}, 401, 'UNAUTHENTICATED', '/unmatched'],
          [`/api/v1/missing/${token}?qr=${secret}`, {}, 404, 'NOT_FOUND', '/unmatched'],
          [`/api/v1/track/${token}`, {}, 404, 'TOKEN_INVALID', '/api/v1/track/:token'],
        ] as const) {
          writes.length = 0;
          const result = await call(path, init);
          assert.equal(result.response.status, status); assert.equal(result.body.error.code, code);
          assert.equal(writes.length, 1); const entry = writes[0]!;
          assert.equal(entry.action, 'API_ERROR'); assert.equal(entry.metadata.route, route);
          assert.equal(entry.metadata.requestId, result.id); assert.equal(entry.metadata.errorCode, code);
          assert.equal(entry.metadata.status, status); assert.equal(entry.metadata.outcome, 'FAILED');
          assert.doesNotMatch(JSON.stringify({ entry, body: result.body }), /private-provider-secret|aaaaaaaaaaaaaaaa|628123456789/);
          ids.add(result.id);
        }
        assert.equal(ids.size, 4);
        failSession = true; writes.length = 0;
        const result = await call('/api/v1/orders', { headers: cookie });
        assert.equal(result.response.status, 500); assert.equal(result.body.error.code, 'INTERNAL_ERROR');
        assert.equal(writes[0]?.metadata.requestId, result.id);
        assert.deepEqual(logs.pop(), ['REQUEST_INTERNAL_ERROR', { requestId: result.id }]);
        assert.doesNotMatch(JSON.stringify({ writes, body: result.body, logs }), /private-provider-secret|aaaaaaaaaaaaaaaa|628123456789/);
        failSession = false;
        failWrite = true; writes.length = 0;
        const unavailableAudit = await call(`/api/v1/missing/${token}`);
        assert.equal(unavailableAudit.response.status, 404);
        assert.equal(unavailableAudit.body.error.code, 'NOT_FOUND');
        assert.equal(writes.length, 0); assert.deepEqual(logs.pop(), ['AUDIT_WRITE_FAILED']);
        failWrite = false;
      });
      await t.test('owner audit filters/pagination/actor projection; auth rejects before DB reads; no recursion', async () => {
        writes.length = 0; queries.length = 0;
        for (const deniedRole of ['ADMIN','STAFF']) {
          role = deniedRole;
          assert.equal((await call('/api/v1/audit', { headers: cookie })).response.status, 403);
        }
        assert.equal((await call('/api/v1/audit')).response.status, 401);
        assert.equal(queries.length, 0); assert.equal(writes.length, 0);
        role = 'OWNER';
        const occurredAt = new Date('2026-01-02T00:00:00Z');
        rows = ['fixture-a','fixture-b'].map(id => ({ id, action: 'API_ERROR', entityType: 'Request', actorUserId: 'fixture-owner', occurredAt, metadata: { outcome: 'FAILED', requestId } }));
        const from = '2026-01-01T00:00:00Z'; const to = '2026-01-03T00:00:00Z';
        const params = new URLSearchParams({ action: 'API_ERROR', entityType: 'Request', outcome: 'FAILED', requestId, from, to, q: 'API', cursor: 'fixture-cursor', limit: '1' });
        const result = await call(`/api/v1/audit?${params}`, { headers: cookie });
        assert.equal(result.response.status, 200); assert.equal(result.body.data.length, 1);
        assert.deepEqual(result.body.page, { nextCursor: 'fixture-a' });
        assert.deepEqual(result.body.data[0].actorUser, { id: 'fixture-owner', name: 'Fixture Owner' });
        assert.equal(result.body.data[0].createdAt, occurredAt.toISOString());
        assert.deepEqual(queries.pop(), { where: { action: 'API_ERROR', entityType: 'Request', occurredAt: { gte: new Date(from), lte: new Date(to) }, AND: [{ OR: [{ action: { contains: 'API' } }, { entityType: { contains: 'API' } }, { entityId: { contains: 'API' } }] }, { metadata: { path: '$.outcome', equals: 'FAILED' } }, { metadata: { path: '$.requestId', equals: requestId } }] }, take: 2, cursor: { id: 'fixture-cursor' }, skip: 1, orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }] });
        for (const query of ['requestId=secret','outcome=secret','limit=101',`from=${to}&to=${from}`,'unknown=secret']) assert.equal((await call(`/api/v1/audit?${query}`, { headers: cookie })).response.status, 400);
        assert.equal(queries.length, 0);
        failRead = true;
        const failure = await call('/api/v1/audit', { headers: cookie });
        assert.equal(failure.response.status, 500); assert.equal(failure.body.error.code, 'INTERNAL_ERROR');
        assert.doesNotMatch(JSON.stringify(failure.body), /private-provider-secret/);
        assert.equal(writes.length, 0);
      });
      assert.deepEqual(unexpected, []);
    } finally {
      await Promise.all([server, mutationServer].map(s => new Promise<void>((resolve, reject) => { s.close(error => error ? reject(error) : resolve()); s.closeAllConnections(); })));
    }
  } finally {
    console.error = originalError;
    hooks.deregister(); Reflect.deleteProperty(globalThis, symbol);
  }
});
