/**
 * Money makers: what a production method is worth per hour, at live prices.
 *
 * The premise is the same one behind the flip finder. Every money-making
 * guide publishes a gp/hr figure that was true at the prices on the day it
 * was recalculated, and those are the two numbers that move most. So nothing
 * here stores a profit figure. What gets stored is the RECIPE — which is a
 * game mechanic and does not change — and the rate at which a human can
 * perform it. The money is worked out from today's prices every time.
 *
 * Three things this does that published guides generally do not:
 *
 *  1. CHARGES THE SALE TAX. You pay 2% selling the output. A method whose
 *     margin is thinner than the tax is a loss, and plenty are.
 *
 *  2. CAPS THROUGHPUT BY THE INPUTS' BUY LIMITS. This is the big one. You
 *     cannot make 4,100 unfinished ranarr potions an hour if the Grand
 *     Exchange will only sell you 11,000 ranarr weeds per four hours — the
 *     real ceiling is 2,750/hr, and the honest profit is a third lower than
 *     the guide says. Every method here reports what is actually limiting it.
 *
 *  3. CAPS BY YOUR CASH. Running an hour of a method means buying an hour of
 *     inputs up front. If you cannot fund it, the gp/hr is theoretical.
 *
 * And one thing it refuses to do: guess. If any input or output has no
 * current price, the method's profit is null rather than a number computed
 * from a missing figure treated as zero.
 *
 * Pure. Recipes and prices in, numbers out — no database, no clock.
 */

import { geTax } from '@/lib/osrs/ge';
import { BUY_LIMIT_WINDOW_MS } from '@/lib/osrs/limits';

/** Windows of buy limit per hour. The limit is per four hours. */
export const WINDOWS_PER_HOUR = 3_600_000 / BUY_LIMIT_WINDOW_MS;

export type MethodItem = {
  itemId: number;
  name: string;
  /** Per action. Fractional is allowed for probabilistic outputs. */
  quantity: number;
};

/** A recipe with prices resolved. What the engine actually consumes. */
export type ResolvedMethod = {
  id: string;
  name: string;
  category: 'processing' | 'gathering';
  skill: string | null;
  level: number | null;
  /** Actions a focused player completes per hour. An estimate; sourced. */
  actionsPerHour: number;
  /** Coins paid per action that are not an item purchase — a tanner's fee. */
  coinCost: number;
  members: boolean;
  quest: string | null;
  note: string | null;
  sourceUrl: string;
  inputs: MethodItem[];
  outputs: MethodItem[];
};

export type PricedItem = {
  itemId: number;
  /** What you pay to acquire it — the instant-sell price. */
  buy: number | null;
  /** What you receive selling it — the instant-buy price. */
  sell: number | null;
  /** Units purchasable per four-hour window. Null when none is published. */
  buyLimit: number | null;
};

export type LimitReason = 'rate' | 'buy limit' | 'cash';

export type MethodResult = {
  method: ResolvedMethod;
  /** Null when any input or output has no price — never a guessed figure. */
  profitPerHour: number | null;
  profitPerAction: number | null;
  /** Gross input cost of one action, including any coin fee. */
  costPerAction: number;
  /** Output value of one action, after the sale tax. */
  revenuePerAction: number;
  /** Actions actually achievable, after limits and cash. */
  actionsPerHour: number;
  /** Inputs for one hour at the achievable rate. What you must have on hand. */
  capitalPerHour: number;
  /** What holds the method back. 'rate' means nothing does. */
  limitedBy: LimitReason;
  /** Items with no price, which is why profit is null. */
  unpriced: string[];
  /** True when the user's level is below what the method needs. */
  locked: boolean;
};

/** Per-hour ceiling the buy limits impose on a recipe's inputs. */
export function actionsAllowedByLimits(
  inputs: MethodItem[],
  priced: Map<number, PricedItem>
): number | null {
  let ceiling: number | null = null;
  for (const input of inputs) {
    const p = priced.get(input.itemId);
    // No published limit means no constraint from this input.
    if (!p || p.buyLimit === null || p.buyLimit <= 0) continue;
    if (input.quantity <= 0) continue;
    const perHour = (p.buyLimit * WINDOWS_PER_HOUR) / input.quantity;
    ceiling = ceiling === null ? perHour : Math.min(ceiling, perHour);
  }
  return ceiling;
}

/**
 * Value one method at the given prices.
 *
 * `levels` maps a skill name to the user's level. An absent skill means the
 * requirement cannot be checked, which is reported as unlocked rather than
 * guessed either way.
 */
export function evaluateMethod(
  method: ResolvedMethod,
  priced: Map<number, PricedItem>,
  cashStack: number,
  levels?: Map<string, number>
): MethodResult {
  const unpriced: string[] = [];

  let costPerAction = method.coinCost;
  for (const input of method.inputs) {
    const p = priced.get(input.itemId);
    if (!p || p.buy === null) {
      unpriced.push(input.name);
      continue;
    }
    costPerAction += p.buy * input.quantity;
  }

  let revenuePerAction = 0;
  for (const output of method.outputs) {
    const p = priced.get(output.itemId);
    if (!p || p.sell === null) {
      unpriced.push(output.name);
      continue;
    }
    // Tax is charged per item sold, so it is taken off the unit price before
    // multiplying — not off the line total, which would round differently.
    revenuePerAction += (p.sell - geTax(p.sell, output.itemId)) * output.quantity;
  }

  const limitCeiling = actionsAllowedByLimits(method.inputs, priced);

  // Cash governs how many actions' worth of inputs you can hold at once.
  const cashCeiling =
    costPerAction > 0 ? Math.floor(cashStack / costPerAction) : Number.POSITIVE_INFINITY;

  let actionsPerHour = method.actionsPerHour;
  let limitedBy: LimitReason = 'rate';
  if (limitCeiling !== null && limitCeiling < actionsPerHour) {
    actionsPerHour = limitCeiling;
    limitedBy = 'buy limit';
  }
  if (cashCeiling < actionsPerHour) {
    actionsPerHour = cashCeiling;
    limitedBy = 'cash';
  }
  actionsPerHour = Math.max(0, Math.floor(actionsPerHour));

  const level = method.level;
  const have = method.skill ? levels?.get(method.skill) : undefined;
  const locked = level !== null && have !== undefined && have < level;

  if (unpriced.length > 0) {
    return {
      method,
      profitPerHour: null,
      profitPerAction: null,
      costPerAction,
      revenuePerAction,
      actionsPerHour,
      capitalPerHour: costPerAction * actionsPerHour,
      limitedBy,
      unpriced: [...new Set(unpriced)],
      locked,
    };
  }

  const profitPerAction = revenuePerAction - costPerAction;
  return {
    method,
    profitPerAction,
    profitPerHour: profitPerAction * actionsPerHour,
    costPerAction,
    revenuePerAction,
    actionsPerHour,
    capitalPerHour: costPerAction * actionsPerHour,
    limitedBy,
    unpriced: [],
    locked,
  };
}

/** Value every method and rank them, best first. Unpriced ones sort last. */
export function rankMethods(
  methods: ResolvedMethod[],
  priced: Map<number, PricedItem>,
  cashStack: number,
  levels?: Map<string, number>
): MethodResult[] {
  return methods
    .map((m) => evaluateMethod(m, priced, cashStack, levels))
    .sort((a, b) => {
      if (a.profitPerHour === null && b.profitPerHour === null) return 0;
      if (a.profitPerHour === null) return 1;
      if (b.profitPerHour === null) return -1;
      return b.profitPerHour - a.profitPerHour;
    });
}
