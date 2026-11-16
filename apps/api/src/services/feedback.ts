import { z } from 'zod';
import { audit, lockOrder, type Tx } from '../repositories/orders.js';
import { check, physicallyCompleted, publicOrder } from './orders.js';

export const feedbackInput = z.object({ rating: z.number().int().min(1).max(5), review: z.string().trim().min(1).max(1000), publicationConsent: z.boolean().default(false) }).strict();
export function maskedFeedbackName(name: string) { return `${Array.from(name.trim())[0]?.toLocaleUpperCase('id-ID') ?? 'P'}***`; }
export const feedbackSelection = { rating: true, review: true, createdAt: true } as const;
export function feedbackEligible(order: { archivedAt?: Date | null; items: { status: string }[] }) { return !order.archivedAt && physicallyCompleted(order.items); }
export async function submitFeedback(tx: Tx, token: string, input: z.infer<typeof feedbackInput>) {
  const found = await publicOrder(tx, token);
  await lockOrder(tx, found.id);
  // Revalidate token after acquiring the same lock used by rotation/status changes.
  const order = await publicOrder(tx, token);
  check(feedbackEligible(order), 'ORDER_NOT_COMPLETED');
  check(!await tx.feedback.findUnique({ where: { orderId: order.id }, select: { id: true } }), 'FEEDBACK_EXISTS');
  const feedback = await tx.feedback.create({ data: { orderId: order.id, ...feedbackInput.parse(input) }, select: feedbackSelection });
  await audit(tx, null, 'FEEDBACK_SUBMITTED', order.id);
  return feedback;
}
