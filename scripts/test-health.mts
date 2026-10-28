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
  summariseResult,
  LATE_FLOOR_MS,
} = await import('@/lib/osrs/health');
const { JOBS } = await import('@/lib/osrs/jobs');
const { errorMessage } = await import('@/lib/osrs/jobs/record');
const { MIN_SAMPLE_DAYS } = await import('@/lib/osrs/stats');
const { safeInt, safeDate, INT4_MAX, INT4_MIN } = await import('@/lib/osrs/jobs/util');

type Check = { id: string; title: string; status: string; detail: string; fix?: string; command?: string };
type JobRun = {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  error: string | null;
  durationMs: number | null;
  result: unknown;
  failingSince?: Date | null;
  consecutiveFailures?: number;
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

console.log('\nNot yet due is not the same as never run');
{
  // The run log starts empty on the release that introduces it, so a job on
  // a 24-hour cadence has nothing in it for a day. Grading that as broken
  // made three of the six red lines on the first real deploy false alarms
  // of this page's own making.
  const HOUR = 3_600_000;
  const young = gradeJob('sync-items', undefined, NOW, HOUR) as Check;
  eq('24h job, 1h-old log → unknown, not fail', young.status, 'unknown');
  ok('says it has not come round yet', young.detail.includes('only been collecting'), young.detail);
  ok('and offers no alarming command', young.command === undefined);

  // Once the log is older than the cadence, silence IS evidence.
  const overdue = gradeJob('sync-items', undefined, NOW, 30 * HOUR) as Check;
  eq('24h job, 30h-old log → fail', overdue.status, 'fail');
  ok('and says why that is now conclusive', overdue.detail.includes('longer than its'), overdue.detail);

  // The 5-minute poller gets no such grace after an hour.
  const poller = gradeJob('sync-prices', undefined, NOW, HOUR) as Check;
  eq('5m job, 1h-old log → fail', poller.status, 'fail');

  // With no log at all there is nothing to reason from, so the old
  // behaviour stands.
  const noLog = gradeJob('sync-items', undefined, NOW, null) as Check;
  eq('no log at all → fail', noLog.status, 'fail');
}

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

console.log('\nA repeated failure is reported differently from a first one');
{
  const once = gradeJob(
    'sync-prices',
    run({ status: 'failed', error: 'value out of range [22003]', consecutiveFailures: 1 }),
    NOW
  ) as Check;
  eq('one failure → fail', once.status, 'fail');
  ok('no streak claimed', !once.detail.includes('in a row'), once.detail);
  ok('and the fix says it may clear itself', (once.fix ?? '').includes('next run succeeds'), once.fix);

  // The question "is this new, or has it been broken all week?" is the one
  // you actually want answered, and the timestamp alone cannot answer it.
  const many = gradeJob(
    'sync-prices',
    run({
      status: 'failed',
      error: 'value out of range [22003]',
      consecutiveFailures: 61,
      failingSince: new Date(NOW.getTime() - 5 * 3_600_000),
    }),
    NOW
  ) as Check;
  ok('a streak is reported', many.detail.includes('61 runs in a row'), many.detail);
  ok('separated from the error text', many.detail.includes('\u2014 failing for'), many.detail);
  ok('with how long it has been going', many.detail.includes('5h'), many.detail);
  ok('and the fix says nothing is updating', (many.fix ?? '').includes('nothing it writes'), many.fix);

  // Without a start time there is no honest duration to quote, so none is.
  const noSince = gradeJob(
    'sync-prices',
    run({ status: 'failed', error: 'x', consecutiveFailures: 9, failingSince: null }),
    NOW
  ) as Check;
  ok('no invented duration', !noSince.detail.includes('in a row'), noSince.detail);
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

console.log('\nThe error reported is the database\u2019s, not the SQL that caused it');
{
  // Drizzle puts the whole failing statement in `message` and the real
  // complaint in `cause`. Taking `message` is what put 400 characters of
  // "insert into osrs_prices ($1, $2, $3…)" on the health page and none of
  // the reason. All three of these produce an identical `message`.
  const drizzleLike = (cause: Record<string, unknown>) => {
    const e = new Error('Failed query: insert into "osrs_prices" ("item_id", "high") values ($1, $2), ($3, $4)');
    (e as unknown as { cause: unknown }).cause = cause;
    return e;
  };

  const overflow = errorMessage(
    drizzleLike({ message: 'value "3000000000" is out of range for type integer', code: '22003' })
  );
  ok('reports the overflow, not the insert', overflow.startsWith('value "3000000000"'), overflow);
  ok('and carries the code', overflow.includes('[22003]'), overflow);
  ok('and drops the SQL entirely', !overflow.includes('insert into'), overflow);

  const fk = errorMessage(
    drizzleLike({
      message: 'insert or update on table "osrs_prices" violates foreign key constraint "osrs_prices_item_id_fkey"',
      detail: 'Key (item_id)=(99999999) is not present in table "osrs_items".',
      constraint: 'osrs_prices_item_id_fkey',
      code: '23503',
    })
  );
  ok('a constraint violation names the offending value', fk.includes('(item_id)=(99999999)'), fk);
  ok('and does not repeat the constraint name twice', fk.split('osrs_prices_item_id_fkey').length === 2, fk);

  // The cause may itself be wrapped.
  const nested = new Error('outer');
  (nested as unknown as { cause: unknown }).cause = drizzleLike({ message: 'deep cause', code: '42P01' });
  ok('walks a nested cause chain', errorMessage(nested).startsWith('deep cause'), errorMessage(nested));

  // A chain that loops must not hang the worker.
  const a = new Error('a'); const b = new Error('b');
  (a as unknown as { cause: unknown }).cause = b;
  (b as unknown as { cause: unknown }).cause = a;
  ok('a circular cause chain terminates', typeof errorMessage(a) === 'string');
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

console.log('\nAn OK row shows what the job actually wrote');
{
  // "It ran" and "it did something" are different claims, and this page
  // exists because of the gap between them.
  eq('numbers are summarised', summariseResult({ prices: 4012, volumes: 3890 }), '4,012 prices, 3,890 volumes');
  // A zero is the most interesting value here, not the least — it is a job
  // succeeding while doing nothing, which is the failure this page hunts.
  eq('a zero is kept', summariseResult({ fetched: 0 }), '0 fetched');
  eq('camelCase reads as words', summariseResult({ unknownItems: 3 }), '3 unknown items');
  eq('snake_case too', summariseResult({ job_runs: 5 }), '5 job runs');
  eq('non-numbers are skipped', summariseResult({ skipped: true, reason: 'x', bars: 7 }), '7 bars');
  eq('capped at three', summariseResult({ a: 1, b: 2, c: 3, d: 4 }), '1 a, 2 b, 3 c');
  eq('nothing numeric → null', summariseResult({ skipped: true }), null);
  eq('null result → null', summariseResult(null), null);
  eq('a non-object → null', summariseResult('text'), null);
  eq('an array → null', summariseResult([1, 2]), null);
  eq('NaN is skipped', summariseResult({ n: NaN, m: 2 }), '2 m');

  const c = gradeJob('sync-prices', run({ result: { prices: 4012 }, startedAt: minutesAgo(2) }), NOW) as Check;
  ok('and it reaches the row', c.detail.includes('Wrote 4,012 prices'), c.detail);
}

console.log('\nOne bad value must not take down four thousand good ones');
{
  // high/low are int4. Before safeInt, a single out-of-range price aborted
  // the whole 1,000-row batch, which meant the price poll died for every
  // item on the site because of one of them.
  eq('an ordinary price passes through', safeInt(1_234_567), 1_234_567);
  eq('the int4 ceiling is allowed', safeInt(INT4_MAX), INT4_MAX);
  eq('the int4 floor is allowed', safeInt(INT4_MIN), INT4_MIN);
  eq('one over the ceiling becomes unknown', safeInt(INT4_MAX + 1), null);
  eq('a wildly large value becomes unknown', safeInt(3_000_000_000), null);
  eq('one under the floor becomes unknown', safeInt(INT4_MIN - 1), null);

  // Null means unknown and must stay unknown, not become zero: a free item
  // and an untraded one are completely different things to this app.
  eq('null stays null', safeInt(null), null);
  eq('undefined stays null', safeInt(undefined), null);
  eq('zero is a real value, not nothing', safeInt(0), 0);

  eq('NaN becomes unknown', safeInt(NaN), null);
  eq('Infinity becomes unknown', safeInt(Infinity), null);
  eq('a fraction is truncated', safeInt(10.9), 10);

  // Clamping would be worse than nulling: 2,147,483,647 is a plausible-looking
  // price that someone would flip against.
  ok('out of range is NOT clamped to the max', safeInt(5_000_000_000) !== INT4_MAX);

  // Timestamps abort a statement the same way an integer does.
  const ok2026 = new Date('2026-10-27T12:00:00Z');
  eq('a real date passes through', safeDate(ok2026)?.toISOString(), ok2026.toISOString());
  eq('an invalid date becomes null', safeDate(new Date('nonsense')), null);
  eq('a date past the horizon becomes null', safeDate(new Date('9999-01-01T00:00:00Z')), null);
  eq('the epoch becomes null', safeDate(new Date(0)), null);
  eq('null stays null', safeDate(null), null);
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
