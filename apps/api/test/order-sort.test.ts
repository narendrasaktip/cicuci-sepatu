import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';

test('order sorting validates inputs, uses database ordering and stable cursor tie-breaks', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  let query: Record<string, unknown> = {};
  let reads = 0;
  const fakeDb = {
    session: { findUnique: async () => ({ user: { id: 'fixture-owner', role: 'OWNER', isActive: true }, expiresAt: new Date(Date.now() + 60000) }) },
    order: { findMany: async (value: Record<string, unknown>) => { query = value; reads++; return []; } },
  };
  Reflect.set(globalThis, Symbol.for('cicuci.test.order-sort.db'), fakeDb);
  const url = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("cicuci.test.order-sort.db")];');
  const hooks = registerHooks({ resolve(specifier, context, next) { return /(?:^|\/)db\.js$/.test(specifier) ? { url, shortCircuit: true } : next(specifier, context); } });
  const { app } = await import('../src/app.js');
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', resolve));
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const call = (params: string) => fetch(`http://127.0.0.1:${address.port}/api/v1/orders?${params}`, { headers: { Cookie: `cicuci_session=${'a'.repeat(64)}` } });
  try {
    for (const sort of ['createdAt', 'customer', 'status', 'estimatedCompletionAt']) {
      for (const direction of ['asc', 'desc']) {
        const response = await call(new URLSearchParams({ sort, direction, cursor: 'fixture-cursor', limit: '1', q: 'needle', status: 'RECEIVED' }).toString());
        assert.equal(response.status, 200); await response.json();
        assert.deepEqual(query.orderBy, [sort === 'customer' ? { customer: { name: direction } } : { [sort === 'status' ? 'aggregateStatus' : sort]: direction }, { id: direction }]);
        assert.deepEqual(query.cursor, { id: 'fixture-cursor' }); assert.equal(query.skip, 1); assert.equal(query.take, 2);
        assert.equal((query.where as { aggregateStatus: string }).aggregateStatus, 'RECEIVED');
      }
    }
    await (await call('')).json(); assert.deepEqual(query.orderBy, [{ id: 'asc' }]);
    const before = reads;
    for (const invalid of ['sort=secret', 'direction=sideways', 'sort=createdAt&sort=customer', 'unknown=true']) {
      const response = await call(invalid); assert.equal(response.status, 400); await response.text();
    }
    assert.equal(reads, before);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    hooks.deregister(); Reflect.deleteProperty(globalThis, Symbol.for('cicuci.test.order-sort.db'));
  }
});
