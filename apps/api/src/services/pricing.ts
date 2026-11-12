import { z } from 'zod';
import { defaultRules, previewPricing, rateRules, turnaroundPolicy } from './rate-rules.js';

export const rateMode = z.enum(['PROMO', 'NORMAL']);
export type RateMode = z.infer<typeof rateMode>;
const snapshotFields = z.object({
  serviceId: z.string(),
  stage: z.enum(['ESTIMATE', 'FINAL', 'LOCKED']), initialTotalIdr: z.number().int(),
  totalIdr: z.number().int(), pairs: z.number().int(), lockedAt: z.string().nullable(),
  verifiedAt: z.string().optional(),
  verifiedBy: z.string().nullable().optional(),
  agreedTotalIdr: z.number().int().optional(),
  agreedAllocations: z.record(z.string(), z.number().int().nonnegative()).optional(),
  allocations: z.record(z.string(), z.number().int().nonnegative()),
  cancellation: z.object({
    originalTotalIdr: z.number().int().nonnegative(), originalPairs: z.number().int().nonnegative(),
    originalAllocations: z.record(z.string(), z.number().int().nonnegative()),
  }).optional(),
});
export const pricingSnapshot = z.discriminatedUnion('version', [
  snapshotFields.extend({ version: z.literal(1), mode: rateMode }),
  snapshotFields.extend({ version: z.literal(2), planId: z.string(), name: z.string(), revision: z.number().int().positive(), rules: rateRules, turnaroundPolicy: turnaroundPolicy.default('REGULAR') }),
]);
export type Pricing = z.infer<typeof pricingSnapshot>;
export function planPricing(plan: { id: string; name: string; revision: number; rules: unknown; turnaroundPolicy?: string }, serviceId: string, pairs: number): Pricing {
  const rules = rateRules.parse(plan.rules);
  const totalIdr = previewPricing(rules, pairs).totalIdr;
  return { version: 2, planId: plan.id, name: plan.name, revision: plan.revision, rules, turnaroundPolicy: turnaroundPolicy.parse(plan.turnaroundPolicy ?? 'REGULAR'), serviceId, stage: 'ESTIMATE', initialTotalIdr: totalIdr, totalIdr, pairs, lockedAt: null, allocations: {} };
}
export function packageTotal(pairs: number, mode: RateMode): number {
  if (!Number.isInteger(pairs) || pairs < 0 || pairs > 50) throw new Error('INVALID_PAIR_COUNT');
  const promo = rateMode.parse(mode) === 'PROMO';
  if (pairs >= 10) return pairs * (promo ? 40000 : 43000);
  if (pairs >= 6) return pairs * (promo ? 41000 : 45000);
  if (pairs === 5) return promo ? 210000 : 225000;
  return Math.floor(pairs / 3) * (promo ? 130000 : 145000) + pairs % 3 * (promo ? 45000 : 50000);
}
type Pair = { id: string; outcome: string | null; status: string };
const excluded = (item: Pair) => item.outcome === 'REJECTED' || item.outcome === 'DECLINED';
export function calculatePricing(previous: Pricing, items: Pair[]): Pricing {
  const candidates = items.filter(i => !excluded(i)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
  if (!previous.cancellation && (previous.stage === 'LOCKED' || (previous.stage === 'FINAL' && previous.verifiedAt))) {
    const allocations = Object.fromEntries(items.map(i => [i.id, excluded(i) ? 0 : previous.allocations[i.id] ?? 0]));
    return { ...previous, pairs: candidates.length, allocations, totalIdr: Object.values(allocations).reduce((a, b) => a + b, 0) };
  }
  const totalIdr = previous.version === 2 ? previewPricing(previous.rules, candidates.length).totalIdr : packageTotal(candidates.length, previous.mode);
  const base = candidates.length ? Math.floor(totalIdr / candidates.length) : 0;
  const allocations: Record<string, number> = Object.fromEntries(items.map(i => [i.id, 0]));
  candidates.forEach((item, index) => { allocations[item.id] = base + (index < totalIdr % candidates.length ? 1 : 0); });
  return { ...previous, totalIdr, allocations, pairs: candidates.length, stage: items.some(i => !i.outcome || ['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT'].includes(i.status)) ? 'ESTIMATE' : previous.stage === 'LOCKED' ? 'LOCKED' : 'FINAL' };
}
export function initialPricing(mode: RateMode, serviceId: string, pairs: number): Pricing {
  const totalIdr = packageTotal(pairs, mode);
  return { version: 1, mode, serviceId, stage: 'ESTIMATE', initialTotalIdr: totalIdr, totalIdr, pairs, lockedAt: null, allocations: {} };
}

// Public projection only; historical snapshots are never recalculated on reads.
export function publicPricing(value: unknown, items: Pair[]) {
  const pricing = pricingSnapshot.parse(value);
  const rules = pricing.version === 2 ? pricing.rules : defaultRules(pricing.mode);
  const calculation = previewPricing(rules, pricing.pairs);
  const matches = calculation.totalIdr === pricing.totalIdr;
  return {
    version: pricing.version, name: pricing.version === 2 ? pricing.name : pricing.mode === 'PROMO' ? 'Promo' : 'Normal',
    stage: items.some(i => !excluded(i) && (!i.outcome || ['RECEIVED', 'INSPECTION', 'AWAITING_CONSENT'].includes(i.status))) ? 'ESTIMATE' : pricing.stage,
    pairs: pricing.pairs, initialTotalIdr: pricing.initialTotalIdr, totalIdr: pricing.totalIdr,
    lockedAt: pricing.lockedAt, ...(pricing.version === 2 ? { turnaroundPolicy: pricing.turnaroundPolicy } : {}),
    basis: pricing.cancellation ? 'CANCELLATION' : pricing.stage === 'LOCKED' ? 'HISTORICAL_AGREEMENT' : 'INSPECTION',
    staffVerified: !!pricing.verifiedAt,
    originalTotalIdr: pricing.cancellation?.originalTotalIdr ?? pricing.agreedTotalIdr ?? pricing.initialTotalIdr,
    originalPairs: pricing.cancellation?.originalPairs ?? items.length,
    excludedPairs: items.filter(excluded).length,
    breakdown: matches ? calculation.breakdown : [],
    calculationMatches: matches,
  };
}

export function packageRates() {
  return [1, 2, 3, 4, 5, 6, 10].map(pairs => ({
    pairs: pairs === 6 ? '6–9' : pairs === 10 ? '10+' : String(pairs),
    perPair: pairs >= 6,
    promoIdr: packageTotal(pairs, 'PROMO') / (pairs >= 6 ? pairs : 1),
    normalIdr: packageTotal(pairs, 'NORMAL') / (pairs >= 6 ? pairs : 1),
  }));
}
