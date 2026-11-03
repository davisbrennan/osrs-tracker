/**
 * What to actually type into the offer box.
 *
 * Every flip finder shows a margin and leaves you to work out the prices.
 * That gap matters, because the two prices the API gives you are not
 * offers — they are the last trades:
 *
 *   `low`  — the most recent price somebody SOLD at, instantly
 *   `high` — the most recent price somebody BOUGHT at, instantly
 *
 * Offering exactly those joins the back of a queue at a price that has
 * already cleared. To fill, you usually have to pay a little more when
 * buying and accept a little less when selling — and every gp of that
 * comes out of the margin.
 *
 * So the useful answer is not a single suggested price, which would be a
 * guess dressed as advice. It is the BAND: the most you can pay and the
 * least you can accept while the trade still makes money after tax. Then
 * you can be as aggressive as you like inside it and know exactly when you
 * have gone too far.
 *
 * What this cannot tell you: whether an offer will fill. The wiki's API
 * reports last-traded prices, not order book depth — nobody outside Jagex
 * can see how many buyers are queued at a price. Anything claiming
 * otherwise is guessing, so this page says what the arithmetic says and
 * stops there.
 */

import { geTax, netSellPrice, breakevenSellPrice, marginPerUnit } from '@/lib/osrs/ge';

/**
 * The most you can pay and still make at least a gp, selling at
 * `sellPrice`.
 *
 * The inverse of breakevenSellPrice. Exact rather than estimated: profit
 * is `netSellPrice(sell) - buy`, so the largest buy with a positive profit
 * is one gp under what the sale nets.
 */
export function maxBuyPrice(sellPrice: number, itemId?: number): number {
  if (!Number.isFinite(sellPrice) || sellPrice <= 0) return 0;
  return Math.max(0, netSellPrice(sellPrice, itemId) - 1);
}

export type Offers = {
  /** What the book last traded at. Where to start. */
  buyAt: number;
  sellAt: number;
  /** Pay more than this and the flip loses money even at the best sale. */
  maxBuy: number;
  /** Accept less than this and it loses money even at the best purchase. */
  minSell: number;
  /**
   * How far above the last sell you can bid and stay profitable. This is
   * the number that answers "what should I offer" — the room you have to
   * outbid other buyers.
   */
  overbidRoom: number;
  /** How far below the last buy you can undercut other sellers. */
  undercutRoom: number;
  /** Profit per unit at buyAt/sellAt, after tax. */
  margin: number;
  /** Tax paid on one unit sold at sellAt. */
  tax: number;
  /** False when there is no price at which this trade makes money. */
  viable: boolean;
};

/**
 * Turn a pair of last-traded prices into something you can act on.
 *
 * `overbidRoom` and `undercutRoom` come out of the same band and so
 * overlap: spending all of one leaves none of the other. Reported
 * separately because you spend them separately — one when buying, one
 * when selling, hours apart — and the total is the margin either way.
 */
export function suggestOffers(input: {
  low: number | null;
  high: number | null;
  itemId?: number;
}): Offers | null {
  const { low, high, itemId } = input;

  // A missing side is unknowable, not zero. An item nobody has sold has no
  // buy price, and guessing one is how you get told to pay nothing.
  if (low === null || high === null) return null;
  if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
  if (low <= 0 || high <= 0) return null;

  const margin = marginPerUnit(low, high, itemId);
  const maxBuy = maxBuyPrice(high, itemId);
  const minSell = breakevenSellPrice(low, itemId);

  return {
    buyAt: low,
    sellAt: high,
    maxBuy,
    minSell,
    // Negative when the trade is already under water, which is the honest
    // answer: there is no room, you are starting behind.
    overbidRoom: maxBuy - low,
    undercutRoom: high - minSell,
    margin,
    tax: geTax(high, itemId),
    viable: margin > 0,
  };
}

/**
 * Profit per unit if you improve both offers by this much.
 *
 * What "pay 5 more and accept 5 less" actually costs, which is about 10 —
 * people reliably underestimate this because they think about one side at a
 * time.
 *
 * About, not exactly: overbidding costs the full amount, but undercutting
 * costs slightly less than it looks, because a lower sale price is taxed
 * less. Recomputed from the prices rather than subtracted from the margin,
 * so the floor lands where the game puts it.
 */
export function marginAfterImproving(
  offers: Pick<Offers, 'buyAt' | 'sellAt'>,
  overbid: number,
  undercut: number,
  itemId?: number
): number {
  const buy = offers.buyAt + Math.max(0, overbid);
  const sell = offers.sellAt - Math.max(0, undercut);
  return marginPerUnit(buy, sell, itemId);
}

/**
 * How hard a flip is to get filled, from the room it leaves.
 *
 * Not a claim about the order book, which nobody outside Jagex can see.
 * It is a statement about the arithmetic: a flip with one gp of room has
 * to be filled at exactly the last traded prices to work at all, and a
 * flip with thousands can be bid up and undercut and still pay.
 */
export type Tightness = 'comfortable' | 'tight' | 'knife-edge' | 'none';

/**
 * Thresholds on the total band as a share of the buy price.
 *
 * The band is roughly twice the margin — each side's room is about one
 * margin — so 2% of room is about a 1% return on what you tie up. That is
 * the rough line below which a flip stops being worth the two trips to a
 * bank, and well below it you are relying on the price not moving at all.
 */
export const COMFORTABLE_PCT = 2;
export const TIGHT_PCT = 0.5;

export function tightness(offers: Offers): Tightness {
  if (!offers.viable) return 'none';

  const room = offers.overbidRoom + offers.undercutRoom;
  // Viable with nothing to spend: there IS a profitable pair of prices, but
  // only the last-traded ones exactly. 'none' would be a lie here.
  if (room <= 0) return 'knife-edge';

  // As a share of what you tie up, so a 2gp band on a 50gp item and a
  // 40,000gp band on a 1m item are judged the same way.
  const pct = (room / offers.buyAt) * 100;
  if (pct < TIGHT_PCT) return 'knife-edge';
  if (pct < COMFORTABLE_PCT) return 'tight';
  return 'comfortable';
}

export function tightnessLabel(t: Tightness): string {
  switch (t) {
    case 'comfortable':
      return 'room to compete';
    case 'tight':
      return 'little room';
    case 'knife-edge':
      return 'exact prices only';
    case 'none':
      return 'no profitable price';
  }
}
