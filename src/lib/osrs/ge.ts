/**
 * Grand Exchange economics.
 *
 * The tax rule, verified Oct 2026 against two independent sources:
 *   - 2% of the sale price, charged to the seller only
 *   - rounded DOWN to whole gp
 *   - not charged at all below 50 gp
 *   - capped at 5,000,000 gp per item
 *
 * Jagex has changed this before (it launched at a lower rate) and may again,
 * so the three numbers live here as named constants. Change them in one place
 * and every margin in the app follows.
 */

export const GE_TAX_RATE = 0.02;
export const GE_TAX_FREE_BELOW = 50;
export const GE_TAX_CAP_PER_ITEM = 5_000_000;

/**
 * Items Jagex exempts from tax regardless of price.
 *
 * Deliberately only the ones that are well established. Several guides list
 * further exemptions inconsistently, and taxing something that is actually
 * exempt merely understates profit, while exempting something taxable
 * overstates it — so when unsure, tax it.
 */
export const TAX_EXEMPT_ITEM_IDS = new Set<number>([
  13190, // Old school bond
  1755, // Chisel
  2347, // Hammer
  8794, // Saw
  952, // Spade
  5329, // Secateurs
]);

/** Tax charged on selling one unit at this price. */
export function geTax(sellPrice: number, itemId?: number): number {
  if (!Number.isFinite(sellPrice) || sellPrice < GE_TAX_FREE_BELOW) return 0;
  if (itemId !== undefined && TAX_EXEMPT_ITEM_IDS.has(itemId)) return 0;
  return Math.min(Math.floor(sellPrice * GE_TAX_RATE), GE_TAX_CAP_PER_ITEM);
}

/** What actually lands in your pocket per unit sold. */
export function netSellPrice(sellPrice: number, itemId?: number): number {
  return sellPrice - geTax(sellPrice, itemId);
}

/** Profit on one unit, after tax. Can be negative — that is the point. */
export function marginPerUnit(buyPrice: number, sellPrice: number, itemId?: number): number {
  return netSellPrice(sellPrice, itemId) - buyPrice;
}

/** Return on capital for one unit, as a percentage of what you tied up. */
export function roiPercent(buyPrice: number, sellPrice: number, itemId?: number): number {
  if (buyPrice <= 0) return 0;
  return (marginPerUnit(buyPrice, sellPrice, itemId) / buyPrice) * 100;
}

/**
 * The lowest sell price that does not lose money.
 *
 * This matters more than it sounds, and it is the first thing that catches
 * people out on a small account: buy at 100, sell at 101 and you are DOWN one
 * gp, because the 2% is taken off the sale. Below roughly a 2.05% spread,
 * every flip is a loss no matter how it looks in the margin column.
 *
 * Solved by stepping up from the algebraic estimate rather than closed form,
 * because the floor in the tax makes the exact boundary jump around by a gp.
 */
export function breakevenSellPrice(buyPrice: number, itemId?: number): number {
  if (buyPrice <= 0) return 0;
  // Below the tax threshold, selling for a single gp more is already profit.
  if (buyPrice < GE_TAX_FREE_BELOW) return buyPrice + 1;

  let candidate = Math.floor(buyPrice / (1 - GE_TAX_RATE));
  // Walk the last couple of gp exactly; the floor means the estimate can sit
  // either side of the true boundary.
  for (let i = 0; i < 8; i++) {
    if (netSellPrice(candidate, itemId) > buyPrice) return candidate;
    candidate++;
  }
  return candidate;
}

/** The spread, as a percentage of the buy price, that a flip needs to clear. */
export function minimumViableSpreadPercent(buyPrice: number, itemId?: number): number {
  if (buyPrice <= 0) return 0;
  return ((breakevenSellPrice(buyPrice, itemId) - buyPrice) / buyPrice) * 100;
}

export type Opportunity = {
  itemId: number;
  name: string;
  buyPrice: number;
  sellPrice: number;
  marginPerUnit: number;
  roiPercent: number;
  /** Units you could buy in one 4-hour window, limited by cash AND buy limit. */
  unitsPerWindow: number;
  /** The number that actually matters: realistic profit per limit window. */
  profitPerWindow: number;
  /** What the whole position costs you up front. */
  capitalRequired: number;
  buyLimit: number;
  /** Units traded in the last hour, both sides summed. */
  hourlyVolume: number;
  /** Minutes since the most recent trade on the slower side of the book. */
  stalenessMinutes: number | null;
  confidence: Confidence;
};

export type Confidence = 'good' | 'thin' | 'stale' | 'unknown';

/**
 * How much to trust a margin.
 *
 * This is the thing most flip finders leave out, and it is where beginners
 * lose money: a 2,000 gp margin on an item that trades four times a day is
 * not an opportunity, it is a trap, because you will sit on it for hours and
 * the price will move before you fill. Volume and price age are the honest
 * caveats on every margin.
 */
export function confidenceOf(
  hourlyVolume: number,
  stalenessMinutes: number | null,
  unitsPerWindow: number
): Confidence {
  if (stalenessMinutes === null) return 'unknown';
  if (stalenessMinutes > 60) return 'stale';
  // Needing a meaningful share of the hour's whole volume to fill one window
  // means competing with everyone else for the same few trades.
  if (hourlyVolume <= 0) return 'stale';
  if (hourlyVolume < unitsPerWindow * 2) return 'thin';
  if (hourlyVolume < 20) return 'thin';
  return 'good';
}

export type PriceInput = {
  itemId: number;
  name: string;
  /** The instant-sell price: what buyers are paying. You buy at this. */
  low: number;
  /** The instant-buy price: what sellers are asking. You sell at this. */
  high: number;
  lowTime?: number | null;
  highTime?: number | null;
  buyLimit?: number | null;
  hourlyVolume?: number | null;
};

/**
 * Turn a price row into an opportunity, given how much cash the player has.
 *
 * The capital argument is the part aimed at real accounts rather than rich
 * ones. Profit per window is capped by whichever bites first — the item's
 * 4-hour buy limit, or what you can actually afford — so a 300k margin on an
 * item costing 50m is correctly shown as unreachable on a 500k stack instead
 * of sitting at the top of the table taunting you.
 */
export function evaluate(p: PriceInput, cashStack: number, now = Date.now()): Opportunity {
  const buyPrice = p.low;
  const sellPrice = p.high;
  const margin = marginPerUnit(buyPrice, sellPrice, p.itemId);

  const buyLimit = p.buyLimit && p.buyLimit > 0 ? p.buyLimit : 0;
  const affordable = buyPrice > 0 ? Math.floor(cashStack / buyPrice) : 0;
  const unitsPerWindow = buyLimit > 0 ? Math.min(buyLimit, affordable) : affordable;

  const times = [p.lowTime, p.highTime].filter((t): t is number => typeof t === 'number' && t > 0);
  // The older side governs: a fresh buy price is no use if nobody has sold
  // for three hours.
  const stalenessMinutes =
    times.length === 2 ? Math.round((now / 1000 - Math.min(...times)) / 60) : null;

  const hourlyVolume = p.hourlyVolume ?? 0;

  return {
    itemId: p.itemId,
    name: p.name,
    buyPrice,
    sellPrice,
    marginPerUnit: margin,
    roiPercent: roiPercent(buyPrice, sellPrice, p.itemId),
    unitsPerWindow,
    profitPerWindow: margin * unitsPerWindow,
    capitalRequired: buyPrice * unitsPerWindow,
    buyLimit,
    hourlyVolume,
    stalenessMinutes,
    confidence: confidenceOf(hourlyVolume, stalenessMinutes, unitsPerWindow),
  };
}

/** Realised profit on a completed flip, after tax, for the flip log. */
export function flipProfit(
  buyPrice: number,
  sellPrice: number,
  quantity: number,
  itemId?: number
): number {
  return marginPerUnit(buyPrice, sellPrice, itemId) * quantity;
}

/** 1,250,000 is hard to read at a glance; 1.25M is not. */
export function formatGp(gp: number): string {
  if (!Number.isFinite(gp)) return '0';
  const sign = gp < 0 ? '-' : '';
  const n = Math.abs(gp);
  if (n >= 1_000_000_000) return `${sign}${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${sign}${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 100_000) return `${sign}${Math.round(n / 1000)}K`;
  if (n >= 10_000) return `${sign}${(n / 1000).toFixed(1)}K`;
  return `${sign}${Math.round(n).toLocaleString('en-US')}`;
}

/** Accepts "1.5m", "250k", "1,000,000" — people type what they say. */
export function parseGp(raw: string): number | null {
  const s = String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/,/g, '')
    .replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^(\d+(?:\.\d+)?)([kmb])?$/);
  if (!m) return null;
  const n = parseFloat(m[1]);
  if (!Number.isFinite(n)) return null;
  const mult = m[2] === 'b' ? 1e9 : m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1;
  return Math.round(n * mult);
}
