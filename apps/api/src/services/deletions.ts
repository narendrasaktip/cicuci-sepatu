import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { type Tx } from '../repositories/orders.js';
import { ApiError, check, type Actor } from './orders.js';

export const deletionInput = z.object({ confirmed: z.literal(true), confirmation: z.literal('HAPUS') }).strict();
export const archiveCustomerInput = z.object({ confirmed: z.literal(true) }).strict();
export async function archiveCustomer(tx: Tx, id: string, input: z.infer<typeof archiveCustomerInput>, actor: Actor) {
  check(actor.role === 'OWNER', 'FORBIDDEN', 403);
  archiveCustomerInput.parse(input);
  await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${id} FOR UPDATE`;
  const customer = await tx.customer.findUnique({ where: { id }, select: { id: true, archivedAt: true } });
  check(customer, 'NOT_FOUND', 404);
  check(!customer.archivedAt, 'ARCHIVED');
  await tx.customer.update({ where: { id }, data: { archivedAt: new Date() } });
  await tx.auditLog.create({ data: { actorUserId: actor.id, action: 'CUSTOMER_ARCHIVED', entityType: 'Customer', entityId: id, metadata: { confirmed: true } } });
  return { id, archived: true };
}
export async function deleteCustomer(tx: Tx, id: string, input: z.infer<typeof deletionInput>, actor: Actor) {
  check(actor.role === 'OWNER', 'FORBIDDEN', 403);
  deletionInput.parse(input);
  await tx.$queryRaw`SELECT id FROM Customer WHERE id = ${id} FOR UPDATE`;
  const customer = await tx.customer.findUnique({ where: { id }, select: { id: true, whatsapp: true } });
  check(customer, 'NOT_FOUND', 404);
  const orders = await tx.order.findMany({ where: { customerId: id }, select: { id: true }, orderBy: { id: 'asc' } });
  for (const order of orders) await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${order.id} FOR UPDATE`;
  // ponytail: detached non-broadcast events lack durable ownership; recipient matching remains fail-closed until identity is persisted.
  await tx.$queryRaw`SELECT id FROM NotificationEvent WHERE recipient = ${customer.whatsapp} OR (template = 'SERVICE_BROADCAST' AND eventKey LIKE ${`%:${id}`}) ORDER BY id FOR UPDATE`;
  const candidates = await tx.notificationEvent.findMany({
    where: { OR: [{ recipient: customer.whatsapp }, { template: 'SERVICE_BROADCAST', eventKey: { endsWith: `:${id}` } }] },
    select: { orderId: true, template: true, eventKey: true, status: true, attempts: { select: { status: true, response: true } } },
  });
  const ownedOrders = new Set(orders.map(order => order.id));
  for (const event of candidates) {
    const broadcast = event.template === 'SERVICE_BROADCAST' && !event.orderId ? /^broadcast:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}:([^:]+)$/i.exec(event.eventKey) : null;
    if (event.orderId ? !ownedOrders.has(event.orderId) : broadcast && broadcast[1] !== id) continue;
    check(!['PENDING', 'PROCESSING'].includes(event.status) && !(event.status === 'FAILED' && !event.attempts.length) && !event.attempts.some(a => a.status === 'PROCESSING' || (a.status === 'FAILED' && (a.response as { actualOutbound?: unknown } | null)?.actualOutbound !== false)), 'NOTIFICATION_IN_PROGRESS');
  }
  for (const order of orders) {
    await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${order.id} FOR UPDATE`;
    await deleteEntity(tx, 'orders', order.id, input, actor, true);
  }
  try { await tx.customer.delete({ where: { id } }); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ApiError(409, 'DELETE_DEPENDENCY');
    throw error;
  }
  await tx.auditLog.create({ data: { actorUserId: actor.id, action: 'CUSTOMER_DELETED', entityType: 'Customer', entityId: id, metadata: { confirmed: true } } });
  return { id, deleted: true };
}
export type DeletionKind = 'orders' | 'pricing/plans' | 'users';
export async function deleteEntity(tx: Tx, kind: DeletionKind, id: string, input: z.infer<typeof deletionInput>, actor: Actor, rejectAmbiguous = false) {
  check(actor.role === 'OWNER', 'FORBIDDEN', 403);
  deletionInput.parse(input);
  if (kind === 'users') {
    // Same ordered locks as userWrite; deletion/demotion/deactivation share the last-Owner guard.
    await tx.$queryRaw`SELECT id FROM User WHERE role = 'OWNER' ORDER BY id FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM User WHERE id = ${id} FOR UPDATE`;
    check(id !== actor.id, 'CURRENT_ACCOUNT');
  } else if (kind === 'orders') await tx.$queryRaw`SELECT id FROM \`Order\` WHERE id = ${id} FOR UPDATE`;
  else await tx.$queryRaw`SELECT id FROM RatePlan WHERE id = ${id} FOR UPDATE`;
  const current = kind === 'orders' ? await tx.order.findUnique({ where: { id }, select: { id: true } }) : kind === 'users' ? await tx.user.findUnique({ where: { id }, select: { id: true, role: true, isActive: true } }) : await tx.ratePlan.findUnique({ where: { id }, select: { id: true } });
  check(current, 'NOT_FOUND', 404);
  if (kind === 'orders') {
    // Worker claims take the same order lock. Never detach queued/claimed work or replay evidence.
    await tx.$queryRaw`SELECT id FROM NotificationEvent WHERE orderId = ${id} ORDER BY id FOR UPDATE`;
    check(!await tx.notificationEvent.count({ where: { orderId: id, status: { in: ['PENDING', 'PROCESSING'] } } }), 'NOTIFICATION_IN_PROGRESS');
    check(!await tx.notificationAttempt.count({ where: { event: { orderId: id }, status: 'PROCESSING' } }), 'NOTIFICATION_IN_PROGRESS');
    if (rejectAmbiguous) {
      const failed = await tx.notificationEvent.findMany({ where: { orderId: id, status: 'FAILED' }, select: { attempts: { select: { status: true, response: true } } } });
      check(!failed.some(e => !e.attempts.length || e.attempts.some(a => a.status === 'FAILED' && (a.response as { actualOutbound?: unknown } | null)?.actualOutbound !== false)), 'NOTIFICATION_IN_PROGRESS');
      const attempts = await tx.notificationAttempt.findMany({ where: { status: 'FAILED', event: { orderId: id } }, select: { response: true } });
      check(!attempts.some(a => (a.response as { actualOutbound?: unknown } | null)?.actualOutbound !== false), 'NOTIFICATION_IN_PROGRESS');
    }
  }
  if (kind === 'users') {
    check('role' in current && 'isActive' in current, 'NOT_FOUND', 404);
    const user = current;
    if (user.role === 'OWNER' && user.isActive) check(await tx.user.count({ where: { role: 'OWNER', isActive: true, archivedAt: null } }) > 1, 'LAST_OWNER');
    // Audit actor IDs are historical scalars, not User FKs; retain them unchanged after deletion.
    check(!await tx.orderItem.count({ where: { assignedUserId: id } }) && !await tx.inspection.count({ where: { actorUserId: id } }) && !await tx.statusHistory.count({ where: { actorUserId: id } }) && !await tx.payment.count({ where: { actorUserId: id } }), 'USER_HAS_HISTORY');
    await tx.session.deleteMany({ where: { userId: id } });
  }
  try {
    if (kind === 'orders') {
      const where = { item: { orderId: id } };
      await tx.photo.deleteMany({ where });
      await tx.inspection.deleteMany({ where });
      await tx.consentDecision.deleteMany({ where });
      await tx.statusHistory.deleteMany({ where });
      await tx.orderItem.deleteMany({ where: { orderId: id } });
      // Payment and terminal notification FKs SET NULL; immutable ledger snapshots/evidence survive.
      await tx.order.delete({ where: { id } });
    } else if (kind === 'users') await tx.user.delete({ where: { id } });
    else await tx.ratePlan.delete({ where: { id } }); // Historical plan name/rules are JSON snapshots, not FKs.
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2003') throw new ApiError(409, 'DELETE_DEPENDENCY');
    throw error;
  }
  const entityType = kind === 'orders' ? 'Order' : kind === 'users' ? 'User' : 'RatePlan';
  await tx.auditLog.create({ data: { actorUserId: actor.id, action: `${entityType.toUpperCase()}_DELETED`, entityType, entityId: id, metadata: { confirmed: true } } });
  return { id, deleted: true };
}
