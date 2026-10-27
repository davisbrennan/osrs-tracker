/**
 * How old is this price?
 *
 * The Grand Exchange has two clocks per item and they rarely agree. The wiki
 * reports the moment of the last trade on each side separately: `lowTime` is
 * when somebody last sold into a buy offer, `highTime` when somebody last
 * bought from a sell offer. An item can have a two-minute-old buy price and
 * a six-hour-old sell price, and that asymmetry is the whole story — it
 * means you can get in but not out.
 *
 * So a single "last updated" is not quite a real thing, and anywhere that
 * has to pick one picks the OLDER side. A margin needs both ends to be
 * current; a fresh buy price is no use if nobody has sold for three hours.
 * That is the convention `evaluate` already uses for its confidence rating,
 * and this module exists so every page computes it the same way rather than
 * each reaching for whichever timestamp is nearest to hand.
 *
 * Distinct from all of the above: `fetchedAt` is when WE last polled. A
 * price can be hours old because nobody has traded, which is a fact about
 * the market, or because our poller has stopped, which is a fact about us.
 * Showing only one of those makes the two indistinguishable.
 *
 * Pure.
 */

/** Beyond this, a price is too old to price a trade from. */
export const STALE_AFTER_MINUTES = 60;

/** Our own data is suspect beyond this — the poller runs every five minutes. */
export const POLL_OVERDUE_MINUTES = 20;

export type PriceAge = {
  /** Minutes since someone last sold into a buy offer. Null when unknown. */
  buyMinutes: number | null;
  /** Minutes since someone last bought from a sell offer. Null when unknown. */
  sellMinutes: number | null;
  /**
   * The older of the two, which is what governs.
   *
   * Null when either side is unknown — not the known one. An item we have
   * never seen trade on one side is not "fresh on the other", it is an item
   * we cannot price, and quietly using the known side would hide that.
   */
  olderMinutes: number | null;
  /** True when the governing side is past STALE_AFTER_MINUTES. */
  stale: boolean;
  /** Minutes since our own last poll. Null when unknown. */
  fetchedMinutes: number | null;
  /** True when our poller looks to have stopped, rather than the market. */
  pollOverdue: boolean;
};

function minutesSince(at: Date | null | undefined, now: number): number | null {
  if (!at) return null;
  const ms = now - at.getTime();
  // A timestamp in the future means clock skew somewhere. Treat it as now
  // rather than reporting a negative age.
  return ms < 0 ? 0 : ms / 60_000;
}

export function priceAge(
  lowTime: Date | null | undefined,
  highTime: Date | null | undefined,
  fetchedAt: Date | null | undefined,
  now: number = Date.now()
): PriceAge {
  const buyMinutes = minutesSince(lowTime, now);
  const sellMinutes = minutesSince(highTime, now);
  const olderMinutes =
    buyMinutes === null || sellMinutes === null ? null : Math.max(buyMinutes, sellMinutes);
  const fetchedMinutes = minutesSince(fetchedAt, now);

  return {
    buyMinutes,
    sellMinutes,
    olderMinutes,
    stale: olderMinutes !== null && olderMinutes > STALE_AFTER_MINUTES,
    fetchedMinutes,
    pollOverdue: fetchedMinutes !== null && fetchedMinutes > POLL_OVERDUE_MINUTES,
  };
}

/**
 * The exact moment, for a tooltip behind the relative figure.
 *
 * "3h ago" is what you want at a glance and useless when you are trying to
 * work out whether a price predates an update. Both, with the precise one a
 * hover away.
 */
export function exactStamp(at: Date | null | undefined): string | undefined {
  if (!at) return undefined;
  // The YEAR is not optional. Without it a timestamp from last October
  // renders as "Sun 26 Oct" and reads as yesterday — which is the exact
  // misreading a precision tooltip exists to prevent, and it showed up on
  // real rows the moment this was looked at.
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(at);
}

/** Which side is holding the price back, when one clearly is. */
export function slowerSide(age: PriceAge): 'buy' | 'sell' | null {
  if (age.buyMinutes === null || age.sellMinutes === null) return null;
  // Only worth naming when the gap is big enough to mean something.
  const gap = Math.abs(age.buyMinutes - age.sellMinutes);
  if (gap < 15) return null;
  return age.buyMinutes > age.sellMinutes ? 'buy' : 'sell';
}
