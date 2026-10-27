/**
 * The statistics behind "is this unusual?".
 *
 * Every expected value here was worked out independently — by hand for the
 * small cases, and the percentile and MAD figures cross-checked against the
 * definitions rather than against what the code happens to return. A
 * statistics module that is tested against itself is just a very confident
 * way of being wrong.
 */

let fail = 0;
let checks = 0;

const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` WANT ${JSON.stringify(want)}`}`
  );
};
const near = (label: string, got: number | null, want: number, tol = 1e-9) => {
  checks++;
  const ok = got !== null && Math.abs(got - want) <= tol;
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${got}${ok ? '' : ` WANT ~${want}`}`);
};
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const {
  median,
  mad,
  percentileRank,
  robustZ,
  rangePosition,
  typicalDailyMovePct,
  historyContext,
  describePercentile,
  MIN_SAMPLE_DAYS,
  MAD_SCALE,
} = await import('@/lib/osrs/stats');

console.log('--- median ---');
{
  eq('odd length takes the middle', median([3, 1, 2]), 2);
  eq('even length averages the two', median([4, 1, 3, 2]), 2.5);
  eq('one value', median([7]), 7);
  eq('empty is unknown, not zero', median([]), null);
  eq('does not need sorting first', median([9, 1, 5]), 5);
  const input = [3, 1, 2];
  median(input);
  eq('and does not reorder its input', input, [3, 1, 2]);
}

console.log('--- median absolute deviation ---');
{
  // [1,2,3,4,100]: median 3. Deviations |−2|,|−1|,0,1,97 → [0,1,1,2,97],
  // whose median is 1. A standard deviation here would be about 43.
  eq('robust against one wild value', mad([1, 2, 3, 4, 100]), 1);
  eq('a flat series has no spread', mad([5, 5, 5, 5]), 0);
  eq('empty', mad([]), null);
}

console.log('--- percentile rank, midpoint convention ---');
{
  const v = [10, 20, 30, 40];
  // 25 beats 10 and 20, ties nothing → 2/4 = 50.
  eq('between values', percentileRank(v, 25), 50);
  // 10 beats nothing, ties itself → (0 + 0.5)/4 = 12.5.
  eq('equal to the lowest', percentileRank(v, 10), 12.5);
  eq('equal to the highest', percentileRank(v, 40), 87.5);
  eq('below everything', percentileRank(v, 1), 0);
  eq('above everything', percentileRank(v, 99), 100);
  // Every value identical: x ties all of them → (0 + 4/2)/4 = 50.
  eq('a flat series sits at the middle, not an extreme', percentileRank([7, 7, 7, 7], 7), 50);
  eq('empty', percentileRank([], 5), null);
}

console.log('--- modified z-score ---');
{
  // [1,2,3,4,5]: median 3, MAD 1. For x=5: 0.6745*(5-3)/1 = 1.349.
  near('two MADs above the median', robustZ([1, 2, 3, 4, 5], 5), 1.349, 1e-12);
  near('at the median it is zero', robustZ([1, 2, 3, 4, 5], 3), 0);
  near('below the median is negative', robustZ([1, 2, 3, 4, 5], 1), -1.349, 1e-12);

  // The scaling constant is the 75th percentile of the standard normal,
  // which is what makes MAD comparable to a standard deviation.
  near('the scale constant', MAD_SCALE, 0.6745, 1e-12);

  eq('no spread means no answer', robustZ([5, 5, 5], 9), null);
  eq('empty', robustZ([], 1), null);

  // The point of using MAD: one outlier must not flatten everything else.
  const withSpike = [10, 11, 12, 13, 1000];
  const z = robustZ(withSpike, 13)!;
  ok('a spike does not swallow the signal', Math.abs(z) > 0.5, `z=${z.toFixed(3)}`);
}

console.log('--- range position ---');
{
  eq('at the bottom', rangePosition([10, 20, 30], 10), 0);
  eq('at the top', rangePosition([10, 20, 30], 30), 100);
  eq('halfway', rangePosition([10, 20, 30], 20), 50);
  eq('a flat range is the middle, not a divide by zero', rangePosition([5, 5], 5), 50);
  eq('empty', rangePosition([], 1), null);
}

console.log('--- typical daily move ---');
{
  // 100 → 110 is 10%, 110 → 99 is 10%, 99 → 99 is 0%. Median of [10,10,0] = 10.
  near('median absolute move', typicalDailyMovePct([100, 110, 99, 99]), 10, 1e-9);
  eq('one point cannot move', typicalDailyMovePct([100]), null);
  eq('no points', typicalDailyMovePct([]), null);
  near('a flat series does not move', typicalDailyMovePct([50, 50, 50]), 0);
}

/* ------------------------------------------------------------------ context */

const day = (n: number) => new Date(Date.UTC(2026, 0, n));
const bars = (n: number, f: (i: number) => { avgHigh: number; avgLow: number; volume: number }) =>
  Array.from({ length: n }, (_, i) => ({ day: day(i + 1), ...f(i) }));

console.log('--- too little history asserts nothing ---');
{
  const few = bars(MIN_SAMPLE_DAYS - 1, () => ({ avgHigh: 110, avgLow: 100, volume: 1000 }));
  const ctx = historyContext(few, 100, 130, 1000);
  eq('it counts what it has', ctx.samples, MIN_SAMPLE_DAYS - 1);
  eq('but says it is not enough', ctx.enough, false);
  eq('and reports nothing', ctx.spreadPercentile, null);
  eq('nor a price position', ctx.pricePosition, null);
  eq('nor a volume ratio', ctx.volumeRatio, null);

  // One more bar crosses the line.
  const justEnough = bars(MIN_SAMPLE_DAYS, () => ({ avgHigh: 110, avgLow: 100, volume: 1000 }));
  eq('at the floor it reports', historyContext(justEnough, 100, 130, 1000).enough, true);
}

console.log('--- bars without a price do not count towards the sample ---');
{
  const mixed = [
    ...bars(MIN_SAMPLE_DAYS - 2, () => ({ avgHigh: 110, avgLow: 100, volume: 10 })),
    { day: day(90), avgHigh: null, avgLow: null, volume: 10 },
    { day: day(91), avgHigh: 110, avgLow: null, volume: 10 },
    { day: day(92), avgHigh: 110, avgLow: 0, volume: 10 },
  ];
  const ctx = historyContext(mixed, 100, 110, 10);
  eq('only priced days count', ctx.samples, MIN_SAMPLE_DAYS - 2);
  eq('so it is still short', ctx.enough, false);
}

console.log('--- a wide spread today reads as unusual ---');
{
  // 30 days at a steady 2% spread, then today at 8%.
  const steady = bars(30, () => ({ avgHigh: 102, avgLow: 100, volume: 1000 }));
  const ctx = historyContext(steady, 100, 108, 1000);
  eq('enough history', ctx.enough, true);
  near('its usual spread', ctx.medianSpreadPct!, 2, 1e-9);
  near("today's spread", ctx.currentSpreadPct!, 8, 1e-9);
  eq('above everything it has done', ctx.spreadPercentile, 100);
  eq('described plainly', describePercentile(ctx.spreadPercentile), 'far above normal');
  // Every historical spread is identical, so MAD is zero and no z exists.
  eq('and no z, because the history has no spread of its own', ctx.spreadZ, null);
}

console.log('--- an ordinary spread reads as ordinary ---');
{
  // Spreads cycling 1..5%, today at 3% — the middle of its own range.
  const varied = bars(30, (i) => {
    const pct = 1 + (i % 5);
    return { avgHigh: 100 * (1 + pct / 100), avgLow: 100, volume: 1000 };
  });
  const ctx = historyContext(varied, 100, 103, 1000);
  ok('mid-range percentile', ctx.spreadPercentile! > 30 && ctx.spreadPercentile! < 70, `${ctx.spreadPercentile}`);
  eq('described as normal', describePercentile(ctx.spreadPercentile), 'normal');
  ok('and the z is small', Math.abs(ctx.spreadZ!) < 1, `z=${ctx.spreadZ}`);
}

console.log('--- price position within the period ---');
{
  // Lows walking 100..129; today at 100 is the floor.
  const walking = bars(30, (i) => ({ avgHigh: 100 + i + 5, avgLow: 100 + i, volume: 1000 }));
  const atLow = historyContext(walking, 100, 110, 1000);
  eq('period low', atLow.periodLow, 100);
  eq('period high', atLow.periodHigh, 129);
  near('sitting on the floor', atLow.pricePosition!, 0);
  eq('and described that way', describePercentile(atLow.pricePercentile), 'far below normal');

  const atHigh = historyContext(walking, 129, 140, 1000);
  near('at the ceiling', atHigh.pricePosition!, 100);

  const midway = historyContext(walking, 114.5, 120, 1000);
  near('halfway up', midway.pricePosition!, 50);
}

console.log('--- volume compares an hourly rate with an hourly rate ---');
{
  // The bars hold DAILY totals; the live figure is HOURLY. 2,400 a day is
  // 100 an hour, so an item doing 100 this hour is having an ordinary day.
  // Comparing the two directly would report 100/2400 = 0.04x and declare
  // every item in the game unusually quiet.
  const steady = bars(30, () => ({ avgHigh: 110, avgLow: 100, volume: 2400 }));
  near('an ordinary hour', historyContext(steady, 100, 110, 100).volumeRatio!, 1);
  near('triple the usual rate', historyContext(steady, 100, 110, 300).volumeRatio!, 3);
  near('a quarter of it', historyContext(steady, 100, 110, 25).volumeRatio!, 0.25);
  ok(
    'and the raw daily total is NOT what it divides by',
    historyContext(steady, 100, 110, 100).volumeRatio !== 100 / 2400
  );
  eq(
    'the usual day is still reported as a day',
    historyContext(steady, 100, 110, 100).medianVolume,
    2400
  );
  eq('unknown volume stays unknown', historyContext(steady, 100, 110, null).volumeRatio, null);

  // An item that normally does nothing cannot have a ratio — dividing by a
  // median of zero would produce Infinity and rank it top of everything.
  const dead = bars(30, () => ({ avgHigh: 110, avgLow: 100, volume: 0 }));
  eq('a median of zero gives no ratio', historyContext(dead, 100, 110, 50).volumeRatio, null);
}

console.log('--- the order bars arrive in does not matter ---');
{
  const asc = bars(30, (i) => ({ avgHigh: 100 + i + 5, avgLow: 100 + i, volume: 1000 + i }));
  const desc = [...asc].reverse();
  const a = historyContext(asc, 110, 118, 1200);
  const b = historyContext(desc, 110, 118, 1200);
  eq('same price position', a.pricePosition, b.pricePosition);
  eq('same spread percentile', a.spreadPercentile, b.spreadPercentile);
  eq('same typical move', a.typicalMovePct, b.typicalMovePct);
}

console.log('--- a missing current price yields nulls, not zeros ---');
{
  const steady = bars(30, () => ({ avgHigh: 110, avgLow: 100, volume: 1000 }));
  const ctx = historyContext(steady, null, null, 1000);
  eq('enough history, but nothing to compare', ctx.enough, true);
  eq('no price position', ctx.pricePosition, null);
  eq('no spread percentile', ctx.spreadPercentile, null);
  eq('the period range is still known', ctx.periodLow, 100);
  ok('and the volume ratio still works', ctx.volumeRatio === 1000 / (1000 / 24));
}

console.log('--- plain-English labels ---');
{
  eq('top', describePercentile(99), 'far above normal');
  eq('high', describePercentile(85), 'above normal');
  eq('middle', describePercentile(50), 'normal');
  eq('low', describePercentile(10), 'below normal');
  eq('bottom', describePercentile(2), 'far below normal');
  eq('unknown stays unknown', describePercentile(null), null);
  // The boundaries, so a relabel cannot silently shift a band.
  eq('95 is far above', describePercentile(95), 'far above normal');
  eq('80 is above', describePercentile(80), 'above normal');
  eq('20 is below', describePercentile(20), 'below normal');
  eq('5 is far below', describePercentile(5), 'far below normal');
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
