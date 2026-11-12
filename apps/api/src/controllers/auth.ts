import { Router } from 'express';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../lib/config.js';
import { db } from '../lib/db.js';
import { authenticate } from '../middleware/auth.js';
import { createSession } from '../services/auth.js';
export const auth = Router();
const cookieOptions = { httpOnly: true, secure: config.NODE_ENV === 'production', sameSite: 'lax' as const, path: '/' };
const loginInput = z.object({ email: z.string().email().max(191).transform(value => value.toLowerCase()), password: z.string().min(1).max(128) }).strict();
// ponytail: limiter memori untuk satu proses; gunakan Redis store saat scale-out.
auth.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: { code: 'RATE_LIMITED', message: 'Terlalu banyak percobaan masuk. Coba lagi nanti.' } } }), async (req, res, next) => {
  try {
    if (req.get('Origin') !== new URL(config.APP_BASE_URL).origin) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin tidak valid.' } }); return; }
    const input = loginInput.parse(req.body);
    const session = await createSession(input.email, input.password);
    if (!session) { res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Email atau password tidak valid.' } }); return; }
    res.cookie('cicuci_session', session.token, { ...cookieOptions, expires: session.expiresAt }).sendStatus(204);
  } catch (error) { next(error); }
});
auth.get('/me', authenticate, (_req, res) => {
  const { user, csrfToken } = res.locals.session;
  res.json({ user: { id: user.id, name: user.name, email: user.email, role: user.role }, csrfToken });
});
auth.post('/logout', authenticate, async (_req, res, next) => {
  try {
    const session = res.locals.session;
    await db.$transaction([
      db.session.deleteMany({ where: { tokenHash: session.tokenHash } }),
      db.auditLog.create({ data: { actorUserId: session.user.id, action: 'LOGOUT' } }),
    ]);
    res.clearCookie('cicuci_session', cookieOptions).sendStatus(204);
  } catch (error) { next(error); }
});
