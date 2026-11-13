import { z } from 'zod';
import { readDisplaySettings } from './display-settings.js';
import { calculatePricing, initialPricing, planPricing, pricingSnapshot, type RateMode } from './pricing.js';
import { lockedPlan } from './rate-plans.js';
import { config } from '../lib/config.js';
import { defaults, templateWrite, renderTemplate, customerText, encryptionReady, seal, unseal, trackingLink } from './whatsapp-templates.js';
import { safeMetadata } from '../lib/audit.js';
import { type ItemStatus, type Role } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import { notificationBlocker } from '../lib/whatsapp-control.js';
import { hashToken, randomToken, randomTrackingToken } from '../lib/security.js';
import { audit, detail, lockItem, lockOrder, type Tx } from '../repositories/orders.js';
export class ApiError extends Error { constructor(public status: number, public code: string, message = code) { super(message); } }
export function check(value: unknown, code = 'CONFLICT', status = 409): asserts value { if (!value) throw new ApiError(status, code); }
export type Actor = { id: string; role: Role };
export function admin(actor: Actor) { check(actor.role !== 'STAFF', 'FORBIDDEN', 403); }
export const transitions: Partial<Record<ItemStatus, ItemStatus[]>> = { RECEIVED: ['INSPECTION'], QUEUED: ['WASHING'], WASHING: ['DRYING'], DRYING: ['PACKING', 'READY_FOR_PICKUP', 'REWORK'], PACKING: ['READY_FOR_PICKUP', 'REWORK'], FINISHING: ['READY_FOR_PICKUP', 'REWORK', 'QC'], QC: ['READY_FOR_PICKUP', 'REWORK'], REWORK: ['WASHING', 'FINISHING'], READY_FOR_PICKUP: ['HANDED_OVER'] };
export function aggregate(statuses: string[]) {
  if (statuses.every(s => ['HANDED_OVER', 'RETURNED'].includes(s))) return 'COMPLETED';
  if (statuses.length && statuses.every(s => ['READY_FOR_PICKUP', 'RETURN_PENDING', 'HANDED_OVER', 'RETURNED'].includes(s)) && statuses.includes('READY_FOR_PICKUP')) return 'READY_FOR_PICKUP';
  if (statuses.some(s => ['WASHING', 'DRYING', 'PACKING', 'FINISHING', 'QC', 'REWORK', 'READY_FOR_PICKUP'].includes(s))) return 'IN_PROGRESS';
  if (statuses.includes('AWAITING_CONSENT')) return 'AWAITING_CONSENT';
  if (statuses.some(s => ['RECEIVED', 'INSPECTION'].includes(s))) return 'WAITING_INSPECTION';
  if (statuses.includes('RETURN_PENDING')) return 'RETURN_PENDING';
  return 'QUEUED';
}
export function finances(items: { finalPriceIdr: number }[], payments: { kind: string; amountIdr: number }[]) {
  const totalIdr = items.reduce((n, i) => n + i.finalPriceIdr, 0);
  const paidIdr = payments.reduce((n, p) => n + (p.kind === 'REFUND' ? -p.amountIdr : p.amountIdr), 0);
  return { totalIdr, paidIdr, balanceIdr: totalIdr - paidIdr, refundDueIdr: Math.max(0, paidIdr - totalIdr), paymentStatus: paidIdr === 0 ? payments.some(p => p.kind === 'REFUND') ? 'REFUNDED' : 'UNPAID' : paidIdr < totalIdr ? 'PARTIAL' : 'PAID' };
}
export async function getOrder(tx: Tx, id: string) { const order = await tx.order.findUnique({ where: { id }, include: detail }); check(order, 'NOT_FOUND', 404); return { ...order, trackingHash: undefined, trackingSecret: undefined, ...finances(order.pricing ? [{ finalPriceIdr: pricingSnapshot.parse(order.pricing).totalIdr }] : order.items, order.payments) }; }
export async function refresh(tx: Tx, orderId: string) { await reprice(tx, orderId); const items = await tx.orderItem.findMany({ where: { orderId }, select: { status: true } }); await tx.order.update({ where: { id: orderId }, data: { aggregateStatus: aggregate(items.map(i => i.status)) } }); }
export async function reprice(tx: Tx, orderId: string, actor: string | null = null, cancellation = false) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { items: { include: { inspection: true } } } });
  if (!order.pricing) return;
  const previous = pricingSnapshot.parse(order.pricing);
  const remaining = order.items.filter(i => !['REJECTED', 'DECLINED'].includes(i.outcome ?? '')).length;
  // Opt in only on a new cancellation transition, never by reading/backfilling old orders.
  const basis = cancellation && !previous.cancellation && remaining < previous.pairs
    ? { ...previous, cancellation: { originalTotalIdr: previous.totalIdr, originalPairs: previous.pairs, originalAllocations: { ...previous.allocations } } }
    : previous;
  let pricing = calculatePricing(basis, order.items);
  const frozen = order.items.filter(i => ['WASHING', 'DRYING', 'PACKING', 'FINISHING', 'QC', 'REWORK', 'READY_FOR_PICKUP', 'HANDED_OVER'].includes(i.status) && !['REJECTED', 'DECLINED'].includes(i.outcome ?? ''));
  if (frozen.length) {
    pricing = {
      ...pricing,
      allocations: { ...pricing.allocations, ...Object.fromEntries(frozen.map(i => [i.id, i.finalPriceIdr])) },
    };
    pricing.totalIdr = Object.values(pricing.allocations).reduce((total, value) => total + value, 0);
  }
  const verifier = actor ?? order.items.find(i => i.inspection)?.inspection?.actorUserId;
  const verified = pricing.stage === 'FINAL' && previous.stage === 'ESTIMATE' && !!verifier && order.items.every(i => i.inspection);
  if (verified) pricing = { ...pricing, verifiedAt: new Date().toISOString(), verifiedBy: verifier! };
  for (const item of order.items) {
    const quotedPriceIdr = pricing.allocations[item.id] ?? 0;
    const finalPriceIdr = pricing.stage === 'ESTIMATE' && !frozen.some(frozenItem => frozenItem.id === item.id) ? 0 : quotedPriceIdr;
    if (item.quotedPriceIdr !== quotedPriceIdr || item.finalPriceIdr !== finalPriceIdr) await tx.orderItem.update({ where: { id: item.id }, data: { quotedPriceIdr, finalPriceIdr } });
  }
  if (JSON.stringify(previous) === JSON.stringify(pricing)) return;
  await tx.order.update({ where: { id: orderId }, data: { pricing } });
  await tx.auditLog.create({ data: { actorUserId: actor, action: cancellation ? 'PRICING_CANCELLATION_RECALCULATED' : verified ? 'PRICING_STAFF_VERIFIED' : 'PRICING_UPDATED', entityType: 'Order', entityId: orderId, metadata: { before: previous, after: pricing } } });
}
export async function requireVerifiedPricing(tx: Tx, id: string) {
  const order = await getOrder(tx, id);
  if (!order.pricing) return;
  const pricing = pricingSnapshot.parse(order.pricing);
  check(pricing.stage !== 'ESTIMATE', 'PRICE_NOT_FINAL');
  check(order.items.every(i => ['REJECTED', 'DECLINED'].includes(i.outcome ?? '') || (i.inspection && i.outcome && !['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT'].includes(i.status) &&
    (i.outcome === 'APPROVED' || (i.outcome === 'NEEDS_CONSENT' && i.consents.some(c => c.decision === 'APPROVE' && c.consumedAt))))), 'PRICE_NOT_FINAL');
  const frozen = order.items.some(i => ['WASHING', 'DRYING', 'PACKING', 'FINISHING', 'QC', 'REWORK', 'READY_FOR_PICKUP', 'HANDED_OVER'].includes(i.status));
  const expected = calculatePricing(pricing, order.items);
  check((frozen
    ? expected.pairs === pricing.pairs && Object.keys(pricing.allocations).length === order.items.length && Object.values(pricing.allocations).reduce((total, value) => total + value, 0) === pricing.totalIdr && order.items.every(i => !['REJECTED', 'DECLINED'].includes(i.outcome ?? '') || pricing.allocations[i.id] === 0)
    : expected.totalIdr === pricing.totalIdr && expected.pairs === pricing.pairs && order.items.every(i => expected.allocations[i.id] === pricing.allocations[i.id])) && order.items.every(i =>
    i.finalPriceIdr === pricing.allocations[i.id] && i.quotedPriceIdr === pricing.allocations[i.id]), 'PRICE_CHANGED');
}
export async function confirmPricing(tx: Tx, id: string, totalIdr: number, actor: string | null) {
  check(await lockOrder(tx, id), 'NOT_FOUND', 404);
  await reprice(tx, id, actor);
  const order = await getOrder(tx, id); check(order.pricing, 'LEGACY_PRICING');
  const pricing = pricingSnapshot.parse(order.pricing);
  check(pricing.stage !== 'ESTIMATE', 'PRICE_NOT_FINAL'); check(pricing.totalIdr === totalIdr, 'PRICE_CHANGED');
  if (pricing.stage !== 'LOCKED') {
    const locked = { ...pricing, stage: 'LOCKED' as const, agreedTotalIdr: pricing.totalIdr, agreedAllocations: { ...pricing.allocations }, lockedAt: new Date().toISOString() };
    await tx.order.update({ where: { id }, data: { pricing: locked } });
    await tx.auditLog.create({ data: { actorUserId: actor, action: 'PRICING_CONFIRMED', entityType: 'Order', entityId: id, metadata: { before: pricing, after: locked } } });
  }
  return getOrder(tx, id);
}
export async function notify(tx: Tx, orderId: string, template: string, key: string, itemId?: string, expectedStatus?: string) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { customer: true, items: { orderBy: { id: 'asc' } } } });
  const settings = await tx.storeSettings.findUnique({ where: { id: 1 } });
  const activation = settings?.waActivation;
  let reason = order.archivedAt || order.customer.archivedAt ? 'ARCHIVED' : !order.customer.notificationConsentAt ? 'NO_CURRENT_OPT_IN' : await notificationBlocker(activation);
  let message = ''; let encryptedMessage: string | undefined;
  try {
    const saved = settings?.waTemplates ? templateWrite.array().parse(settings.waTemplates) : [];
    const definition = saved.find(t => t.event === template) ?? defaults.find(t => t.event === template);
    if (!definition || !order.trackingSecret || !order.trackingHash || !encryptionReady()) throw new Error('MESSAGE_UNAVAILABLE');
    const raw = unseal(order.trackingSecret); if (typeof raw !== 'string' || hashToken(raw) !== order.trackingHash) throw new Error('TRACKING_UNAVAILABLE');
    const shoe = (i: typeof order.items[number]) => [i.brand, i.model, i.color].map(customerText).join(' ');
    let rendered = renderTemplate(definition.body, {
      sapaan: order.customer.salutation ?? 'Kak', nama_pelanggan: customerText(order.customer.name), total_sepatu: String(order.items.length), nomor_pesanan: order.number,
      detail_sepatu: order.items.map(i => `• ${shoe(i)}`).join('\n'),
      sepatu: itemId ? shoe(order.items.find(i => i.id === itemId)!) : 'seluruh sepatu pada pesanan',
      url_tracking: trackingLink((await readDisplaySettings(tx, config.APP_BASE_URL)).publicOrigin, raw),
    });
    if (template === 'CONSENT_REQUEST') {
      const consent = await tx.consentDecision.findUnique({ where: { id: key } });
      if (!consent) throw new Error('CONSENT_UNAVAILABLE');
      const publicText = (value: string) => value.replace(/[\p{Cc}\u202a-\u202e\u2066-\u2069]/gu, ' ');
      rendered += consent.findings ? `\nTemuan: ${publicText(consent.findings)}\nRisiko: ${publicText(consent.risk)}${consent.customerNote ? `\nCatatan: ${publicText(consent.customerNote)}` : ''}` : `\nDeskripsi risiko (legacy): ${publicText(consent.risk)}`;
    }
    if (template !== 'CONSENT_REQUEST' && order.pricing) { const p = pricingSnapshot.parse(order.pricing); rendered += `\n${p.stage === 'ESTIMATE' ? 'Estimasi biaya (belum final)' : p.stage === 'FINAL' ? 'Total final hasil verifikasi staf' : 'Harga disetujui/terkunci'}: Rp${p.totalIdr.toLocaleString('id-ID')}. Ditolak/tidak menyetujui risiko: Rp0. Persetujuan risiko tetap terpisah.`; }
    // History never exposes bearer links. The immutable customer snapshot stays encrypted.
    message = renderTemplate(definition.body, { sapaan: '[sapaan]', nama_pelanggan: '[pelanggan]', total_sepatu: String(order.items.length), nomor_pesanan: order.number, detail_sepatu: '[detail sepatu]', sepatu: '[sepatu terkait]', url_tracking: '[tautan privat]' });
    encryptedMessage = seal({ message: rendered, trackingHash: order.trackingHash });
  } catch { reason ??= 'MESSAGE_UNAVAILABLE'; message = 'Pesan pelanggan tidak tersedia; tidak dikirim.'; }

  const existing = await tx.notificationEvent.findUnique({where:{eventKey:key}});
  const event = await tx.notificationEvent.upsert({ where: { eventKey: key }, create: { provider: 'whatsapp-web.js', status: reason ? 'SKIPPED' : 'PENDING', ...(reason ? { attempts: { create: { attemptNo: 1, provider: 'whatsapp-web.js', status: 'SKIPPED', response: { reason, generation: 0, actualOutbound: false, delivery: 'skipped' } } } } : {}), activation, eventKey: key, orderId, itemId, expectedStatus, template, recipient: order.customer.whatsapp, optedIn: !!order.customer.notificationConsentAt, message, encryptedMessage }, update: {} });
  if (!existing) await tx.auditLog.create({data:{action:reason ? 'NOTIFICATION_SKIPPED':'NOTIFICATION_QUEUED',entityType:'NotificationEvent',entityId:event.id,metadata:safeMetadata({...(reason ? {reason}:{}),actualOutbound:false})}});
  return event;
}
export async function change(tx: Tx, item: { id: string; status: ItemStatus; orderId: string }, toStatus: ItemStatus, actor: string | null, reason: string) {
  const fromStatus = item.status;
  await tx.orderItem.update({ where: { id: item.id }, data: { status: toStatus } });
  const history = await tx.statusHistory.create({ data: { itemId: item.id, fromStatus, toStatus, actorUserId: actor, reason } });
  await audit(tx, actor, `ITEM_${toStatus}`, item.id);
  await reprice(tx, item.orderId, actor, toStatus === 'RETURN_PENDING');
  await refresh(tx, item.orderId);
  const items = await tx.orderItem.findMany({ where: { orderId: item.orderId }, select: { id: true, status: true } });
  const ready = aggregate(items.map(i => i.status)) === 'READY_FOR_PICKUP';
  const wasReady = aggregate(items.map(i => i.id === item.id ? fromStatus : i.status)) === 'READY_FOR_PICKUP';
  if (toStatus !== 'READY_FOR_PICKUP') await notify(tx, item.orderId, toStatus, history.id, item.id, toStatus);
  if (ready && !wasReady) await notify(tx, item.orderId, 'READY_FOR_PICKUP', `pickup:${history.id}`);
}
export type ItemInput = { serviceId: string; brand: string; model?: string; color?: string; initialNotes: string; quotedPriceIdr?: number; assignedUserId?: string | null };
export async function addItem(tx: Tx, orderId: string, input: ItemInput, actor: Actor) {
  const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
  check(!order.archivedAt, 'ARCHIVED');
  if (order.pricing) { const pricing = pricingSnapshot.parse(order.pricing); check(pricing.stage === 'ESTIMATE', 'PRICING_LOCKED'); check(input.serviceId === pricing.serviceId, 'PACKAGE_SERVICE_MISMATCH'); check(input.quotedPriceIdr === undefined, 'SMART_PRICE_AUTOMATIC'); }
  const service = await tx.service.findUnique({ where: { id: input.serviceId } }); check(service?.isActive, 'SERVICE_INACTIVE');
  if (input.assignedUserId) { await tx.$queryRaw`SELECT id FROM User WHERE id = ${input.assignedUserId} FOR UPDATE`; check(await tx.user.count({ where: { id: input.assignedUserId, isActive: true, archivedAt: null } }), 'USER_INACTIVE'); }
  const snapshot = order.pricing ? pricingSnapshot.parse(order.pricing) : null;
  const item = await tx.orderItem.create({ data: { ...input, model: input.model ?? '', color: input.color ?? '', orderId, serviceName: snapshot?.version === 2 ? snapshot.name : service.name, quotedPriceIdr: input.quotedPriceIdr ?? service.basePriceIdr } });
  await tx.statusHistory.create({ data: { itemId: item.id, toStatus: 'RECEIVED', actorUserId: actor.id, reason: 'Order intake' } });
  await audit(tx, actor.id, 'ITEM_CREATED', item.id); await refresh(tx, orderId); return item;
}
export function completionEstimate(createdAt: Date, policy: 'REGULAR' | 'FAST' = 'REGULAR'): Date {
  // WIB is UTC+7 without DST; UTC setters keep calendar arithmetic independent of host timezone.
  const wib = new Date(createdAt.getTime() + 7 * 3600000);
  if (policy === 'FAST') {
    const cutoff = Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate(), 17);
    const days = wib.getTime() <= cutoff ? 1 : 2;
    return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + days, 10));
  }
  const days = wib.getUTCHours() < 12 ? 4 : 5;
  return new Date(Date.UTC(wib.getUTCFullYear(), wib.getUTCMonth(), wib.getUTCDate() + days, 16, 59, 59, 999));
}
export const cleaningService = { id: 'cicuci-cleaning-v1', name: 'Cuci sepatu', basePriceIdr: 0, isActive: true } as const;
export async function createOrder(tx: Tx, input: { customerId: string; estimatedCompletionAt?: string; pickupInstructions?: string; ratePlanId?: string; rateMode?: RateMode; packageServiceId?: string; items: (Omit<ItemInput, 'serviceId'> & { serviceId?: string })[] }, actor: Actor) {
  admin(actor);
  await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${input.customerId} FOR UPDATE`;
  check(await tx.customer.count({ where: { id: input.customerId, archivedAt: null } }), 'CUSTOMER_NOT_FOUND', 404);
  check(!(input.ratePlanId && input.rateMode), 'PRICING_SELECTION_CONFLICT', 400);
  check(input.ratePlanId || input.rateMode || !input.packageServiceId, 'RATE_MODE_REQUIRED');
  const plan = input.ratePlanId ? await lockedPlan(tx, input.ratePlanId) : null;
  if (plan) check(plan.isActive, 'RATE_PLAN_INACTIVE');
  let serviceId: string | undefined;
  if (plan || input.rateMode) {
    check((!input.packageServiceId || input.packageServiceId === cleaningService.id) && input.items.every(i => (!i.serviceId || i.serviceId === cleaningService.id) && i.quotedPriceIdr === undefined), 'PACKAGE_SERVICE_MISMATCH');
    // Reserved identity only: never repurpose a historical catalog service.
    const service = await tx.service.upsert({ where: { id: cleaningService.id }, create: cleaningService, update: {} });
    check(service.name === cleaningService.name && service.basePriceIdr === 0 && service.isActive, 'INTERNAL_SERVICE_CONFLICT');
    serviceId = service.id;
  } else check(input.items.every(i => i.serviceId), 'SERVICE_REQUIRED');
  const settings = await tx.storeSettings.findUnique({ where: { id: 1 } }); const token = randomTrackingToken();
  const createdAt = new Date();
  const pricing = plan ? planPricing(plan, serviceId!, input.items.length) : input.rateMode ? initialPricing(input.rateMode, serviceId!, input.items.length) : null;
  const order = await tx.order.create({ data: { customerId: input.customerId, ...(pricing ? { pricing } : {}), createdAt, number: `CS-${createdAt.toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,8).toUpperCase()}`, estimatedCompletionAt: completionEstimate(createdAt, pricing?.version === 2 ? pricing.turnaroundPolicy : 'REGULAR'), pickupInstructions: input.pickupInstructions ?? settings?.pickupInstructions ?? '', trackingHash: hashToken(token), trackingSecret: encryptionReady() ? seal(token) : null } });
  for (const item of input.items) await addItem(tx, order.id, { ...item, serviceId: serviceId ?? item.serviceId! }, actor);
  await reprice(tx, order.id, actor.id);
  const notification = await notify(tx, order.id, 'ORDER_RECEIVED', `receipt:${order.id}`); await audit(tx, actor.id, 'ORDER_CREATED', order.id);
  return { ...await getOrder(tx, order.id), notification: { status: notification.status, reason: ((await tx.notificationAttempt.findFirst({ where: { eventId: notification.id }, orderBy: { attemptNo: 'desc' } }))?.response as { reason?: string } | null)?.reason, actualOutbound: false }, publicOrigin: (await readDisplaySettings(tx, config.APP_BASE_URL)).publicOrigin, trackingToken: token, trackingPath: `/api/v1/track/${token}` };
}
export async function ownedItem(tx: Tx, id: string, actor: Actor) { const item = await lockItem(tx, id); check(item, 'NOT_FOUND', 404); check(!item.order.archivedAt, 'ARCHIVED'); if (actor.role === 'STAFF') check(item.assignedUserId === actor.id, 'FORBIDDEN', 403); return item; }
export async function transition(tx: Tx, id: string, input: { toStatus: ItemStatus; reason: string; qcPassed?: boolean; dryConfirmed?: boolean; finishingConfirmed?: boolean }, actor: Actor) {
  const item = await ownedItem(tx, id, actor); check(transitions[item.status]?.includes(input.toStatus), 'INVALID_TRANSITION');
  if (['HANDED_OVER', 'RETURNED'].includes(input.toStatus)) {
    admin(actor);
    const order = await getOrder(tx, item.orderId);
    check(order.items.every(i => i.outcome && !['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT'].includes(i.status)), 'PRICE_NOT_FINAL');
    await requireVerifiedPricing(tx, item.orderId);
    check(order.balanceIdr <= 0, 'PAYMENT_REQUIRED');
  }
  if (input.toStatus === 'WASHING') {
    check(item.inspection && (item.outcome === 'APPROVED' || (item.outcome === 'NEEDS_CONSENT' && item.consents.some(c => c.decision === 'APPROVE' && c.consumedAt))), 'CONSENT_REQUIRED');
    if (item.order?.pricing) await tx.orderItem.update({ where: { id }, data: { finalPriceIdr: item.quotedPriceIdr } });
  }
  if (input.toStatus === 'READY_FOR_PICKUP') {
    check(input.qcPassed === true && item.photos.some(p => p.kind === 'AFTER' && p.customerVisible), 'QC_PHOTO_REQUIRED');
    check(input.dryConfirmed === true && input.finishingConfirmed === true, 'READY_CONFIRMATION_REQUIRED');
    check(item.inspection && (item.outcome === 'APPROVED' || (item.outcome === 'NEEDS_CONSENT' && item.consents.some(c => c.decision === 'APPROVE' && c.consumedAt))), 'CONSENT_REQUIRED');
    await audit(tx, actor.id, 'READY_DRY_FINISHING_QC_CONFIRMED', id);
  }
  if (input.toStatus === 'REWORK') check(input.qcPassed === false && input.reason.trim(), 'QC_REASON_REQUIRED');
  if (['REWORK', 'READY_FOR_PICKUP'].includes(input.toStatus)) await tx.orderItem.update({ where: { id }, data: { qcPassed: input.qcPassed } });
  if (input.toStatus === 'REWORK') await tx.orderItem.update({ where: { id }, data: { qcPassed: false } });
  await change(tx, item, input.toStatus, actor.id, input.reason); const order = await getOrder(tx, item.orderId); return actor.role === 'STAFF' ? { ...order, customer: undefined, customerId: undefined, payments: undefined, items: order.items.filter(i => i.assignedUserId === actor.id) } : order;
}
export async function handoverOrder(tx: Tx, id: string, actor: Actor) {
  admin(actor); const order = await getOrder(tx, id);
  check(order.items.length > 0 && order.items.every(item => ['READY_FOR_PICKUP', 'RETURN_PENDING'].includes(item.status)), 'ORDER_NOT_READY');
  await requireVerifiedPricing(tx, id);
  check(order.balanceIdr <= 0, 'PAYMENT_REQUIRED');
  for (const item of order.items) {
    if (item.status === 'READY_FOR_PICKUP') await transition(tx, item.id, { toStatus: 'HANDED_OVER', reason: '' }, actor);
    else await change(tx, item, 'RETURNED', actor.id, '');
  }
  return getOrder(tx, id);
}
export async function issueConsent(tx: Tx, id: string, actor: Actor) {
  const item = await ownedItem(tx, id, actor); check(item.status === 'AWAITING_CONSENT' && item.inspection, 'INVALID_TRANSITION');
  await tx.consentDecision.updateMany({ where: { itemId: id, consumedAt: null }, data: { consumedAt: new Date(), decision: 'REISSUED' } });
  const settings = await tx.storeSettings.findUnique({ where: { id: 1 } }); const approvalToken = randomToken();
  const consent = await tx.consentDecision.create({ data: { itemId: id, tokenHash: hashToken(approvalToken), findings: item.inspection.findings, customerNote: item.inspection.customerNote, risk: item.inspection.risk, quotedPriceIdr: item.inspection.quotedPriceIdr, expiresAt: new Date(Date.now() + (settings?.consentHours ?? 48) * 3600000) } });
  await notify(tx, item.orderId, 'CONSENT_REQUEST', consent.id, id, 'AWAITING_CONSENT'); await audit(tx, actor.id, 'CONSENT_ISSUED', id);
  return { approvalToken, expiresAt: consent.expiresAt, consentId: consent.id };
}
export const inspectionInput = z.object({
  outcome: z.enum(['APPROVED', 'NEEDS_CONSENT', 'REJECTED']),
  notes: z.string().max(4000).default(''),
  findings: z.string().trim().max(3000).optional(),
  risk: z.string().trim().max(3000).default(''),
  customerNote: z.string().trim().max(3000).optional(),
  quotedPriceIdr: z.number().int().min(0).max(100000000).optional(),
}).strict().superRefine((v, ctx) => {
  if (v.outcome === 'NEEDS_CONSENT') for (const field of ['findings', 'risk'] as const) {
    if ((v[field]?.length ?? 0) < 3 || !/[\p{L}\p{N}]/u.test(v[field] ?? '')) ctx.addIssue({ code: 'custom', path: [field], message: 'Minimal 3 karakter bermakna.' });
  }
});
export async function inspect(tx: Tx, id: string, input: z.input<typeof inspectionInput>, actor: Actor) {
  const parsed = inspectionInput.parse(input);
  input = parsed;
  const item = await ownedItem(tx, id, actor); check(['RECEIVED', 'INSPECTION'].includes(item.status), 'INVALID_TRANSITION'); check(item.photos.some(p => p.kind === 'BEFORE'), 'BEFORE_PHOTO_REQUIRED');
  const smart = !!item.order?.pricing; check(smart || input.quotedPriceIdr !== undefined, 'PRICE_REQUIRED'); check(!smart || input.quotedPriceIdr === undefined, 'SMART_PRICE_AUTOMATIC');
  const quotedPriceIdr = smart ? item.quotedPriceIdr : input.quotedPriceIdr!;
  await tx.inspection.create({ data: { ...parsed, findings: parsed.findings || null, customerNote: parsed.customerNote || null, quotedPriceIdr, itemId: id, actorUserId: actor.id } });
  await tx.orderItem.update({ where: { id }, data: { outcome: input.outcome, quotedPriceIdr, finalPriceIdr: input.outcome === 'APPROVED' ? quotedPriceIdr : 0 } });
  await change(tx, item, input.outcome === 'APPROVED' ? 'QUEUED' : input.outcome === 'REJECTED' ? 'RETURN_PENDING' : 'AWAITING_CONSENT', actor.id, parsed.notes);
  const consent = input.outcome === 'NEEDS_CONSENT' ? await issueConsent(tx, id, actor) : undefined;
  return { order: await getOrder(tx, item.orderId), consent };
}
export async function publicOrder(tx: Tx, token: string) { const order = await tx.order.findUnique({ where: { trackingHash: hashToken(token) }, include: detail }); check(order, 'TOKEN_INVALID', 404); return order; }
export async function decide(tx: Tx, token: string, itemId: string, decision: 'APPROVE' | 'DECLINE') {
  const order = await publicOrder(tx, token); await lockOrder(tx, order.id); await publicOrder(tx, token);
  const consent = await tx.consentDecision.findFirst({ where: { itemId, consumedAt: null }, include: { item: true } });
  check(consent && consent.item.orderId === order.id, 'TOKEN_INVALID'); check(consent.expiresAt > new Date(), 'TOKEN_EXPIRED', 410); check(consent.item.status === 'AWAITING_CONSENT', 'INVALID_TRANSITION');
  await tx.consentDecision.update({ where: { id: consent.id }, data: { consumedAt: new Date(), decision } });
  await tx.orderItem.update({ where: { id: consent.itemId }, data: { finalPriceIdr: decision === 'APPROVE' ? consent.quotedPriceIdr : 0, ...(decision === 'DECLINE' ? { outcome: 'DECLINED' } : {}) } });
  await change(tx, consent.item, decision === 'APPROVE' ? 'QUEUED' : 'RETURN_PENDING', null, `Customer ${decision}`); return { decision };
}
export async function ledger(tx: Tx, id: string, input: { kind: 'PAYMENT' | 'REFUND'; amountIdr: number; method: string; reference?: string; reason: string; receivedAt: string }, actor: Actor) {
  check(await lockOrder(tx, id), 'NOT_FOUND', 404); const order = await getOrder(tx, id);
  if (input.kind === 'PAYMENT') { await requireVerifiedPricing(tx, id); check(order.items.every(i => i.outcome && i.status !== 'AWAITING_CONSENT'), 'PRICE_NOT_FINAL'); check(input.amountIdr <= order.balanceIdr, 'OVERPAYMENT'); }
  else check(input.amountIdr <= order.paidIdr && input.reason.trim(), 'INVALID_REFUND');
  await tx.payment.create({ data: { ...input, orderId: id, originalOrderId: order.id, originalOrderNumber: order.number, actorUserId: actor.id, receivedAt: new Date(input.receivedAt) } }); await audit(tx, actor.id, input.kind, id); return getOrder(tx, id);
}
