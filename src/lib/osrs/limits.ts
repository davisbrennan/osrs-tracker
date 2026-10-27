/**
 * Buy-limit capacity — the Grand Exchange's version of buying power.
 *
 * Every item has a cap on how many units one account may buy per four hours,
 * and it is the single hardest constraint on flipping at size: it is why a
 * large position is necessarily several lots, which is why the book is built
 * on executions in the first place.
 *
 * The mechanic is a FIXED window, not a rolling one, and the difference is
 * not cosmetic. From the wiki: "This timer is based on the first item bought
 * in the 4-hour slot... 4 hours after the first item is bought, the buying
 * limit is completely reset."
 *
 * So buying 60 at 12:00 and 40 at 14:00 gives you the whole limit back at
 * 16:00 — not 60 back at 16:00 and 40 back at 18:00. An implementation that
 * summed "buys in the trailing four hours" would report capacity you do not
 * have, and withhold capacity you do. It would be wrong in both directions.
 *
 * Pure: trades and a clock in, numbers out. No database, no network.
 *
 * Two honest limits on what this can know:
 *
 *  - It models windows from the fills RECORDED HERE. Anything bought in game
 *    and not logged is invisible to it, so it is a projection of your own
 *    book, not a reading from Jagex. The UI says so.
 *  - Some items share a limit across variants (the wiki's example is prayer
 *    potion doses). Modelling that needs a mapping of linked items that no
 *    API publishes, so linked items are counted separately here.
 */

export const BUY_LIMIT_WINDOW_MS = 4 * 60 * 60 * 1000;

/** Just enough of a trade for this to work; keeps it decoupled from the book. */
export type LimitTrade = {
  itemId: number;
  side: 'buy' | 'sell';
  quantity: number;
  executedAt: Date;
};

export type LimitStatus = {
  itemId: number;
  /** The published cap per window, or null when the wiki publishes none. */
  limit: number | null;
  /** Units bought inside the window that is currently open. */
  used: number;
  /** limit - used, floored at zero. Null when there is no published limit. */
  remaining: number | null;
  /** When the open window resets. Null when no window is open. */
  resetsAt: Date | null;
  /** Milliseconds until that reset; null when no window is open. */
  resetsInMs: number | null;
  /** True when a limit is published and nothing more can be bought yet. */
  exhausted: boolean;
};

/**
 * Group an item's buys into fixed four-hour windows.
 *
 * The first buy opens a window; every buy inside it belongs to it; the next
 * buy after it closes opens the next one. Exported for the tests, because
 * the windowing is the part worth pinning down.
 */
export function buyWindows(trades: LimitTrade[]): { start: Date; end: Date; units: number }[] {
  const buys = trades
    .filter((t) => t.side === 'buy')
    .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime());

  const windows: { start: Date; end: Date; units: number }[] = [];
  for (const b of buys) {
    const current = windows[windows.length - 1];
    if (current && b.executedAt.getTime() < current.end.getTime()) {
      current.units += b.quantity;
    } else {
      windows.push({
        start: b.executedAt,
        end: new Date(b.executedAt.getTime() + BUY_LIMIT_WINDOW_MS),
        units: b.quantity,
      });
    }
  }
  return windows;
}

/** Capacity for one item, from that item's trades. */
export function limitStatus(
  itemId: number,
  limit: number | null,
  trades: LimitTrade[],
  now: Date = new Date()
): LimitStatus {
  const windows = buyWindows(trades.filter((t) => t.itemId === itemId));
  const open = windows[windows.length - 1];

  // No window, or the last one has already elapsed: the limit is whole again.
  if (!open || open.end.getTime() <= now.getTime()) {
    return {
      itemId,
      limit,
      used: 0,
      remaining: limit,
      resetsAt: null,
      resetsInMs: null,
      exhausted: false,
    };
  }

  const used = open.units;
  const remaining = limit === null ? null : Math.max(0, limit - used);
  return {
    itemId,
    limit,
    used,
    remaining,
    resetsAt: open.end,
    resetsInMs: open.end.getTime() - now.getTime(),
    exhausted: remaining !== null && remaining === 0,
  };
}

/** Capacity for every item that has been traded, keyed by item id. */
export function limitStatuses(
  trades: LimitTrade[],
  limits: Map<number, number | null>,
  now: Date = new Date()
): Map<number, LimitStatus> {
  const out = new Map<number, LimitStatus>();
  for (const itemId of new Set(trades.map((t) => t.itemId))) {
    out.set(itemId, limitStatus(itemId, limits.get(itemId) ?? null, trades, now));
  }
  return out;
}

/** "1h 12m", "48m", "under a minute" — for a countdown, not a duration. */
export function formatResetIn(ms: number | null): string | null {
  if (ms === null || ms <= 0) return null;
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return 'under a minute';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}
