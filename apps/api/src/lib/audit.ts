import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { db } from './db.js';

const states = new Set(['stopped','starting','qr','authenticated','ready','disconnected','error']);
const codes = new Set([
  'VALIDATION_ERROR','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','INTERNAL_ERROR','UPLOAD_INVALID','RATE_LIMITED','CONFLICT','WORKER_OFFLINE',
  'INVALID_CREDENTIALS','INVALID_COMMAND','COMMAND_EXPIRED','NOT_READY','AUTH_FAILED','LOGOUT_FAILED','BROWSER_CLOSE_FAILED','SESSION_DELETE_FAILED',
  'BROWSER_PROFILE_LOCKED','BROWSER_PERMISSION_DENIED','BROWSER_NOT_FOUND','BROWSER_SANDBOX_FAILED','WHATSAPP_NETWORK_FAILED','INITIALIZATION_TIMEOUT','BROWSER_LAUNCH_FAILED','INITIALIZATION_FAILED','BROWSER_PROTOCOL_FAILED','WHATSAPP_PAGE_FAILED',
  'NOT_ENABLED','INVALID_WORKER_STATUS','PROVIDER_NOT_READY','ACTIVATION_CHANGED','NO_CUSTOMER','MESSAGE_UNAVAILABLE','TRACKING_CHANGED','NO_CURRENT_OPT_IN','RECIPIENT_CHANGED','STALE_ORDER','STALE_STATE','STALE_CONSENT','ATTEMPTS_EXHAUSTED','AMBIGUOUS_SEND_MANUAL_REVIEW','WORKER_RESTART_AMBIGUOUS_SEND',
  'BEFORE_PHOTO_REQUIRED','CONSENT_REQUIRED','CUSTOMER_NOT_FOUND','INVALID_REFUND','INVALID_TRANSITION','ITEM_CLOSED','ITEM_LOCKED','NOT_RETRYABLE','ORDER_LOCKED','OVERPAYMENT','PRICE_NOT_FINAL','QC_PHOTO_REQUIRED','QC_REASON_REQUIRED','RISK_EVIDENCE_REQUIRED','SERVICE_INACTIVE','TOKEN_EXPIRED','TOKEN_INVALID','USER_INACTIVE','ARCHIVED','CUSTOMER_HAS_ORDERS','ORDER_HAS_PAYMENTS','NOTIFICATION_IN_PROGRESS','USER_HAS_HISTORY','DELETE_DEPENDENCY','CURRENT_ACCOUNT','LAST_OWNER','IDEMPOTENCY_CONFLICT','REVISION_CONFLICT','RATE_PLAN_INACTIVE','PRICING_SELECTION_CONFLICT',
]);
// Templates are explicit: even short alphabetic tracking tokens must never pass as routes.
const routes = new Set(['/unmatched', ...[
  'display-settings','pricing/plans','pricing/plans/:id','pricing/preview','pricing/rates','whatsapp-templates','whatsapp-templates/preview','health','auth/login','auth/logout','auth/me','whatsapp/status','whatsapp/:command',
  'pricing/plans/:id','customers','customers/:id','services','services/:id','users','users/:id','settings','orders','orders/:id','orders/:id/items',
  'orders/:id/tracking-token','orders/:id/tracking-token/rotate','orders/:id/tracking-token/revoke','orders/:id/payments','orders/:id/refunds',
  'items/:id','items/:id/assignment','items/:id/transition','items/:id/inspection','items/:id/consent/reissue','items/:id/consent/return','items/:id/photos',
  'photos/:id','dashboard','notifications','notifications/:id/retry','audit','track/:token','track/:token/consent','track/:token/photos/:id',
].map(path => `/api/v1/${path}`)]);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const counters = new Set(['durationMs','generation','attemptNo','count','attemptCount']);
const booleans = new Set(['retryable','realSendEnabled','messageIdMissing']);
// Field-specific enums only; no provider messages, payloads, URLs or credentials.
export function safeMetadata(input: Record<string, unknown> = {}): Prisma.InputJsonObject {
  const result: Record<string, string | number | boolean> = {};
  for (const [key,value] of Object.entries(input)) {
    if (counters.has(key) && typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) result[key] = value;
    else if (key === 'status' && typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) result[key] = value;
    else if ((booleans.has(key) || key === 'actualOutbound') && typeof value === 'boolean') result[key] = value;
    else if (typeof value === 'string' && (
      (key === 'requestId' && uuid.test(value)) ||
      (key === 'route' && routes.has(value)) ||
      (key === 'method' && ['GET','HEAD','OPTIONS','POST','PUT','PATCH','DELETE'].includes(value)) ||
      (key === 'outcome' && ['SUCCESS','FAILED'].includes(value)) ||
      (key === 'stage' && ['factory','initialize','send'].includes(value)) ||
      (key === 'errorType' && ['Error','TypeError','ReferenceError','SyntaxError','TimeoutError','ProtocolError','TargetCloseError','String','Unknown'].includes(value)) ||
      (key === 'diagnosticCode' && ['ENOENT','EACCES','EPERM','EBUSY','EEXIST','ECONNREFUSED','ECONNRESET','ETIMEDOUT','INVALID_PARAMETERS','CONTEXT_DESTROYED','EVALUATION_FAILED','UNKNOWN'].includes(value)) ||
      (key === 'operation' && ['setUserAgent','inject','navigation','launch','sendMessage','unknown'].includes(value)) ||
      ((key === 'state' || key === 'fromState') && states.has(value)) ||
      ((key === 'reason' || key === 'errorCode') && codes.has(value)) ||
      (key === 'actualOutbound' && value === 'unknown') ||
      (key === 'delivery' && ['claimed','submitted','skipped','unknown'].includes(value))
    )) result[key] = value;
  }
  return result;
}
export async function recordActivity(data: {action:string;entityType:string;entityId?:string;actorId?:string;metadata?:Prisma.InputJsonObject}): Promise<void> {
  try { await db.auditLog.create({data:{action:data.action,entityType:data.entityType,entityId:data.entityId,actorUserId:data.actorId,metadata:safeMetadata(data.metadata)}}); }
  catch { console.error('AUDIT_WRITE_FAILED'); }
}
export const requestActivity: RequestHandler = (req,res,next) => {
  const requestId = randomUUID(); const start = performance.now();
  res.setHeader('X-Request-ID',requestId);
  let errorCode: string | undefined;
  let route = '/unmatched';
  const captureRoute = () => {
    if (typeof req.route?.path !== 'string') return;
    const template = `${req.baseUrl}${req.route.path}`;
    if (routes.has(template)) route = template;
    else {
      // Express restores baseUrl while unwinding async errors; only unique known templates survive.
      const matches = [...routes].filter(path => path.endsWith(req.route.path));
      if (matches.length === 1) route = matches[0]!;
    }
  };
  const json = res.json.bind(res);
  res.json = body => { captureRoute(); if (typeof body?.error?.code === 'string' && codes.has(body.error.code)) errorCode = body.error.code; return json(body); };
  res.once('finish', () => {
    captureRoute();
    // Read polling is noise. Audit reads, including auth failures, never audit themselves.
    if (/^\/api\/v1\/audit\/?(?:\?|$)/i.test(req.originalUrl) || (res.statusCode < 400 && ['GET','HEAD','OPTIONS'].includes(req.method))) return;
    void recordActivity({action:res.statusCode >= 400 ? 'API_ERROR':'API_ACTIVITY',entityType:'Request',actorId:res.locals.session?.user?.id,metadata:{requestId,method:req.method,route,status:res.statusCode,outcome:res.statusCode >= 400 ? 'FAILED':'SUCCESS',...(errorCode ? {errorCode}:{}),durationMs:Math.round(performance.now()-start)}});
  });
  next();
};
