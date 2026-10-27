/**
 * Price age.
 *
 * The case that matters is the asymmetric one: a fresh buy price and a
 * stale sell price is the exact shape of a trap, and anything that reports
 * a single reassuring "updated 2m ago" for it is actively misleading.
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
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const { priceAge, exactStamp, slowerSide, STALE_AFTER_MINUTES, POLL_OVERDUE_MINUTES } =
  await import('@/lib/osrs/freshness');
const { ago } = await import('@/lib/gp');

const NOW = new Date(2026, 0, 15, 12, 0, 0).getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

console.log('--- both sides measured separately ---');
{
  const a = priceAge(minsAgo(3), minsAgo(180), minsAgo(2), NOW);
  eq('buy side is fresh', a.buyMinutes, 3);
  eq('sell side is not', a.sellMinutes, 180);
  eq('the older side governs', a.olderMinutes, 180);
  ok('so it reads as stale', a.stale);
  ok(
    'and it is NOT reported as three minutes old',
    a.olderMinutes !== 3,
    'the trap this guards against'
  );
}

console.log('--- the slower side is named when the gap is meaningful ---');
{
  eq('sell side lagging', slowerSide(priceAge(minsAgo(2), minsAgo(200), null, NOW)), 'sell');
  eq('buy side lagging', slowerSide(priceAge(minsAgo(200), minsAgo(2), null, NOW)), 'buy');
  eq('a small gap names neither', slowerSide(priceAge(minsAgo(5), minsAgo(12), null, NOW)), null);
  eq('identical names neither', slowerSide(priceAge(minsAgo(9), minsAgo(9), null, NOW)), null);
  eq('unknown side names neither', slowerSide(priceAge(null, minsAgo(2), null, NOW)), null);
}

console.log('--- one unknown side makes the age unknown, not the other side ---');
{
  const a = priceAge(minsAgo(2), null, minsAgo(1), NOW);
  eq('the known side is still reported', a.buyMinutes, 2);
  eq('the unknown one stays unknown', a.sellMinutes, null);
  eq('and the governing age is unknown', a.olderMinutes, null);
  ok(
    'it does not fall back to the fresh side',
    a.olderMinutes !== 2,
    'that would call an unpriceable item fresh'
  );
  ok('and it is not claimed to be stale either', a.stale === false);
}

console.log('--- the staleness threshold ---');
{
  eq('the threshold', STALE_AFTER_MINUTES, 60);
  ok('just inside is fresh', priceAge(minsAgo(59), minsAgo(59), null, NOW).stale === false);
  ok('exactly on it is still fresh', priceAge(minsAgo(60), minsAgo(60), null, NOW).stale === false);
  ok('past it is stale', priceAge(minsAgo(61), minsAgo(61), null, NOW).stale);
}

console.log('--- our own polling is tracked apart from the market ---');
{
  eq('the threshold', POLL_OVERDUE_MINUTES, 20);

  // A price nobody has traded for hours, but our poller is healthy. The
  // market is quiet; we are fine.
  const quietMarket = priceAge(minsAgo(400), minsAgo(400), minsAgo(3), NOW);
  ok('the price is stale', quietMarket.stale);
  ok('but the poller is not overdue', quietMarket.pollOverdue === false);

  // A price that traded a minute ago, but we have not polled in an hour.
  // The market is busy; we are the problem.
  const brokenPoller = priceAge(minsAgo(1), minsAgo(1), minsAgo(60), NOW);
  ok('the price looks fresh', brokenPoller.stale === false);
  ok('but our data is overdue', brokenPoller.pollOverdue);
  ok(
    'the two are independent',
    quietMarket.stale !== quietMarket.pollOverdue && brokenPoller.stale !== brokenPoller.pollOverdue
  );
}

console.log('--- clock skew does not produce negative ages ---');
{
  const future = new Date(NOW + 10 * 60_000);
  const a = priceAge(future, future, future, NOW);
  eq('a future timestamp reads as now', a.buyMinutes, 0);
  eq('not as negative', a.sellMinutes, 0);
  ok('and nothing is stale', a.stale === false);
  eq('ago() renders it as now', ago(a.buyMinutes), 'now');
}

console.log('--- everything unknown ---');
{
  const a = priceAge(null, null, null, NOW);
  eq('buy', a.buyMinutes, null);
  eq('sell', a.sellMinutes, null);
  eq('governing', a.olderMinutes, null);
  ok('not stale', a.stale === false);
  ok('not overdue', a.pollOverdue === false);
  eq('and ago() says so', ago(a.olderMinutes), 'unknown');
}

console.log('--- the exact stamp, for the tooltip behind the relative one ---');
{
  const s = exactStamp(minsAgo(90));
  ok('produces something', typeof s === 'string' && s!.length > 0, s);
  ok('names the day', /Thu|Wed|Fri|Mon|Tue|Sat|Sun/.test(s!), s);
  ok('and carries a time', /\d{2}:\d{2}/.test(s!), s);
  // A stamp without a year reads as this year. A price from last October
  // would render "Sun 26 Oct" and look like yesterday.
  ok('and the year, so an old price cannot pass for a recent one', /\b2026\b/.test(s!), s);
  const lastYear = exactStamp(new Date(2025, 9, 26, 12, 16));
  ok('a year-old stamp says 2025', /\b2025\b/.test(lastYear!), lastYear);
  ok('and is distinguishable from this year', lastYear !== exactStamp(new Date(2026, 9, 26, 12, 16)));
  eq('nothing to stamp', exactStamp(null), undefined);
  eq('undefined too', exactStamp(undefined), undefined);
}

console.log('--- the relative rendering people actually read ---');
{
  eq('under a minute', ago(0.4), 'now');
  eq('minutes', ago(42), '42m');
  eq('hours', ago(185), '3h');
  eq('days', ago(60 * 24 * 3), '3d');
}

console.log('--- the site-wide sync indicator ---');
{
  const { SYNC_OVERDUE_MINUTES } = await import('@/lib/osrs/last-sync');
  eq('overdue threshold', SYNC_OVERDUE_MINUTES, 20);

  // The indicator and the per-price staleness answer different questions and
  // must be able to disagree, which is the entire reason both exist.
  const quietMarketHealthyPoller = priceAge(minsAgo(400), minsAgo(400), minsAgo(4), NOW);
  ok('a stale price with a healthy poll is not our fault', !quietMarketHealthyPoller.pollOverdue);
  ok('though the price is still stale', quietMarketHealthyPoller.stale);

  const busyMarketDeadPoller = priceAge(minsAgo(1), minsAgo(1), minsAgo(90), NOW);
  ok('a fresh price with a dead poll is our fault', busyMarketDeadPoller.pollOverdue);
  ok('even though the price looks fine', !busyMarketDeadPoller.stale);

  // The five-minute poll means a sync a few minutes old is normal.
  ok('four minutes is fine', !priceAge(null, null, minsAgo(4), NOW).pollOverdue);
  ok('twenty minutes is the edge', !priceAge(null, null, minsAgo(20), NOW).pollOverdue);
  ok('twenty-one is overdue', priceAge(null, null, minsAgo(21), NOW).pollOverdue);
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
