import { readDisplaySettings, writeDisplaySettings, type TrackingStage, type DisplaySettings } from './display-settings.js';
import { config } from '../lib/config.js';
import argon2 from 'argon2';
import { type Prisma } from '@prisma/client';
import { audit, type Tx } from '../repositories/orders.js';
import { check, cleaningService, type Actor } from './orders.js';
export const safeUser = { id: true, email: true, name: true, role: true, isActive: true, createdAt: true } as const;
export async function customerWrite(tx: Tx, input: { salutation?: 'Kak' | 'Pak' | 'Bu'; name?: string; whatsapp?: string; notes?: string | null; notificationConsent?: boolean }, actor: Actor, id?: string) {
  if (id) { await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${id} FOR UPDATE`; const current = await tx.customer.findUnique({ where: { id } }); check(current, 'NOT_FOUND', 404); check(!current.archivedAt, 'ARCHIVED'); }
  const { notificationConsent, ...fields } = input;
  const data = { ...fields, ...(notificationConsent === undefined ? {} : { notificationConsentAt: notificationConsent ? new Date() : null }) };
  const customer = id ? await tx.customer.update({ where: { id }, data }) : await tx.customer.create({ data: data as Prisma.CustomerCreateInput });
  await audit(tx, actor.id, id ? 'CUSTOMER_UPDATED' : 'CUSTOMER_CREATED', customer.id); return customer;
}
export async function serviceWrite(tx: Tx, input: { name?: string; basePriceIdr?: number; isActive?: boolean }, actor: Actor, id?: string) {
  check(id !== cleaningService.id, 'INTERNAL_SERVICE_READONLY');
  const service = id ? await tx.service.update({ where: { id }, data: input }) : await tx.service.create({ data: input as Prisma.ServiceCreateInput });
  await audit(tx, actor.id, 'SERVICE_SAVED', service.id); return service;
}
export async function userWrite(tx: Tx, input: { name?: string; email?: string; role?: 'OWNER' | 'ADMIN' | 'STAFF'; password?: string; isActive?: boolean }, actor: Actor, id?: string) {
  await tx.$queryRaw`SELECT id FROM User WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;
  if (id) await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
  const existing = id ? await tx.user.findUnique({ where: { id } }) : null;
  if (id) { check(existing, 'NOT_FOUND', 404); check(!existing.archivedAt, 'ARCHIVED'); check(id !== actor.id || (input.isActive !== false && (!input.role || input.role === existing.role)), 'CURRENT_ACCOUNT'); }
  if (existing?.role === 'OWNER' && existing.isActive && (input.isActive === false || (input.role && input.role !== 'OWNER'))) check(await tx.user.count({ where: { role: 'OWNER', isActive: true, archivedAt: null } }) > 1, 'LAST_OWNER');
  const { password, ...fields } = input;
  const data = { ...fields, ...(password ? { passwordHash: await argon2.hash(password, { type: argon2.argon2id }) } : {}) };
  const user = id ? await tx.user.update({ where: { id }, data, select: safeUser }) : await tx.user.create({ data: data as Prisma.UserCreateInput, select: safeUser });
  if (id && (password || input.isActive === false || input.role)) await tx.session.deleteMany({ where: { userId: id } });
  await audit(tx, actor.id, 'USER_SAVED', user.id); return user;
}
export async function settingsWrite(tx: Tx, input: { name?: string; pickupInstructions?: string; consentHours?: number; statusLabels?: Record<string, string | undefined>; publicOrigin?: string; trackingStages?: TrackingStage[] }, actor: Actor) {
  const { statusLabels, publicOrigin, trackingStages, ...profile } = input;
  const value = await tx.storeSettings.upsert({ where: { id: 1 }, create: profile, update: profile, select: { id: true, name: true, pickupInstructions: true, consentHours: true } });
  await tx.$queryRaw`SELECT id FROM StoreSettings WHERE id = 1 FOR UPDATE`;
  const previous = await readDisplaySettings(tx, config.APP_BASE_URL);
  const display: DisplaySettings = { trackingStages: trackingStages ?? previous.trackingStages, statusLabels: statusLabels === undefined ? previous.statusLabels : statusLabels as Record<string, string>, publicOrigin: publicOrigin ?? previous.publicOrigin };
  // Supplied label map replaces overrides; {} resets defaults. Omitted map preserves labels.
  await writeDisplaySettings(tx, display);
  await audit(tx, actor.id, 'SETTINGS_UPDATED', '1');
  return { ...value, ...await readDisplaySettings(tx, config.APP_BASE_URL) };
}

export function customerSearchWhere(query?: string): Prisma.CustomerWhereInput {
  const q = query?.trim();
  if (!q) return { archivedAt: null };
  const phone = /^[+\d\s()-]+$/.test(q) ? q.replace(/[\s()-]/g, '').replace(/^0/, '+62').replace(/^62/, '+62') : q;
  return { archivedAt: null, OR: [{ name: { contains: q } }, { whatsapp: { contains: phone } }] };
}
