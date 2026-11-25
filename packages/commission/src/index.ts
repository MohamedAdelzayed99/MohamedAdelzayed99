/**
 * High Tech referral commission engine.
 *
 * Shared by the server (authoritative calculation) and the apps (previews only).
 *
 * Rule (from the plan, sections 2 and 3):
 *   Let n = number of people above the buyer in the tree (the buyer's upline).
 *   - The direct link owner (the buyer's parent) gets
 *         max(total - step * (n - 1), floor)
 *   - The remaining (total - direct) is split equally between the other n - 1
 *     people above. While the direct share is above the floor this equals
 *     exactly `step` each; once the direct share hits the floor, the remainder
 *     is spread evenly over everybody above.
 *   - The buyer earns nothing from their own purchase.
 *
 * All rates are in basis points (1% = 100 bp) and all money in piastres
 * (1 EGP = 100 piastres) so everything stays in integers.
 */

export type Program = "retail" | "wholesale";

export interface RateConfig {
  /** Total distributed from every sale, in bp. Retail 3000 (30%), wholesale 500 (5%). */
  totalBp: number;
  /** How much the direct share drops (and each upper member gets) per level, in bp. */
  stepBp: number;
  /** Minimum direct share, in bp. Retail 1000 (10%), wholesale 300 (3%). */
  floorBp: number;
}

export const DEFAULT_RATES: Record<Program, RateConfig> = {
  retail: { totalBp: 3000, stepBp: 500, floorBp: 1000 },
  wholesale: { totalBp: 500, stepBp: 100, floorBp: 300 },
};

export interface Share<Id> {
  memberId: Id;
  /** 1 = direct link owner, 2 = the one above them, ... */
  level: number;
  /** Share expressed as a rational number of bp: numerator / denominator. */
  rateBp: number;
  amount: number;
}

export function validateRates(r: RateConfig): string[] {
  const errors: string[] = [];
  for (const k of ["totalBp", "stepBp", "floorBp"] as const) {
    if (!Number.isInteger(r[k]) || r[k] < 0) errors.push(`${k} must be a non-negative integer`);
  }
  if (r.floorBp > r.totalBp) errors.push("floorBp cannot exceed totalBp");
  if (r.totalBp > 10000) errors.push("totalBp cannot exceed 10000 (100%)");
  return errors;
}

/** Direct link owner's rate in bp for a buyer with `n` people above. */
export function directRateBp(n: number, rates: RateConfig): number {
  if (n < 1) return 0;
  return Math.max(rates.totalBp - rates.stepBp * (n - 1), rates.floorBp);
}

/**
 * Split a sale between the buyer's upline.
 *
 * @param upline  ids ordered from the buyer's parent (direct link owner) up to the root.
 * @param amount  sale amount in piastres (integer).
 * @returns one share per upline member. Each amount is floored to a whole
 *          piastre; any sub-piastre remainder stays with the company.
 */
export function splitCommission<Id>(upline: readonly Id[], amount: number, rates: RateConfig): Share<Id>[] {
  if (!Number.isInteger(amount) || amount < 0) throw new Error("amount must be a non-negative integer (piastres)");
  const errors = validateRates(rates);
  if (errors.length) throw new Error(errors.join("; "));
  const n = upline.length;
  if (n === 0) return [];

  const direct = directRateBp(n, rates);
  const restBp = rates.totalBp - direct;
  const others = n - 1;

  return upline.map((memberId, i) => {
    if (i === 0) {
      return { memberId, level: 1, rateBp: direct, amount: Math.floor((amount * direct) / 10000) };
    }
    // amount * restBp / (others * 10000), computed exactly in integers
    return {
      memberId,
      level: i + 1,
      rateBp: restBp / others,
      amount: Math.floor((amount * restBp) / (others * 10000)),
    };
  });
}

/** Total of a split, handy for checks and reports. */
export function totalOf(shares: readonly { amount: number }[]): number {
  return shares.reduce((s, x) => s + x.amount, 0);
}

/** Format piastres as EGP text, e.g. 5000 -> "50 ج" / "50.25 ج". */
export function formatEGP(piastres: number): string {
  const egp = piastres / 100;
  const txt = Number.isInteger(egp) ? egp.toLocaleString("en-US") : egp.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${txt} ج`;
}

export const egp = (pounds: number) => Math.round(pounds * 100);
