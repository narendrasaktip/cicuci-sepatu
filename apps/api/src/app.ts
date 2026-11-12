import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import { ZodError } from 'zod';
import { whatsapp } from './controllers/whatsapp.js';
import { auth } from './controllers/auth.js';
import { operations, publicApi, operationErrors } from './controllers/operations.js';
import { requestActivity } from './lib/audit.js';
export const app = express();
app.use(requestActivity);
app.disable('x-powered-by');
app.use(helmet());
// 4 * ceil(10 MiB / 3) base64 bytes + 1 KiB JSON envelope; other routes stay small.
app.use((req, res, next) => express.json({ limit: /^\/api\/v1\/items\/[^/]+\/photos$/.test(req.path) ? 13982040 : '16kb' })(req, res, next));
app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
app.get('/api/v1/health', (_req, res) => { res.json({ status: 'ok' }); });
app.use('/api/v1/auth', auth);
app.use('/api/v1/whatsapp', whatsapp);
app.use('/api/v1', (req,res,next) => { if (req.path.startsWith('/track/')) publicApi(req,res,next); else next(); });
app.use('/api/v1', (req,res,next) => { if (/^\/(display-settings|pricing|whatsapp-templates|customers|services|users|settings|orders|items|photos|dashboard|notifications|audit)(\/|$)/.test(req.path)) operations(req,res,next); else next(); });
app.use(operationErrors);
app.use((_req, res) => { res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint tidak ditemukan.' } }); });
const errors: ErrorRequestHandler = (error, _req, res, _next) => {
  if (error instanceof ZodError) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Input tidak valid.', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) } }); return; }
  if (error instanceof SyntaxError && 'body' in error) { res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'JSON tidak valid.' } }); return; }
  if (typeof error === 'object' && error !== null && 'status' in error && error.status === 413) { res.status(413).json({ error: { code: 'UPLOAD_INVALID', message: 'Request terlalu besar.' } }); return; }
  console.error('REQUEST_INTERNAL_ERROR', { requestId: res.getHeader('X-Request-ID') });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Layanan belum tersedia.' } });
};
app.use(errors);
