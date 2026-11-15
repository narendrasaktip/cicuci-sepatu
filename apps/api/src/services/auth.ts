import argon2 from 'argon2';
import { db } from '../lib/db.js';
import { hashToken, randomToken } from '../lib/security.js';
// Hash dummy mencegah pembandingan password dilewati untuk email tidak terdaftar.
const dummyHash = argon2.hash(randomToken(), { type: argon2.argon2id });
// Only email-shaped identities are retained; arbitrary input may contain secrets.
export function attemptedIdentity(email: unknown, password: unknown): string | undefined {
  if (typeof email !== 'string' || email.length > 191 || (typeof password === 'string' && password.length >= 4 && email.toLowerCase().includes(password.toLowerCase()))) return undefined;
  return /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/.test(email) ? email.toLowerCase() : undefined;
}
export async function auditFailedLogin(email: unknown, password: unknown) {
  const identity = attemptedIdentity(email, password);
  await db.auditLog.create({ data: { action: 'LOGIN_FAILED', ...(identity ? { metadata: { attemptedIdentity: identity } } : {}) } });
}
export async function createSession(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, password);
  if (!user || !valid || !user.isActive || user.archivedAt) {
    await auditFailedLogin(email, password);
    return null;
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const created = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.isActive || current.archivedAt || current.passwordHash !== user.passwordHash) {
      const identity = attemptedIdentity(email, password);
      await tx.auditLog.create({ data: { action: 'LOGIN_FAILED', ...(identity ? { metadata: { attemptedIdentity: identity } } : {}) } });
      return false;
    }
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
    await tx.session.create({ data: { tokenHash: hashToken(token), csrfToken: randomToken(), userId: user.id, expiresAt } });
    await tx.auditLog.create({ data: { actorUserId: user.id, action: 'LOGIN_SUCCEEDED' } });
    return true;
  });
  return created ? { token, expiresAt } : null;
}
