import { z } from 'zod';

const pairs = z.number().int().min(1).max(50);
const rule = z.object({ kind: z.enum(['PACKAGE', 'PER_PAIR']), minPairs: pairs, maxPairs: pairs.nullable(), priceIdr: z.number().int().min(1).max(100000000) }).strict();
export type RateRule = z.infer<typeof rule>;
export type Breakdown = { kind: RateRule['kind']; quantity: number; pairs: number; priceIdr: number; totalIdr: number };

// Range eligibility uses the entire order; packages never split an order into range tiers.
function calculate(rules: RateRule[], count: number) {
  const range = rules.find(r => r.kind === 'PER_PAIR' && count >= r.minPairs && count <= (r.maxPairs ?? 50));
  if (count && range) return { totalIdr: count * range.priceIdr, breakdown: [{ kind: range.kind, quantity: count, pairs: 1, priceIdr: range.priceIdr, totalIdr: count * range.priceIdr }] };
  const packages = rules.filter(r => r.kind === 'PACKAGE').sort((a, b) => b.minPairs - a.minPairs);
  const costs = [0]; const choices: RateRule[] = [];
  for (let n = 1; n <= count; n++) {
    costs[n] = Infinity;
    for (const option of packages) {
      const cost = n >= option.minPairs ? costs[n - option.minPairs]! + option.priceIdr : Infinity;
      if (cost < costs[n]!) { costs[n] = cost; choices[n] = option; }
    }
  }
  const breakdown: Breakdown[] = [];
  for (let n = count; n > 0;) {
    const option = choices[n]!;
    const existing = breakdown.find(b => b.pairs === option.minPairs);
    if (existing) { existing.quantity++; existing.totalIdr += option.priceIdr; }
    else breakdown.push({ kind: 'PACKAGE', quantity: 1, pairs: option.minPairs, priceIdr: option.priceIdr, totalIdr: option.priceIdr });
    n -= option.minPairs;
  }
  return { totalIdr: costs[count]!, breakdown };
}
export const rateRules = z.array(rule).min(1).max(100).superRefine((rules, ctx) => {
  const invalid = (message: string) => ctx.addIssue({ code: 'custom', message });
  if (!rules.some(r => r.kind === 'PACKAGE' && r.minPairs === 1 && r.maxPairs === 1)) invalid('Single-pair PACKAGE baseline required');
  for (const [i, r] of rules.entries()) {
    if (r.kind === 'PACKAGE' ? r.maxPairs !== r.minPairs : r.maxPairs !== null && r.maxPairs < r.minPairs) invalid('Invalid package or range bounds');
    for (const other of rules.slice(0, i)) {
      if (r.kind === 'PACKAGE' && other.kind === 'PACKAGE' && r.minPairs === other.minPairs) invalid('Duplicate package');
      if (r.kind === 'PER_PAIR' && other.kind === 'PER_PAIR' && r.minPairs <= (other.maxPairs ?? 50) && other.minPairs <= (r.maxPairs ?? 50)) invalid('Overlapping ranges');
      const p = r.kind === 'PACKAGE' ? r : other; const range = r.kind === 'PER_PAIR' ? r : other;
      if (p.kind !== range.kind && p.minPairs >= range.minPairs && p.minPairs <= (range.maxPairs ?? 50)) invalid('Package conflicts with range');
    }
  }
  if (ctx.issues.length) return;
  for (let n = 1; n <= 50; n++) if (calculate(rules, n).totalIdr > 2147483647) { invalid('Total exceeds signed database Int'); break; }
});
export const turnaroundPolicy = z.enum(['REGULAR', 'FAST']);
export const planWrite = z.object({ name: z.string().trim().min(1).max(100), isActive: z.boolean(), turnaroundPolicy: turnaroundPolicy.default('REGULAR'), rules: rateRules }).strict();
export const planUpdate = planWrite.extend({ revision: z.number().int().min(1).max(2147483646) }).strict();
export const pricingPreview = z.object({ rules: rateRules, pairs: z.number().int().min(0).max(50) }).strict();
export function previewPricing(rules: RateRule[], count: number) {
  const input = pricingPreview.parse({ rules, pairs: count });
  return calculate(input.rules, input.pairs);
}
export function defaultRules(mode: 'PROMO' | 'NORMAL'): RateRule[] {
  const prices = mode === 'PROMO' ? [45000, 130000, 210000, 41000, 40000] : [50000, 145000, 225000, 45000, 43000];
  return [1, 3, 5].map((n, i): RateRule => ({ kind: 'PACKAGE', minPairs: n, maxPairs: n, priceIdr: prices[i]! })).concat([
    { kind: 'PER_PAIR', minPairs: 6, maxPairs: 9, priceIdr: prices[3]! }, { kind: 'PER_PAIR', minPairs: 10, maxPairs: null, priceIdr: prices[4]! },
  ]);
}
