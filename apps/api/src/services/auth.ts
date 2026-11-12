import argon2 from 'argon2';
import { db } from '../lib/db.js';
import { hashToken, randomToken } from '../lib/security.js';
// Hash dummy mencegah pembandingan password dilewati untuk email tidak terdaftar.
const dummyHash = argon2.hash(randomToken(), { type: argon2.argon2id });
export async function createSession(email: string, password: string) {
  const user = await db.user.findUnique({ where: { email } });
  const valid = await argon2.verify(user?.passwordHash ?? await dummyHash, password);
  if (!user || !valid || !user.isActive || user.archivedAt) {
    await db.auditLog.create({ data: { action: 'LOGIN_FAILED', actorUserId: user?.id } });
    return null;
  }
  const token = randomToken();
  const expiresAt = new Date(Date.now() + 8 * 60 * 60 * 1000);
  const created = await db.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${user.id} FOR UPDATE`;
    const current = await tx.user.findUnique({ where: { id: user.id } });
    if (!current?.isActive || current.archivedAt || current.passwordHash !== user.passwordHash) return false;
    await tx.session.deleteMany({ where: { userId: user.id, expiresAt: { lte: new Date() } } });
    await tx.session.create({ data: { tokenHash: hashToken(token), csrfToken: randomToken(), userId: user.id, expiresAt } });
    await tx.auditLog.create({ data: { actorUserId: user.id, action: 'LOGIN_SUCCEEDED' } });
    return true;
  });
  return created ? { token, expiresAt } : null;
}
