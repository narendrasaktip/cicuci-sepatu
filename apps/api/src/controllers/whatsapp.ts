import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import QRCode from 'qrcode';
import { authenticate, authorize } from '../middleware/auth.js';
import { config } from '../lib/config.js';
import { controlQueue, controlRedis, lockKey, sign, workerSnapshot } from '../lib/whatsapp-control.js';
import { recordActivity } from '../lib/audit.js';
export const whatsapp = Router();
whatsapp.use(authenticate, authorize('OWNER'));
whatsapp.use((_req, res, next) => { res.set('Cache-Control', 'no-store, private').set('Pragma', 'no-cache'); next(); });
whatsapp.get('/status', async (req, res, next) => {
  try {
    z.object({}).strict().parse(req.query);
    const status = await workerSnapshot();
    if (!status) { res.json({ state: 'offline', ready: false, realSendEnabled: false, provider: 'whatsapp-web.js' }); return; }
    const { qr, ...safe }: Partial<typeof status> = status; delete safe.activation; delete safe.workerId;
    res.json({ ...safe, ...(qr && (status.qrExpiresAt ?? 0) > Date.now() ? { qrImage: await QRCode.toDataURL(qr, { width: 300, margin: 2 }) } : {}), provider: 'whatsapp-web.js' });
  } catch (error) { next(error); }
});
whatsapp.post('/:command', rateLimit({ windowMs: 60000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false }), async (req, res, next) => {
  try {
    if (req.get('Origin') !== new URL(config.APP_BASE_URL).origin) { res.status(403).json({ error: { code: 'FORBIDDEN', message: 'Origin tidak valid.' } }); return; }
    const command = z.enum(['start', 'disconnect', 'activate', 'deactivate']).parse(req.params.command);
    z.object({}).strict().parse(req.query);
    (command === 'activate' ? z.object({ acknowledgeRisk: z.literal(true) }).strict() : z.object({}).strict()).parse(req.body);
    const id = z.string().uuid().parse(req.get('Idempotency-Key'));
    const redis = controlRedis();
    const workerId = await redis.get(lockKey);
    if (!workerId) { res.status(503).json({ error: { code: 'WORKER_OFFLINE', message: 'Worker belum tersedia.' } }); return; }
    const payload = JSON.stringify({ command, workerId, actorId: res.locals.session.user.id, expiresAt: Date.now() + 30000 });
    await controlQueue().add('control', { payload, signature: await sign(payload) }, { jobId: id, attempts: 1, removeOnComplete: { age: 86400 }, removeOnFail: { age: 86400 } });
    await recordActivity({ actorId: res.locals.session.user.id, action: `WA_${command.toUpperCase()}_REQUESTED`, entityType: 'WhatsApp', entityId: id });
    res.status(202).json({ id, status: 'queued' });
  } catch (error) { next(error); }
});
