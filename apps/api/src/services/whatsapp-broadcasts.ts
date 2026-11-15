import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Tx } from '../repositories/orders.js';
import { workerSnapshot } from '../lib/whatsapp-control.js';
import { check } from './orders.js';
import { broadcastPayload, encryptionReady, seal, unseal } from './whatsapp-templates.js';

export const broadcastMessage = z.string().trim().min(1).max(4000).regex(/[^\s]/).refine(v => ![...v].some(c => ((c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) && c !== '\n' && c !== '\t') || /[\u202a-\u202e\u2066-\u2069]/u.test(c)));
export const broadcastPreview = z.object({ message: broadcastMessage, scope: z.literal('SERVICE_INFORMATION') }).strict();
export const broadcastConfirmation = z.object({ previewId: z.uuid(), confirmed: z.literal(true), serviceOnly: z.literal(true) }).strict();
const audience = z.object({ id: z.string(), name: z.string(), whatsapp: z.string().regex(/^\+[1-9]\d{7,14}$/), consentAt: z.string() }).strict();
const draft = z.object({ actorId: z.string(), expiresAt: z.number(), activation: z.string().nullish(), message: broadcastMessage, recipients: z.array(audience.extend({ rendered: broadcastMessage.optional() })).min(1).max(500) }).strict();
export async function broadcastReady(tx: Tx) {
  check(encryptionReady(), 'MESSAGE_ENCRYPTION_UNAVAILABLE', 503);
  const activation = (await tx.storeSettings.findUnique({ where: { id: 1 } }))?.waActivation;
  check(activation, 'NOT_ENABLED', 409);
  const state = await workerSnapshot();
  check(state?.ready && state.realSendEnabled && state.activation === activation && state.broadcastVersion === 1, 'BROADCAST_WORKER_NOT_READY', 503);
  return activation;
}
export async function previewBroadcast(tx: Tx, input: z.infer<typeof broadcastPreview>, actorId: string) {
  check(encryptionReady(), 'MESSAGE_ENCRYPTION_UNAVAILABLE', 503);
  // ponytail: bounded single campaign, reject over 500; add paginated campaigns when needed.
  const customers = await tx.customer.findMany({ where: { archivedAt: null, notificationConsentAt: { not: null } }, orderBy: { id: 'asc' }, take: 501 });
  check(customers.length > 0 && customers.length <= 500, 'BROADCAST_AUDIENCE_LIMIT');
  check(!/[{}]/.test(input.message.replaceAll('{customer_name}', '')), 'BROADCAST_PLACEHOLDER_INVALID', 400);
  const recipients = customers.map(c => {
    const recipient = audience.parse({ id: c.id, name: c.name, whatsapp: c.whatsapp, consentAt: c.notificationConsentAt!.toISOString() });
    const name = [...recipient.name].map(c => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 || /[\u202a-\u202e\u2066-\u2069]/u.test(c) ? ' ' : c).join('').trim();
    check(name.length > 0, 'BROADCAST_CUSTOMER_NAME_INVALID');
    const rendered = broadcastMessage.parse(input.message.replaceAll('{customer_name}', () => name));
    return { ...recipient, rendered };
  });
  check(new Set(recipients.map(c => c.whatsapp)).size === recipients.length, 'BROADCAST_DUPLICATE_NUMBER');
  const id = randomUUID(); const expiresAt = Date.now() + 10 * 60000;
  await tx.auditLog.create({ data: { action: 'WA_BROADCAST_PREVIEW', actorUserId: actorId, entityType: 'WhatsAppBroadcast', entityId: id, metadata: { sealed: seal({ actorId, expiresAt, message: input.message, recipients }) } } });
  return { id, message: input.message, expiresAt, recipients: recipients.map(c => ({ id: c.id, name: c.name, whatsapp: c.whatsapp, message: c.rendered })), scope: input.scope };
}
export async function confirmBroadcast(tx: Tx, input: z.infer<typeof broadcastConfirmation>, actorId: string) {
  await tx.$queryRaw`SELECT id FROM AuditLog WHERE entityId = ${input.previewId} AND action = 'WA_BROADCAST_PREVIEW' FOR UPDATE`;
  const record = await tx.auditLog.findFirst({ where: { entityId: input.previewId, action: 'WA_BROADCAST_PREVIEW', actorUserId: actorId } });
  check(record, 'NOT_FOUND', 404);
  const value = draft.parse(unseal(z.object({ sealed: z.string() }).parse(record.metadata).sealed));
  check(value.actorId === actorId, 'FORBIDDEN', 403);
  const previous = await tx.auditLog.findFirst({ where: { entityId: input.previewId, action: 'WA_BROADCAST_QUEUED' } });
  if (previous) return { id: input.previewId, queued: true };
  check(value.expiresAt > Date.now(), 'BROADCAST_PREVIEW_EXPIRED');
  const activation = await broadcastReady(tx);
  check(value.activation == null || activation === value.activation, 'ACTIVATION_CHANGED');
  for (const recipient of value.recipients) {
    await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${recipient.id} FOR UPDATE`;
    const current = await tx.customer.findUnique({ where: { id: recipient.id } });
    check(current && !current.archivedAt && current.whatsapp === recipient.whatsapp && current.notificationConsentAt?.toISOString() === recipient.consentAt, 'BROADCAST_AUDIENCE_CHANGED');
  }
  for (const recipient of value.recipients) await tx.notificationEvent.create({ data: {
    eventKey: `broadcast:${input.previewId}:${recipient.id}`, template: 'SERVICE_BROADCAST', recipient: recipient.whatsapp,
    optedIn: true, activation, provider: 'whatsapp-web.js', status: 'PENDING', message: '[Informasi layanan; isi terenkripsi]',
    encryptedMessage: seal(broadcastPayload.parse({ kind: 'SERVICE_BROADCAST', campaignId: input.previewId, customerId: recipient.id, message: recipient.rendered ?? value.message })),
  } });
  await tx.auditLog.create({ data: { action: 'WA_BROADCAST_QUEUED', actorUserId: actorId, entityType: 'WhatsAppBroadcast', entityId: input.previewId, metadata: { recipientCount: value.recipients.length, scope: 'SERVICE_INFORMATION', actualOutbound: false } } });
  return { id: input.previewId, queued: true };
}
