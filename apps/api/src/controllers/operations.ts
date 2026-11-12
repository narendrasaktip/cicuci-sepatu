import { defaultStatusLabels, displayInput, publicDisplay, readDisplaySettings } from '../services/display-settings.js';
import { deleteEntity, deletionInput } from '../services/deletions.js';
import { pricingSnapshot, publicPricing, rateMode, packageRates } from '../services/pricing.js';
import { planWrite, planUpdate, pricingPreview, previewPricing } from '../services/rate-rules.js';
import { planSelect, writePlan } from '../services/rate-plans.js';
import express, { Router, type RequestHandler } from 'express';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { ItemStatus, Prisma } from '@prisma/client';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { db } from '../lib/db.js';
import { hashToken, randomTrackingToken } from '../lib/security.js';
import { authenticate, authorize } from '../middleware/auth.js';
import { audit, lockOrder, transaction, type Tx } from '../repositories/orders.js';
import { addItem, change, confirmPricing, ApiError, check, createOrder, decide, finances, getOrder, handoverOrder, inspectionInput, inspect, issueConsent, ledger, ownedItem, publicOrder, transition, type Actor } from '../services/orders.js';
import { customerSearchWhere, customerWrite, safeUser, serviceWrite, settingsWrite, userWrite } from '../services/catalog.js';
import { defaults, templateWrite, placeholderHelp, previewValues, renderTemplate, encryptionReady, seal, unseal } from '../services/whatsapp-templates.js';
import { config } from '../lib/config.js';
import { deletePhoto, uploadPhoto } from '../services/photos.js';
export const operations = Router();
export const publicApi = Router();
const id = z.string().regex(/^[a-zA-Z0-9_-]{1,50}$/);
const token = z.string().regex(/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{22})$/);
const text = z.string().trim().min(1).max(100);
const notes = z.string().max(4000);
const money = z.number().int().min(0).max(100000000);
const date = z.iso.datetime();
const empty = z.object({}).strict();
const customer = z.object({ salutation: z.enum(['Kak','Pak','Bu']).optional(), name: text, whatsapp: z.string().max(30).transform(v => v.replace(/[\s()-]/g, '').replace(/^0/, '+62').replace(/^62/, '+62')).pipe(z.string().regex(/^\+[1-9]\d{7,14}$/)), notes: notes.nullable().optional(), notificationConsent: z.boolean() }).strict();
const service = z.object({ name: text, basePriceIdr: money, isActive: z.boolean().optional() }).strict();
const user = z.object({ name: text, email: z.email().max(191).transform(v => v.toLowerCase()), password: z.string().min(12).max(128), role: z.enum(['OWNER', 'ADMIN', 'STAFF']), isActive: z.boolean().optional() }).strict();
const settings = z.object({ name: text.optional(), pickupInstructions: notes.optional(), consentHours: z.number().int().min(1).max(168).optional(), ...displayInput.shape }).strict();
const item = z.object({ serviceId: id, brand: text, model: z.string().trim().max(100).optional(), color: z.string().trim().max(100).optional(), initialNotes: notes.default(''), quotedPriceIdr: money.optional(), assignedUserId: id.nullable().optional() }).strict();
const paging = z.object({ cursor: id.optional(), limit: z.coerce.number().int().min(1).max(100).default(25), q: z.string().max(100).optional() });
const orderQuery = paging.extend({ sort: z.enum(['createdAt', 'customer', 'status', 'estimatedCompletionAt']).optional(), direction: z.enum(['asc', 'desc']).default('asc'), status: z.enum(['RECEIVED','WAITING_INSPECTION','QUEUED','AWAITING_CONSENT','IN_PROGRESS','READY_FOR_PICKUP','RETURN_PENDING','COMPLETED']).optional(), customerId: id.optional(), overdue: z.enum(['true','false']).optional(), assignedUserId: id.optional() }).strict();
const wrap = (handler: RequestHandler): RequestHandler => (req, res, next) => { Promise.resolve(handler(req, res, next)).catch(next); };
const param = (req: Parameters<RequestHandler>[0], name = 'id') => id.parse(req.params[name]);
const actorOf = (res: Parameters<RequestHandler>[1]): Actor => res.locals.session.user;
function page<T extends { id: string }>(rows: T[], limit: number) { const hasMore = rows.length > limit; const data = rows.slice(0, limit); return { data, page: { nextCursor: hasMore ? data.at(-1)?.id : null } }; }
function window(q: { cursor?: string; limit: number }) { return { take: q.limit + 1, ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}), orderBy: { id: 'asc' as const } }; }
// Idempotent responses encrypted with session CSRF secret; raw tracking/approval tokens never persist.
function encrypt(value: unknown, key: string) { const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', Buffer.from(hashToken(key), 'hex'), iv); const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]); return { iv: iv.toString('hex'), tag: cipher.getAuthTag().toString('hex'), data: data.toString('hex') }; }
function decrypt(value: Prisma.JsonValue, key: string): unknown { const v = z.object({ iv: z.string(), tag: z.string(), data: z.string() }).parse(value); const decipher = createDecipheriv('aes-256-gcm', Buffer.from(hashToken(key), 'hex'), Buffer.from(v.iv, 'hex')); decipher.setAuthTag(Buffer.from(v.tag, 'hex')); return JSON.parse(Buffer.concat([decipher.update(Buffer.from(v.data, 'hex')), decipher.final()]).toString()); }
function mutation<S extends z.ZodType>(schema: S, action: (tx: Tx, input: z.output<S>, actor: Actor, resource: string) => Promise<unknown>, status = 200): RequestHandler {
  return wrap(async (req, res) => {
    empty.parse(req.query); const input = schema.parse(req.body ?? {}); const resource = req.params.id ? param(req) : '';
    const actor = actorOf(res); const csrf = res.locals.session.csrfToken as string;
    const key = z.uuid().parse(req.get('Idempotency-Key')); const cacheId = hashToken(`${actor.id}:${csrf}:${key}`); const fingerprint = hashToken(`${req.method}:${req.originalUrl}:${JSON.stringify(input)}`);
    const result = await transaction(async tx => {
      const cached = await tx.idempotency.findUnique({ where: { id: cacheId } });
      if (cached) { check(cached.fingerprint === fingerprint, 'IDEMPOTENCY_CONFLICT'); return decrypt(cached.response, csrf); }
      if (actor.role === 'OWNER') await tx.$queryRaw`SELECT id FROM User WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM User WHERE id = ${actor.id} FOR UPDATE`;
      const currentActor = await tx.user.findUnique({ where: { id: actor.id }, select: { isActive: true, role: true } });
      check(currentActor?.isActive && currentActor.role === actor.role, 'FORBIDDEN', 403);
      await tx.idempotency.create({ data: { id: cacheId, fingerprint, response: {} } });
      const value = await action(tx, input, actor, resource);
      await tx.idempotency.update({ where: { id: cacheId }, data: { response: encrypt(value, csrf) } }); return value;
    }); res.status(status).json(result);
  });
}
publicApi.use(rateLimit({ windowMs: 60000, limit: 90, standardHeaders: 'draft-7', legacyHeaders: false, handler: (_req, res) => { res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests' } }); } }));
publicApi.get('/track/:token', wrap(async (req, res) => {
  empty.parse(req.query); const raw = token.parse(req.params.token); const order = await publicOrder(db, raw);
  res.json({ ...publicDisplay(await readDisplaySettings(db, config.APP_BASE_URL)), archivedAt: order.archivedAt, number: order.number, createdAt: order.createdAt, estimatedCompletionAt: order.estimatedCompletionAt, pickupInstructions: order.pickupInstructions, aggregateStatus: order.aggregateStatus, pricing: order.pricing ? publicPricing(order.pricing, order.items) : null, ...finances(order.pricing ? [{ finalPriceIdr: pricingSnapshot.parse(order.pricing).totalIdr }] : order.items, order.payments), items: order.items.map(i => ({ id: i.id, brand: i.brand, model: i.model, color: i.color, serviceName: i.serviceName, status: i.status, outcome: i.outcome, quotedPriceIdr: i.quotedPriceIdr, finalPriceIdr: i.finalPriceIdr, findings: i.inspection?.findings || null, customerNote: i.inspection?.customerNote || null, risk: i.inspection?.risk || null, consents: i.consents.map(c => ({ id: c.id, findings: c.findings, customerNote: c.customerNote, risk: c.risk, quotedPriceIdr: c.quotedPriceIdr, expiresAt: c.expiresAt, decision: c.decision, expired: !c.consumedAt && c.expiresAt <= new Date() })), timeline: i.history.map(h => ({ status: h.toStatus, at: h.createdAt })), photos: i.photos.filter(p => p.customerVisible && p.kind !== 'INSPECTION').map(p => ({ id: p.id, kind: p.kind, path: `/api/v1/track/${raw}/photos/${p.id}` })) })) });
}));
publicApi.post('/track/:token/pricing/confirm', wrap(async (req, res) => { empty.parse(req.query); const input = z.object({ totalIdr: money, confirmed: z.literal(true) }).strict().parse(req.body); const raw = token.parse(req.params.token); await transaction(async tx => { const order = await publicOrder(tx, raw); await confirmPricing(tx, order.id, input.totalIdr, null); }); res.json({ confirmed: true }); }));
publicApi.post('/track/:token/consent', wrap(async (req, res) => { empty.parse(req.query); const input = z.object({ itemId: id, decision: z.enum(['APPROVE','DECLINE']) }).strict().parse(req.body); const raw = token.parse(req.params.token); res.json(await transaction(tx => decide(tx, raw, input.itemId, input.decision))); }));
publicApi.get('/track/:token/photos/:id', wrap(async (req, res) => { empty.parse(req.query); const order = await publicOrder(db, token.parse(req.params.token)); const photo = await db.photo.findFirst({ where: { id: param(req), item: { orderId: order.id }, customerVisible: true, kind: { in: ['BEFORE', 'AFTER'] } } }); check(photo, 'NOT_FOUND', 404); res.type(photo.mime).set('Content-Disposition', 'inline').send(Buffer.from(photo.content)); }));
operations.use(authenticate);
for (const kind of ['customers','orders','pricing/plans','users'] as const) operations.delete(`/${kind}/:id`, authorize('OWNER'), mutation(deletionInput, (tx,input,actor,id) => deleteEntity(tx,kind,id,input,actor)));
operations.get('/customers', authorize('OWNER','ADMIN'), wrap(async (req,res) => { const q = paging.strict().parse(req.query); res.json(page(await db.customer.findMany({ where: customerSearchWhere(q.q), ...window(q) }), q.limit)); }));
operations.post('/customers', authorize('OWNER','ADMIN'), mutation(customer, (tx, input, actor) => customerWrite(tx,input,actor), 201));
operations.patch('/customers/:id', authorize('OWNER','ADMIN'), mutation(customer.partial(), (tx,input,actor,id) => customerWrite(tx,input,actor,id)));
operations.get('/customers/:id', authorize('OWNER','ADMIN'), wrap(async (req,res) => { empty.parse(req.query); const value = await db.customer.findUnique({ where: { id: param(req) } }); check(value,'NOT_FOUND',404); res.json(value); }));
operations.get('/pricing/rates', wrap(async (req, res) => { empty.parse(req.query); res.json(packageRates()); }));
operations.get('/pricing/plans', wrap(async (req, res) => { empty.parse(req.query); res.json(await db.ratePlan.findMany({ where: { archivedAt: null }, select: planSelect, orderBy: [{ name: 'asc' }, { id: 'asc' }] })); }));
operations.post('/pricing/plans', authorize('OWNER'), mutation(planWrite, (tx, input, actor) => writePlan(tx, input, actor), 201));
operations.patch('/pricing/plans/:id', authorize('OWNER'), mutation(planUpdate, (tx, input, actor, id) => writePlan(tx, input, actor, id)));
operations.post('/pricing/preview', wrap(async (req, res) => { empty.parse(req.query); const input = pricingPreview.parse(req.body); res.json(previewPricing(input.rules, input.pairs)); }));
operations.get('/services', wrap(async (req,res) => { const q = paging.extend({ active: z.enum(['true','false']).optional() }).strict().parse(req.query); res.json(page(await db.service.findMany({ where: { ...(q.active ? { isActive: q.active === 'true' } : {}), ...(q.q ? { name: { contains: q.q } } : {}) }, ...window(q) }), q.limit)); }));
operations.post('/services', authorize('OWNER'), mutation(service, (tx,input,actor) => serviceWrite(tx,input,actor),201));
operations.patch('/services/:id', authorize('OWNER'), mutation(service.partial(), (tx,input,actor,id) => serviceWrite(tx,input,actor,id)));
operations.get('/users', authorize('OWNER'), wrap(async (req,res) => { const q = paging.strict().parse(req.query); res.json(page(await db.user.findMany({ where: { archivedAt: null, ...(q.q ? { OR: [{ name: { contains: q.q } }, { email: { contains: q.q } }] } : {}) }, select: safeUser, ...window(q) }),q.limit)); }));
operations.post('/users', authorize('OWNER'), mutation(user,(tx,input,actor) => userWrite(tx,input,actor),201));
operations.patch('/users/:id', authorize('OWNER'), mutation(user.omit({ email: true }).partial(),(tx,input,actor,id) => userWrite(tx,input,actor,id)));
operations.get('/whatsapp-templates', authorize('OWNER','ADMIN'), wrap(async(req,res) => {
  empty.parse(req.query);
  const settings = await db.storeSettings.findUnique({ where: { id: 1 } });
  const saved = settings?.waTemplates ? templateWrite.array().parse(settings.waTemplates) : [];
  res.json({ templates: defaults.map(t => saved.find(v => v.event === t.event) ?? t), placeholders: placeholderHelp, localOnly: ['localhost','127.0.0.1','[::1]'].includes(new URL((await readDisplaySettings(db, config.APP_BASE_URL)).publicOrigin).hostname), encryptionReady: encryptionReady() });
}));
operations.post('/whatsapp-templates/preview', authorize('OWNER','ADMIN'), wrap(async(req,res) => {
  empty.parse(req.query); const input = templateWrite.parse(req.body); res.json({ message: renderTemplate(input.body, previewValues) });
}));
operations.patch('/whatsapp-templates', authorize('OWNER'), mutation(templateWrite, async(tx,input,actor) => {
  await tx.storeSettings.upsert({ where: { id: 1 }, create: {}, update: {} });
  await tx.$queryRaw`SELECT id FROM StoreSettings WHERE id = 1 FOR UPDATE`;
  const current = await tx.storeSettings.findUniqueOrThrow({ where: { id: 1 } });
  const saved = current.waTemplates ? templateWrite.array().parse(current.waTemplates) : [];
  await tx.storeSettings.update({ where: { id: 1 }, data: { waTemplates: [...saved.filter(t => t.event !== input.event), input] } });
  await audit(tx,actor.id,'WA_TEMPLATE_UPDATED',input.event); return input;
}));
operations.get('/settings', authorize('OWNER'), wrap(async (req,res) => { empty.parse(req.query); res.json({ ...(await db.storeSettings.findUnique({ where: { id: 1 }, select: { id: true, name: true, pickupInstructions: true, consentHours: true } }) ?? { id: 1, name: 'Cicuci Sepatu', pickupInstructions: '', consentHours: 48 }), ...await readDisplaySettings(db, config.APP_BASE_URL), defaultStatusLabels, trackingStagesVersion: 1 }); }));
operations.get('/display-settings', wrap(async(req,res) => { empty.parse(req.query); const display = await readDisplaySettings(db, config.APP_BASE_URL); res.json({ statusLabels: display.statusLabels }); }));
operations.patch('/settings', authorize('OWNER'), mutation(settings,(tx,input,actor) => settingsWrite(tx,input,actor)));
operations.post('/orders', authorize('OWNER','ADMIN'), mutation(z.object({ customerId: id, estimatedCompletionAt: date.optional(), pickupInstructions: notes.optional(), ratePlanId: id.optional(), rateMode: rateMode.optional(), packageServiceId: id.optional(), items: z.array(item.extend({ serviceId: id.optional() })).min(1).max(50) }).strict(), createOrder,201));
operations.get('/orders', wrap(async (req,res) => {
  const q = orderQuery.parse(req.query); const actor = actorOf(res);
  const where: Prisma.OrderWhereInput = { archivedAt: null, ...(q.status ? { aggregateStatus: q.status } : {}), ...(q.customerId ? { customerId: q.customerId } : {}), ...(q.overdue === 'true' ? { estimatedCompletionAt: { lt: new Date() }, aggregateStatus: q.status ?? { not: 'COMPLETED' } } : {}), ...(q.q ? { OR: [{ number: { contains: q.q } }, { customer: { name: { contains: q.q } } }, { customer: { whatsapp: { contains: q.q } } }] } : {}), ...(actor.role === 'STAFF' || q.assignedUserId ? { items: { some: { assignedUserId: actor.role === 'STAFF' ? actor.id : q.assignedUserId } } } : {}) };
  const direction = q.direction;
  const orderBy: Prisma.OrderOrderByWithRelationInput[] = q.sort ? [q.sort === 'customer' ? { customer: { name: direction } } : q.sort === 'status' ? { aggregateStatus: direction } : { [q.sort]: direction }, { id: direction }] : [{ id: 'asc' }];
  const rows = await db.order.findMany({ where, include: { items: true, payments: true, customer: { select: { name: true } } }, ...window(q), orderBy });
  res.json(page(rows.map(o => ({ id: o.id, number: o.number, customerId: actor.role === 'STAFF' ? undefined : o.customerId, customer: o.customer, estimatedCompletionAt: o.estimatedCompletionAt, aggregateStatus: o.aggregateStatus, pricing: o.pricing, ...finances(o.pricing ? [{ finalPriceIdr: pricingSnapshot.parse(o.pricing).totalIdr }] : o.items,o.payments), itemCount: o.items.length })),q.limit));
}));
operations.get('/orders/:id', wrap(async (req,res) => { empty.parse(req.query); const order = { ...await getOrder(db,param(req)), publicOrigin: (await readDisplaySettings(db, config.APP_BASE_URL)).publicOrigin }; const actor = actorOf(res); if (actor.role === 'STAFF') { check(order.items.some(i => i.assignedUserId === actor.id),'FORBIDDEN',403); res.json({ ...order, customer: undefined, customerId: undefined, payments: undefined, items: order.items.filter(i => i.assignedUserId === actor.id) }); } else res.json(order); }));
operations.get('/orders/:id/tracking-token', authorize('OWNER','ADMIN'), wrap(async (req,res) => { empty.parse(req.query); const order = await db.order.findUnique({ where: { id: param(req) }, select: { trackingSecret: true } }); check(order,'NOT_FOUND',404); const trackingToken = order.trackingSecret && encryptionReady() ? z.string().regex(/^(?:[a-f0-9]{64}|[A-Za-z0-9_-]{22})$/).safeParse(unseal(order.trackingSecret)).data : undefined; res.json({ publicOrigin: (await readDisplaySettings(db, config.APP_BASE_URL)).publicOrigin, trackingToken }); }));
operations.patch('/orders/:id', authorize('OWNER','ADMIN'), mutation(z.object({ estimatedCompletionAt: date.optional(), pickupInstructions: notes.optional() }).strict(),async (tx,input,actor,id) => { check(await lockOrder(tx,id),'NOT_FOUND',404); await tx.order.update({ where: { id }, data: { ...input, ...(input.estimatedCompletionAt ? { estimatedCompletionAt: new Date(input.estimatedCompletionAt) } : {}) } }); await audit(tx,actor.id,'ORDER_UPDATED',id); return getOrder(tx,id); }));
operations.post('/orders/:id/pricing/confirm', authorize('OWNER','ADMIN'), mutation(z.object({ totalIdr: money, confirmed: z.literal(true), reason: notes.refine(v => v.trim().length > 0) }).strict(), async (tx,input,actor,id) => { const result = await confirmPricing(tx,id,input.totalIdr,actor.id); await tx.auditLog.create({ data: { actorUserId: actor.id, action: 'PRICING_CONFIRMATION_EVIDENCE', entityType: 'Order', entityId: id, metadata: { reason: input.reason } } }); return result; }));
operations.post('/orders/:id/items', authorize('OWNER','ADMIN'), mutation(item,async (tx,input,actor,id) => { check(await lockOrder(tx,id),'NOT_FOUND',404); const order = await getOrder(tx,id); check(order.paidIdr === 0 && !order.payments.length && order.aggregateStatus !== 'COMPLETED' && order.items.length < 50,'ORDER_LOCKED'); return addItem(tx,id,input,actor); },201));
operations.patch('/items/:id', authorize('OWNER','ADMIN'), mutation(item.omit({ initialNotes: true }).extend({ initialNotes: notes.optional() }).partial(),async (tx,input,actor,id) => { const current = await ownedItem(tx,id,actor); check(['RECEIVED','INSPECTION'].includes(current.status),'ITEM_LOCKED'); if (current.order.pricing) { const pricing = pricingSnapshot.parse(current.order.pricing); check(pricing.stage === 'ESTIMATE', 'PRICING_LOCKED'); check(input.quotedPriceIdr === undefined && (!input.serviceId || input.serviceId === pricing.serviceId), 'SMART_PRICE_AUTOMATIC'); } if (input.serviceId) { const s = await tx.service.findUnique({ where: { id: input.serviceId } }); check(s?.isActive,'SERVICE_INACTIVE'); const snapshot = current.order.pricing ? pricingSnapshot.parse(current.order.pricing) : null; await tx.orderItem.update({ where: { id }, data: { serviceName: snapshot?.version === 2 ? snapshot.name : s.name } }); } if (input.assignedUserId) { await tx.$queryRaw`SELECT id FROM User WHERE id = ${input.assignedUserId} FOR UPDATE`; check(await tx.user.count({ where: { id: input.assignedUserId, isActive: true, archivedAt: null } }),'USER_INACTIVE'); } const result = await tx.orderItem.update({ where: { id }, data: input }); await audit(tx,actor.id,'ITEM_UPDATED',id); return result; }));
operations.post('/items/:id/assignment', authorize('OWNER','ADMIN'), mutation(z.object({ assignedUserId: id.nullable() }).strict(),async (tx,input,actor,id) => { const current = await ownedItem(tx,id,actor); check(!['HANDED_OVER','RETURNED'].includes(current.status),'ITEM_CLOSED'); if (input.assignedUserId) { await tx.$queryRaw`SELECT id FROM User WHERE id = ${input.assignedUserId} FOR UPDATE`; check(await tx.user.count({ where: { id: input.assignedUserId,isActive:true,archivedAt:null } }),'USER_INACTIVE'); } await tx.orderItem.update({ where: { id },data:input }); await audit(tx,actor.id,'ITEM_ASSIGNED',id); return { id,...input }; }));
operations.post('/items/:id/transition', mutation(z.object({ toStatus: z.enum(ItemStatus), reason: notes.default(''), qcPassed: z.boolean().optional(), dryConfirmed: z.boolean().optional(), finishingConfirmed: z.boolean().optional() }).strict(),(tx,input,actor,id)=>transition(tx,id,input,actor)));
operations.post('/orders/:id/handover', authorize('OWNER','ADMIN'), mutation(empty, (tx,_input,actor,id)=>handoverOrder(tx,id,actor)));
operations.get('/settings/inspection-capabilities', authorize('OWNER','ADMIN'), (_req, res) => res.json({ structuredRiskConsent: true }));
operations.post('/items/:id/inspection', authorize('OWNER','ADMIN'), mutation(inspectionInput,(tx,input,actor,id)=>inspect(tx,id,input,actor)));
operations.post('/items/:id/decline-cleaning', authorize('OWNER','ADMIN'), mutation(z.object({ reason: notes.refine(v => v.trim().length > 0) }).strict(), async (tx,input,actor,id) => {
  const current = await ownedItem(tx,id,actor); check(current.order.pricing, 'LEGACY_PRICING'); check(!['HANDED_OVER','RETURNED','RETURN_PENDING'].includes(current.status), 'ITEM_CLOSED');
  await tx.consentDecision.updateMany({ where: { itemId: id, consumedAt: null }, data: { consumedAt: new Date(), decision: 'CANCELLED' } });
  await tx.orderItem.update({ where: { id }, data: { outcome: 'DECLINED', finalPriceIdr: 0 } });
  await change(tx,current,'RETURN_PENDING',actor.id,input.reason); return getOrder(tx,current.orderId);
}));
operations.post('/items/:id/consent/reissue', authorize('OWNER','ADMIN'), mutation(empty,(tx,_input,actor,id) => issueConsent(tx,id,actor)));
operations.post('/items/:id/consent/return', authorize('OWNER','ADMIN'), mutation(z.object({ reason: notes.refine(v => v.trim().length > 0) }).strict(), async (tx,input,actor,id) => { const current = await ownedItem(tx,id,actor); check(current.status === 'AWAITING_CONSENT','INVALID_TRANSITION'); await tx.consentDecision.updateMany({ where:{ itemId:id,consumedAt:null },data:{ consumedAt:new Date(),decision:'CANCELLED' } }); await tx.orderItem.update({ where:{id},data:{outcome:'DECLINED',finalPriceIdr:0} }); await change(tx,current,'RETURN_PENDING',actor.id,input.reason); return getOrder(tx,current.orderId); }));
for (const mode of ['rotate','revoke'] as const) operations.post(`/orders/:id/tracking-token/${mode}`,authorize('OWNER','ADMIN'),mutation(empty,async(tx,_input,actor,id) => { check(await lockOrder(tx,id),'NOT_FOUND',404); const raw = mode === 'rotate' ? randomTrackingToken() : null; await tx.order.update({where:{id},data:{trackingHash:raw ? hashToken(raw):null,trackingSecret:raw && encryptionReady() ? seal(raw):null}}); await audit(tx,actor.id,`TRACKING_${mode.toUpperCase()}`,id); return { publicOrigin: (await readDisplaySettings(tx, config.APP_BASE_URL)).publicOrigin, trackingToken:raw,trackingPath:raw ? `/api/v1/track/${raw}`:null }; }));
const payment = z.object({ amountIdr: money.refine(v=>v>0), method:z.enum(['QRIS','CASH','TRANSFER','EWALLET','OTHER']),reference:z.string().max(191).optional(),reason:notes.default(''),receivedAt:date }).strict();
operations.post('/orders/:id/payments',authorize('OWNER','ADMIN'),mutation(payment,(tx,input,actor,id)=>ledger(tx,id,{...input,kind:'PAYMENT'},actor),201));
operations.post('/orders/:id/refunds',authorize('OWNER'),mutation(payment,(tx,input,actor,id)=>ledger(tx,id,{...input,kind:'REFUND'},actor),201));
// Base64 ceiling includes padding; decoded byte limit remains authoritative.
operations.post('/items/:id/photos',express.json({limit:13982040}),mutation(z.object({kind:z.enum(['BEFORE','INSPECTION','AFTER']),customerVisible:z.boolean(),mime:z.enum(['image/png','image/jpeg']),base64:z.string().max(13981016)}).strict(),(tx,input,actor,id)=>uploadPhoto(tx,id,input,actor),201));
operations.delete('/photos/:id',authorize('OWNER','ADMIN'),mutation(empty,(tx,_input,actor,id)=>deletePhoto(tx,id,actor)));
operations.get('/photos/:id',wrap(async(req,res)=>{ empty.parse(req.query); const photo=await db.photo.findUnique({where:{id:param(req)},include:{item:{select:{assignedUserId:true}}}}); check(photo,'NOT_FOUND',404); if(actorOf(res).role==='STAFF') check(photo.item.assignedUserId===actorOf(res).id,'FORBIDDEN',403); res.type(photo.mime).set('Content-Disposition','inline').send(Buffer.from(photo.content)); }));
operations.get('/dashboard',wrap(async(req,res)=>{ const q=z.object({from:date.optional(),to:date.optional()}).strict().parse(req.query); check(!q.from || !q.to || q.from<=q.to,'VALIDATION_ERROR',400); const actor=actorOf(res); const orders=await db.order.findMany({where:actor.role==='STAFF'?{items:{some:{assignedUserId:actor.id}}}:{},include:{items:{select:{status:true}}}}); const active=orders.filter(o=>!o.archivedAt); const statuses=active.flatMap(o=>o.items.map(i=>i.status)); const payments=actor.role==='STAFF'?[]:await db.payment.findMany({where:{order:{isNot:null},receivedAt:{...(q.from?{gte:new Date(q.from)}:{}),...(q.to?{lte:new Date(q.to)}:{})}},select:{kind:true,amountIdr:true}}); res.json({activeOrders:active.filter(o=>o.aggregateStatus!=='COMPLETED').length,waitingInspection:statuses.filter(s=>['RECEIVED','INSPECTION'].includes(s)).length,awaitingConsent:statuses.filter(s=>s==='AWAITING_CONSENT').length,inProgress:statuses.filter(s=>['WASHING','DRYING','PACKING','FINISHING','QC','REWORK'].includes(s)).length,readyForPickup:statuses.filter(s=>s==='READY_FOR_PICKUP').length,overdue:active.filter(o=>o.aggregateStatus!=='COMPLETED'&&o.estimatedCompletionAt<new Date()).length,revenueIdr:actor.role==='STAFF'?undefined:payments.reduce((n,p)=>n+(p.kind==='REFUND'?-p.amountIdr:p.amountIdr),0)}); }));
operations.get('/notifications',authorize('OWNER','ADMIN'),wrap(async(req,res)=>{const q=paging.extend({status:z.enum(['PENDING','PROCESSING','SENT','SIMULATED','FAILED','SKIPPED']).optional(),template:z.string().max(100).optional(),orderId:id.optional()}).strict().parse(req.query);res.json({...page((await db.notificationEvent.findMany({where:{status:q.status,template:q.template,orderId:q.orderId,...(q.q?{OR:[{recipient:{contains:q.q}},{template:{contains:q.q}},{eventKey:{contains:q.q}}]}:{})},include:{attempts:{orderBy:{attemptNo:'asc'}}},...window(q)})).map(({encryptedMessage: _secret, ...event}) => event),q.limit),provider:'whatsapp-web.js',actualOutbound:false});}));
operations.post('/notifications/:id/retry',authorize('OWNER','ADMIN'),mutation(empty,async(tx,_input,_actor,id)=>{check(await tx.notificationEvent.findUnique({where:{id}}),'NOT_FOUND',404);check(false,'NOT_RETRYABLE');},202));
operations.get('/audit',authorize('OWNER'),wrap(async(req,res)=>{
  const q=paging.extend({action:z.string().max(100).optional(),entityType:z.string().max(100).optional(),outcome:z.enum(['SUCCESS','FAILED']).optional(),requestId:z.uuid().optional(),from:date.optional(),to:date.optional()}).strict().parse(req.query);
  check(!q.from || !q.to || q.from<=q.to,'VALIDATION_ERROR',400);
  const where: Prisma.AuditLogWhereInput = {action:q.action,entityType:q.entityType,occurredAt:{gte:q.from ? new Date(q.from):undefined,lte:q.to ? new Date(q.to):undefined},AND:[...(q.q ? [{OR:[{action:{contains:q.q}},{entityType:{contains:q.q}},{entityId:{contains:q.q}}]}]:[]),...(q.outcome ? [{metadata:{path:'$.outcome',equals:q.outcome}}]:[]),...(q.requestId ? [{metadata:{path:'$.requestId',equals:q.requestId}}]:[])]};
  const rows=await db.auditLog.findMany({where,...window(q),orderBy:[{occurredAt:'desc'},{id:'desc'}]});
  const actors=await db.user.findMany({where:{id:{in:rows.flatMap(r=>r.actorUserId ? [r.actorUserId]:[])}},select:{id:true,name:true}});
  res.json(page(rows.map(r=>({...r,createdAt:r.occurredAt,actorUser:actors.find(a=>a.id===r.actorUserId) ?? null})),q.limit));
}));
export const operationErrors: express.ErrorRequestHandler = (error,_req,res,next)=>{if(error instanceof ApiError){res.status(error.status).json({error:{code:error.code,message:error.message}});return;}if(error instanceof Prisma.PrismaClientKnownRequestError){if(['P2002','P2034'].includes(error.code)){res.status(409).json({error:{code:'CONFLICT',message:'Duplicate or concurrent mutation. Retry with the same idempotency key.'}});return;}if(error.code==='P2025'){res.status(404).json({error:{code:'NOT_FOUND',message:'Record not found'}});return;}if(error.code==='P2003'){res.status(409).json({error:{code:'CONFLICT',message:'Related record unavailable'}});return;}}next(error);};
