import { ApiError } from '../services/orders.js';
import { Prisma } from '@prisma/client';
import { db } from '../lib/db.js';
export type Tx = Prisma.TransactionClient;
export const detail = { items: { include: { inspection: true, consents: { select: { id: true, findings: true, customerNote: true, risk: true, quotedPriceIdr: true, expiresAt: true, consumedAt: true, decision: true } }, history: { orderBy: { createdAt: 'asc' as const } }, photos: { select: { id: true, kind: true, customerVisible: true, mime: true } } } }, payments: true, customer: true };
export function transaction<T>(run: (tx: Tx) => Promise<T>) { return db.$transaction(run, { maxWait: 10000, timeout: 20000, isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted }); }
export async function lockOrder(tx: Tx, id: string, allowArchived = false) {
  const rows = await tx.$queryRaw<{ id: string; archivedAt: Date | null }[]>`SELECT id, archivedAt FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
  if (!allowArchived && rows[0]?.archivedAt) throw new ApiError(409, 'ARCHIVED');
  return rows.length > 0;
}
export function audit(tx: Tx, actorUserId: string | null, action: string, entityId: string) { return tx.auditLog.create({ data: { actorUserId, action, entityId } }); }
export async function lockItem(tx: Tx, id: string) {
  const found = await tx.orderItem.findUnique({ where: { id }, select: { orderId: true } });
  if (!found || !await lockOrder(tx, found.orderId)) return null;
  return tx.orderItem.findUnique({ where: { id }, include: { inspection: true, photos: { select: { id: true, kind: true, customerVisible: true } }, consents: true, order: { include: { customer: true } } } });
}
