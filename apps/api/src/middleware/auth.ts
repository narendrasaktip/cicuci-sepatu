import type { RequestHandler } from 'express';
import type { Role } from '@prisma/client';
import { db } from '../lib/db.js';
import { equalToken, hashToken, sessionCookie } from '../lib/security.js';
export const authenticate: RequestHandler = async (req, res, next) => {
  try {
    const token = sessionCookie(req.headers.cookie);
    const session = token && /^[a-f0-9]{64}$/.test(token) ? await db.session.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } }) : null;
    if (!session || session.expiresAt <= new Date() || !session.user.isActive || session.user.archivedAt) {
      res.status(401).json({ error: { code: 'UNAUTHENTICATED', message: 'Login diperlukan.' } }); return;
    }
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && !equalToken(req.get('X-CSRF-Token') ?? '', session.csrfToken)) {
      res.status(403).json({ error: { code: 'FORBIDDEN', message: 'CSRF token tidak valid.' } }); return;
    }
    res.locals.session = session;
    next();
  } catch (error) { next(error); }
};
export const authorize = (...roles: Role[]): RequestHandler => (_req, res, next) => {
  if (!roles.includes(res.locals.session.user.role)) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Akses ditolak.' } }); return; }
  next();
};
