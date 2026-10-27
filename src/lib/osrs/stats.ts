/**
 * Is this unusual?
 *
 * Everything else on this site answers "what would I actually clear right
 * now". This answers the question that decides whether now is the moment: a
 * 6% spread means nothing on its own, and everything once you know the item
 * normally runs 2%.
 *
 * THREE CHOICES WORTH DEFENDING
 *
 * 1. ROBUST STATISTICS, NOT MEAN AND STANDARD DEVIATION. Item prices are
 *    skewed and punctuated by spikes — an update, a streamer, a brief
 *    manipulation. A mean and a standard deviation are dragged around by
 *    exactly those events, so a single bad day makes everything afterwards
 *    look normal. Median and median absolute deviation are not. The
 *    modified z-score here is Iglewicz and Hoaglin's: 0.6745 x (x - median)
 *    / MAD, where 0.6745 is the 75th percentile of the standard normal, the
 *    scaling that makes MAD comparable to a standard deviation.
 *
 * 2. PERCENTILE RANK FOR DISPLAY. "The 93rd percentile of the last 90 days"
 *    is something a person can act on. A z-score of 1.8 is not, and on
 *    skewed data it is also a bit of a lie. The z is kept for ranking, where
 *    its continuity matters; the percentile is what gets shown.
 *
 * 3. A MINIMUM SAMPLE, ENFORCED. A percentile computed from four days is
 *    noise wearing a number's clothes. Below the floor everything returns
 *    null and the interface says there is not enough history yet, rather
 *    than asserting a figure nobody should trust. This matters most in the
 *    first weeks after a deployment, which is exactly when the temptation to
 *    show something is strongest.
 *
 * Pure: bars in, numbers out.
 */

/** Below this many daily bars, no statistic is reported. */
export const MIN_SAMPLE_DAYS = 20;

/** The window every statistic is measured over. */
export const CONTEXT_DAYS = 90;

/** 0.6745 = the 75th percentile of the standard normal. See note 1 above. */
export const MAD_SCALE = 0.6745;

/** What a day of trading looked like. One row per item per day. */
export type DailyBar = {
  /** Midnight UTC of the day this covers. */
  day: Date;
  avgHigh: number | null;
  avgLow: number | null;
  /** Units traded that day, both sides summed. */
  volume: number;
};

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation from the median. */
export function mad(values: number[]): number | null {
  const m = median(values);
  if (m === null) return null;
  return median(values.map((v) => Math.abs(v - m)));
}

/**
 * Where `x` sits in `values`, as 0–100.
 *
 * Uses the midpoint convention: values strictly below, plus half of those
 * equal. That keeps a value equal to everything else at 50 rather than at 0
 * or 100, which is the honest answer for a flat series.
 */
export function percentileRank(values: number[], x: number): number | null {
  if (values.length === 0) return null;
  let below = 0;
  let equal = 0;
  for (const v of values) {
    if (v < x) below++;
    else if (v === x) equal++;
  }
  return ((below + equal / 2) / values.length) * 100;
}

/**
 * Modified z-score. Null when the series has no spread at all.
 *
 * A MAD of zero means more than half the values are identical, so there is
 * no scale to measure against and any answer would be an artefact. Returning
 * null is the only honest option.
 */
export function robustZ(values: number[], x: number): number | null {
  const m = median(values);
  const d = mad(values);
  if (m === null || d === null || d === 0) return null;
  return (MAD_SCALE * (x - m)) / d;
}

/** Where `x` falls between the lowest and highest, as 0–100. */
export function rangePosition(values: number[], x: number): number | null {
  if (values.length === 0) return null;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  if (hi === lo) return 50;
  return ((x - lo) / (hi - lo)) * 100;
}

/**
 * Typical day-to-day movement, as a percentage.
 *
 * The median absolute daily change rather than the standard deviation of
 * returns, for the same reason as everything else here: one spike should not
 * define an item's character. Read it as "on a normal day this moves about
 * this much", which is what tells you whether holding it overnight is
 * comfortable.
 */
export function typicalDailyMovePct(prices: number[]): number | null {
  if (prices.length < 2) return null;
  const moves: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    const prev = prices[i - 1];
    if (prev > 0) moves.push(Math.abs((prices[i] - prev) / prev) * 100);
  }
  return median(moves);
}

export type HistoryContext = {
  /** Daily bars with a usable price. Below MIN_SAMPLE_DAYS, everything is null. */
  samples: number;
  enough: boolean;

  /** Where today's buy price sits in the period's range, 0–100. */
  pricePosition: number | null;
  /** Percentile of today's buy price against the period. */
  pricePercentile: number | null;
  periodLow: number | null;
  periodHigh: number | null;

  /** Percentile of today's spread, as a share of price, against the period. */
  spreadPercentile: number | null;
  /** Modified z of the same. Used for ranking, not for display. */
  spreadZ: number | null;
  /** The item's usual spread as a percentage of its price. */
  medianSpreadPct: number | null;
  /** Today's spread as a percentage of its price. */
  currentSpreadPct: number | null;

  /**
   * Today's trading RATE against its usual rate. 1 means ordinary.
   *
   * Both sides are per-hour. The bars hold whole-day totals and the live
   * figure is an hourly one, so the daily median is divided by 24 before
   * comparing — without that every item reads as trading at a twenty-fourth
   * of its normal rate, which is a very confident way of saying nothing.
   */
  volumeRatio: number | null;
  /** The usual whole-day total, which is what the interface quotes. */
  medianVolume: number | null;

  /** Median absolute daily price move, as a percentage. */
  typicalMovePct: number | null;
};

/**
 * Summarise an item's recent history against where it is now.
 *
 * `bars` should be one row per day at a uniform granularity — mixing hourly
 * and daily points would silently weight recent days more heavily, which is
 * the sort of error that produces plausible, confident, wrong numbers.
 */
export const HOURS_PER_DAY = 24;

export function historyContext(
  bars: DailyBar[],
  currentLow: number | null,
  currentHigh: number | null,
  /** Units traded in the last HOUR. The bars are daily; see volumeRatio. */
  currentHourlyVolume: number | null
): HistoryContext {
  const usable = bars.filter(
    (b): b is DailyBar & { avgHigh: number; avgLow: number } =>
      b.avgHigh !== null && b.avgLow !== null && b.avgLow > 0
  );

  const empty: HistoryContext = {
    samples: usable.length,
    enough: false,
    pricePosition: null,
    pricePercentile: null,
    periodLow: null,
    periodHigh: null,
    spreadPercentile: null,
    spreadZ: null,
    medianSpreadPct: null,
    currentSpreadPct: null,
    volumeRatio: null,
    medianVolume: null,
    typicalMovePct: null,
  };

  if (usable.length < MIN_SAMPLE_DAYS) return empty;

  // Sorted oldest first, so the day-to-day move is measured in order.
  const ordered = [...usable].sort((a, b) => a.day.getTime() - b.day.getTime());

  const lows = ordered.map((b) => b.avgLow);
  const spreadPcts = ordered.map((b) => ((b.avgHigh - b.avgLow) / b.avgLow) * 100);
  const volumes = ordered.map((b) => b.volume);

  const currentSpreadPct =
    currentLow !== null && currentHigh !== null && currentLow > 0
      ? ((currentHigh - currentLow) / currentLow) * 100
      : null;

  const medVolume = median(volumes);

  return {
    samples: usable.length,
    enough: true,
    pricePosition: currentLow === null ? null : rangePosition(lows, currentLow),
    pricePercentile: currentLow === null ? null : percentileRank(lows, currentLow),
    periodLow: Math.min(...lows),
    periodHigh: Math.max(...lows),
    spreadPercentile:
      currentSpreadPct === null ? null : percentileRank(spreadPcts, currentSpreadPct),
    spreadZ: currentSpreadPct === null ? null : robustZ(spreadPcts, currentSpreadPct),
    medianSpreadPct: median(spreadPcts),
    currentSpreadPct,
    volumeRatio:
      currentHourlyVolume === null || medVolume === null || medVolume === 0
        ? null
        : currentHourlyVolume / (medVolume / HOURS_PER_DAY),
    medianVolume: medVolume,
    typicalMovePct: typicalDailyMovePct(lows),
  };
}

/** Plain-English labels, so a percentile does not need interpreting. */
export function describePercentile(p: number | null): string | null {
  if (p === null) return null;
  if (p >= 95) return 'far above normal';
  if (p >= 80) return 'above normal';
  if (p > 20) return 'normal';
  if (p > 5) return 'below normal';
  return 'far below normal';
}
