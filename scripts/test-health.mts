/**
 * Health grading.
 *
 * The case this whole feature exists for is the one a health page usually
 * gets wrong: a job that ran and correctly found nothing to do produces the
 * same empty table as a job that has been throwing since the day it shipped.
 * Several checks below are that distinction, from both sides.
 *
 * The second theme is that an unknown must never grade as a pass. A health
 * page that reports green because a query came back empty is worse than no
 * health page, because it is believed.
 */

const {
  gradeJob,
  gradeCatalogue,
  gradeMethods,
  gradeWiki,
  gradeHistory,
  gradeAlerts,
  overallStatus,
  countByStatus,
  lateAfterMs,
  humanMs,
  percent,
  LATE_FLOOR_MS,
} = await import('@/lib/osrs/health');
const { JOBS } = await import('@/lib/osrs/jobs');
const { errorMessage } = await import('@/lib/osrs/jobs/record');
const { MIN_SAMPLE_DAYS } = await import('@/lib/osrs/stats');

type Check = { id: string; title: string; status: string; detail: string; fix?: string; command?: string };
type JobRun = {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  error: string | null;
  durationMs: number | null;
  result: unknown;
};

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

const NOW = new Date('2026-10-27T18:00:00Z');
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

const run = (over: Partial<JobRun> = {}): JobRun => ({
  job: 'sync-prices',
  startedAt: minutesAgo(2),
  finishedAt: minutesAgo(2),
  status: 'ok',
  error: null,
  durationMs: 4_000,
  result: { fetched: 4012 },
  ...over,
});

console.log('\nNever run is not the same as nothing to do');
{
  // The whole point. Both of these jobs have written nothing; only one of
  // them is fine, and before the run log they were indistinguishable.
  const never = gradeJob('sync-wiki', undefined, NOW) as Check;
  eq('no run at all → fail', never.status, 'fail');
  ok('and says so plainly', never.detail.toLowerCase().includes('never'), never.detail);
  ok('and carries a fix', Boolean(never.fix && never.command));

  const ranFoundNothing = gradeJob(
    'sync-wiki',
    run({ job: 'sync-wiki', startedAt: minutesAgo(10), result: { fetched: 0, described: 0 } }),
    NOW
  ) as Check;
  eq('ran recently, found nothing → ok', ranFoundNothing.status, 'ok');
  ok('and offers no fix, because nothing is wrong', ranFoundNothing.fix === undefined);
}

console.log('\nA failed run reports its own message');
{
  const c = gradeJob(
    'sync-prices',
    run({ status: 'failed', error: 'getaddrinfo ENOTFOUND prices.runescape.wiki' }),
    NOW
  ) as Check;
  eq('failed → fail', c.status, 'fail');
  ok('the message is in the detail', c.detail.includes('ENOTFOUND'), c.detail);
  ok('the command greps for that job', (c.command ?? '').includes('sync-prices'), c.command);
}

console.log('\nLateness is two intervals, never less than ten minutes');
{
  eq('a 5-minute job is late after 10m', lateAfterMs(5 * 60_000), 10 * 60_000);
  // A one-minute job doubled is two minutes, which would have this page
  // crying about every slow tick. The floor stops that.
  eq('a 1-minute job still gets the floor', lateAfterMs(60_000), LATE_FLOOR_MS);
  eq('a 6-hour job is late after 12h', lateAfterMs(6 * 3_600_000), 12 * 3_600_000);

  const fresh = gradeJob('sync-prices', run({ startedAt: minutesAgo(4) }), NOW) as Check;
  eq('4m into a 5m cadence → ok', fresh.status, 'ok');

  const oneMissed = gradeJob('sync-prices', run({ startedAt: minutesAgo(7) }), NOW) as Check;
  eq('7m — one missed turn is not an outage', oneMissed.status, 'ok');

  const late = gradeJob('sync-prices', run({ startedAt: minutesAgo(25) }), NOW) as Check;
  eq('25m → warn', late.status, 'warn');
}

console.log('\nA row stuck in "running" is a hang, but only after it is late');
{
  const inFlight = gradeJob('sync-prices', run({ status: 'running', finishedAt: null }), NOW) as Check;
  eq('running now → ok', inFlight.status, 'ok');

  const hung = gradeJob(
    'sync-prices',
    run({ status: 'running', finishedAt: null, startedAt: minutesAgo(90) }),
    NOW
  ) as Check;
  eq('running for 90m on a 5m job → fail', hung.status, 'fail');
  ok('named as never finishing', hung.detail.includes('never finished'), hung.detail);
}

console.log('\nEvery registered job can be graded');
{
  // A job added to the registry without a health story would otherwise go
  // unnoticed until someone read this page looking for it.
  for (const name of Object.keys(JOBS)) {
    const c = gradeJob(name as keyof typeof JOBS, undefined, NOW) as Check;
    ok(`${name} grades`, c.status === 'fail' && c.id === `job-${name}`);
  }
}

console.log('\nThe catalogue check distinguishes empty from unpriced');
{
  eq('no items → fail', (gradeCatalogue({ items: 0, priced: 0 }) as Check).status, 'fail');
  const unpriced = gradeCatalogue({ items: 4000, priced: 0 }) as Check;
  eq('items but no prices → fail', unpriced.status, 'fail');
  ok('and blames the poller, not the catalogue', (unpriced.command ?? '').includes('sync-prices'));
  eq('both present → ok', (gradeCatalogue({ items: 4000, priced: 3800 }) as Check).status, 'ok');
}

console.log('\nMoney makers: all-unresolved is worse than some');
{
  eq(
    'nothing failed → ok',
    (gradeMethods({ total: 28, failedMethods: 0, names: [] }) as Check).status,
    'ok'
  );

  const some = gradeMethods({ total: 28, failedMethods: 1, names: ['Ranarr weed'] }) as Check;
  eq('one bad name → warn', some.status, 'warn');

  // The live scenario: /money renders "Nothing you can run", which reads
  // like a correct answer. It is not one.
  const all = gradeMethods({
    total: 3,
    failedMethods: 3,
    names: ['Ranarr weed', 'Vial of water', 'Snapdragon'],
  }) as Check;
  eq('every method unresolved → fail', all.status, 'fail');
  ok('says the page shows nothing', all.detail.includes('/money'), all.detail);
  ok('names the offending items', all.detail.includes('Ranarr weed'), all.detail);
  ok('points at the file to fix', (all.fix ?? '').includes('method-data.ts'));

  // Item names are not methods. One method has several inputs, so there are
  // always more unresolved NAMES than dropped METHODS — and reporting the
  // name count as a method count printed "57 of 28 methods dropped" on the
  // first real run of this page.
  const counts = gradeMethods({
    total: 28,
    failedMethods: 20,
    names: ['Guam leaf', 'Vial of water', 'Marrentill', 'Harralander', 'Snapdragon'],
  }) as Check;
  ok('method count is the method count', counts.detail.includes('20 of 28 methods'), counts.detail);
  ok('and the names are counted separately', counts.detail.includes('5 unresolved item names'), counts.detail);
  ok('never claims more dropped than exist', !counts.detail.includes('of 28 methods dropped, from 28'));

  // Long lists get truncated rather than filling the page.
  const many = gradeMethods({
    total: 28,
    failedMethods: 7,
    names: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
  }) as Check;
  ok('long lists are truncated', many.detail.includes('+3 more'), many.detail);

  // Singular, because "1 unresolved item names" on a status page is the
  // kind of thing that makes people doubt the rest of it.
  const one = gradeMethods({ total: 28, failedMethods: 1, names: ['Guam leaf'] }) as Check;
  ok('one name reads as singular', one.detail.includes('1 unresolved item name:'), one.detail);
}

console.log('\nWiki: ran-but-wrote-nothing is a failure, not patience');
{
  // This is the bug that actually happened and hid for days.
  const silent = gradeWiki({ described: 0, missing: 0, attempted: 0, items: 4000, everRan: true }) as Check;
  eq('ran, wrote nothing → fail', silent.status, 'fail');
  ok('names it as silent rather than slow', silent.detail.includes('never written'), silent.detail);

  const neverRan = gradeWiki({ described: 0, missing: 0, attempted: 0, items: 4000, everRan: false }) as Check;
  eq('never ran → fail', neverRan.status, 'fail');

  // Partial progress is the normal state for a job that trickles.
  const partial = gradeWiki({ described: 61, missing: 4, attempted: 65, items: 4000, everRan: true }) as Check;
  eq('65 of 4000 done → ok, it trickles by design', partial.status, 'ok');
  ok('reports the described count', partial.detail.includes('61'), partial.detail);

  // Writing rows where every single lookup misses means the matching is
  // wrong, which is different from the fetch being broken.
  const allMissing = gradeWiki({ described: 0, missing: 80, attempted: 80, items: 4000, everRan: true }) as Check;
  eq('rows written but none matched → warn', allMissing.status, 'warn');
}

console.log('\nHistory is measured in items the statistics can speak about');
{
  eq('no bars → fail', (gradeHistory({ itemsWithEnough: 0, priced: 100, days: 0 }) as Check).status, 'fail');

  // Bars exist but no item has reached the sample floor: normal on a new
  // install, so a warning rather than a failure.
  const young = gradeHistory({ itemsWithEnough: 0, priced: 3800, days: 4 }) as Check;
  eq('4 days, nothing qualifies yet → warn', young.status, 'warn');
  ok('mentions the sample floor', young.detail.includes(String(MIN_SAMPLE_DAYS)), young.detail);

  const good = gradeHistory({ itemsWithEnough: 900, priced: 3800, days: 94 }) as Check;
  eq('900 qualifying items → ok', good.status, 'ok');
  ok('reports a percentage of priced items', good.detail.includes('24%'), good.detail);
}

console.log('\nAlerts with no email key is the worst combination');
{
  // Alerts set and no way to send them: they fire into the log and the
  // owner concludes the market was quiet.
  const broken = gradeAlerts({ active: 12, emailConfigured: false }) as Check;
  eq('alerts set, no key → fail', broken.status, 'fail');
  ok('says they reach nobody', broken.detail.includes('reach nobody'), broken.detail);
  ok('names the variable', (broken.fix ?? '').includes('RESEND_API_KEY'));

  const notYet = gradeAlerts({ active: 0, emailConfigured: false }) as Check;
  eq('no alerts, no key → warn', notYet.status, 'warn');

  eq('all good → ok', (gradeAlerts({ active: 12, emailConfigured: true }) as Check).status, 'ok');

  // Singular/plural, because "1 active alerts" on a status page undermines
  // everything else it says.
  const one = gradeAlerts({ active: 1, emailConfigured: true }) as Check;
  ok('1 alert reads as singular', one.detail.includes('1 active alert,'), one.detail);
}

console.log('\nThe worst status wins, and unknown is not a pass');
{
  const c = (status: string) => ({ id: status, title: status, status, detail: '' }) as Check;
  eq('all ok', overallStatus([c('ok'), c('ok')] as never), 'ok');
  eq('one warn', overallStatus([c('ok'), c('warn')] as never), 'warn');
  eq('warn and fail → fail', overallStatus([c('warn'), c('fail')] as never), 'fail');
  // The important one: unknown outranks ok, so a page that could not check
  // something never claims everything is fine.
  eq('unknown beats ok', overallStatus([c('ok'), c('unknown')] as never), 'unknown');
  eq('but warn beats unknown', overallStatus([c('unknown'), c('warn')] as never), 'warn');
  eq('empty is ok', overallStatus([]), 'ok');

  eq(
    'tally',
    countByStatus([c('ok'), c('ok'), c('fail')] as never),
    { ok: 2, warn: 0, fail: 1, unknown: 0 }
  );
}

console.log('\nError messages are trimmed for a browser, not a terminal');
{
  eq('an Error becomes its message', errorMessage(new Error('boom')), 'boom');
  eq('a string passes through', errorMessage('plain'), 'plain');
  ok('newlines are flattened', !errorMessage(new Error('a\n  b')).includes('\n'));
  eq('flattened to single spaces', errorMessage(new Error('a\n  b')), 'a b');

  const long = errorMessage(new Error('x'.repeat(900)));
  ok('long messages are truncated', long.length <= 400, String(long.length));
  ok('and marked as truncated', long.endsWith('…'));

  // Must not throw on the odd shapes a rejected promise can carry.
  ok('null does not throw', typeof errorMessage(null) === 'string');
  ok('undefined does not throw', typeof errorMessage(undefined) === 'string');
  ok('an object does not throw', typeof errorMessage({ code: 500 }) === 'string');
}

console.log('\nA percentage never rounds up to a completeness it has not got');
{
  // 803 of 804 is 99.87%. Printing "100%" there is a small lie in the one
  // place on the site that is supposed to be literal.
  eq('803 of 804 is 99, not 100', percent(803, 804), 99);
  eq('800 of 803 is 99', percent(800, 803), 99);
  eq('only exactly complete is 100', percent(804, 804), 100);
  eq('and over-complete clamps to 100', percent(900, 804), 100);
  eq('half is half', percent(50, 100), 50);
  eq('nothing of nothing is 0, not NaN', percent(0, 0), 0);
  eq('nothing of something is 0', percent(0, 500), 0);
}

console.log('\nDurations read as a person says them');
{
  eq('seconds', humanMs(4_000), '4s');
  eq('minutes', humanMs(5 * 60_000), '5m');
  eq('hours', humanMs(4 * 3_600_000), '4h');
  eq('days', humanMs(3 * 86_400_000), '3d');
  eq('negative is unknown, not "-1s"', humanMs(-1), 'unknown');
  eq('NaN is unknown', humanMs(NaN), 'unknown');
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
