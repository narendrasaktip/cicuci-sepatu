import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { test } from 'node:test';
import argon2 from 'argon2';

test('failed login audit uses bounded attempted identity without actor or credentials', async () => {
  process.env.DATABASE_URL = 'mysql://fake:fake@127.0.0.1:1/fake';
  process.env.REDIS_URL = 'redis://127.0.0.1:1';
  process.env.APP_BASE_URL = 'http://example.test';
  const writes: unknown[] = [];
  const hash = await argon2.hash('correct-password');
  let user: object | null = null;
  let current: object | null = null;
  let auditUnavailable = false;
  let transactionCount = 0;
  const sessions: unknown[] = [];
  const fake = {
    user: { findUnique: async () => user },
    auditLog: { create: async ({ data }: { data: unknown }) => {
      if (auditUnavailable) throw new Error('AUDIT_UNAVAILABLE');
      writes.push(data);
    } },
    $transaction: async (run: (tx: object) => Promise<unknown>) => {
      transactionCount++;
      const pendingWrites: unknown[] = []; const pendingSessions: unknown[] = [];
      const result = await run({
        $queryRaw: async () => [],
        user: { findUnique: async () => current },
        session: {
          deleteMany: async () => ({ count: 0 }),
          create: async ({ data }: { data: unknown }) => { pendingSessions.push(data); },
        },
        auditLog: { create: async ({ data }: { data: unknown }) => {
          if (auditUnavailable) throw new Error('AUDIT_UNAVAILABLE');
          pendingWrites.push(data);
        } },
      });
      writes.push(...pendingWrites); sessions.push(...pendingSessions);
      return result;
    },
  };
  Reflect.set(globalThis, Symbol.for('login.audit.db'), fake);
  const url = 'data:text/javascript,' + encodeURIComponent('export const db = globalThis[Symbol.for("login.audit.db")];');
  const hooks = registerHooks({ resolve(specifier, context, next) { return /(?:^|\/)db\.js$/.test(specifier) ? { url, shortCircuit: true } : next(specifier, context); } });
  try {
    const { createSession, auditFailedLogin, attemptedIdentity } = await import('../src/services/auth.js');
    assert.equal(await createSession('unknown@example.test', 'wrong-password'), null);
    user = { id: 'known', passwordHash: hash, isActive: true, archivedAt: null };
    assert.equal(await createSession('known@example.test', 'wrong-password'), null);
    await auditFailedLogin('INVALID\n@example.test', 'secret');
    await auditFailedLogin('VALID@example.test', undefined);
    await auditFailedLogin('secret@example.test', 'SECRET@example.test');
    assert.deepEqual(writes, [
      { action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'unknown@example.test' } },
      { action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'known@example.test' } },
      { action: 'LOGIN_FAILED' },
      { action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'valid@example.test' } },
      { action: 'LOGIN_FAILED' },
    ]);
    assert.equal(attemptedIdentity(`${'a'.repeat(192)}@example.test`, 'password'), undefined);
    assert.equal(attemptedIdentity('token-without-email', 'password'), undefined);
    // Credential failures persist independently of session transactions.
    assert.equal(transactionCount, 0);
    writes.length = 0;
    assert.equal(await createSession('admin@gmail.com', 'wrong-password'), null);
    assert.deepEqual(writes, [{ action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'admin@gmail.com' } }]);
    writes.length = 0;
    user = { id: 'known', passwordHash: hash, isActive: false, archivedAt: null };
    assert.equal(await createSession('known@example.test', 'correct-password'), null);
    assert.equal(transactionCount, 0);
    assert.deepEqual(writes, [{ action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'known@example.test' } }]);
    user = { id: 'known', passwordHash: hash, isActive: true, archivedAt: null };
    for (const changed of [null, { ...user, isActive: false }, { ...user, archivedAt: new Date() }, { ...user, passwordHash: 'changed' }]) {
      writes.length = 0; current = changed;
      assert.equal(await createSession('known@example.test', 'correct-password'), null);
      assert.deepEqual(writes, [{ action: 'LOGIN_FAILED', metadata: { attemptedIdentity: 'known@example.test' } }]);
      assert.deepEqual(sessions, []);
    }
    writes.length = 0; current = user; auditUnavailable = true;
    await assert.rejects(createSession('known@example.test', 'correct-password'), /AUDIT_UNAVAILABLE/);
    assert.deepEqual(writes, []);
    assert.deepEqual(sessions, []);
    await assert.rejects(createSession('known@example.test', 'wrong-password'), /AUDIT_UNAVAILABLE/);
    auditUnavailable = false;
    const session = await createSession('known@example.test', 'correct-password');
    assert.ok(session?.token);
    assert.equal(sessions.length, 1);
    assert.deepEqual(writes, [{ actorUserId: 'known', action: 'LOGIN_SUCCEEDED' }]);
  } finally {
    hooks.deregister();
    Reflect.deleteProperty(globalThis, Symbol.for('login.audit.db'));
  }
});
