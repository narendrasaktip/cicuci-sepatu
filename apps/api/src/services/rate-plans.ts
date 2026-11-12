import { z } from 'zod';
import { type Tx } from '../repositories/orders.js';
import { check, type Actor } from './orders.js';
import { planWrite, planUpdate, rateRules } from './rate-rules.js';

export const planSelect = { archivedAt: true, id: true, name: true, isActive: true, revision: true, rules: true, turnaroundPolicy: true } as const;
export async function lockedPlan(tx: Tx, id: string) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM RatePlan WHERE id = ${id} FOR UPDATE`;
  check(rows.length, 'NOT_FOUND', 404);
  const plan = await tx.ratePlan.findUnique({ where: { id }, select: planSelect });
  check(plan, 'NOT_FOUND', 404); check(!plan.archivedAt, 'ARCHIVED');
  return { ...plan, rules: rateRules.parse(plan.rules) };
}
export async function writePlan(tx: Tx, input: z.infer<typeof planWrite> | z.infer<typeof planUpdate>, actor: Actor, id?: string) {
  check(actor.role === 'OWNER', 'FORBIDDEN', 403);
  const data = planWrite.parse('revision' in input ? { name: input.name, isActive: input.isActive, rules: input.rules, turnaroundPolicy: input.turnaroundPolicy } : input);
  const before = id ? await lockedPlan(tx, id) : null;
  if (before) check('revision' in input && before.revision === input.revision, 'REVISION_CONFLICT');
  if (before) {
    const changed = await tx.ratePlan.updateMany({ where: { id, revision: before.revision }, data: { ...data, revision: { increment: 1 } } });
    check(changed.count === 1, 'REVISION_CONFLICT');
  }
  const after = before ? await tx.ratePlan.findUniqueOrThrow({ where: { id }, select: planSelect }) : await tx.ratePlan.create({ data, select: planSelect });
  await tx.auditLog.create({ data: { actorUserId: actor.id, action: before ? 'RATE_PLAN_UPDATED' : 'RATE_PLAN_CREATED', entityType: 'RatePlan', entityId: after.id, metadata: { before, after } } });
  return after;
}
