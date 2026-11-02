/**
 * The dashboard's judgement.
 *
 * The thing being tested is restraint. A dashboard that always has
 * something urgent to show is lying, and the tests that matter here are the
 * ones asserting it stays QUIET: a position a couple of percent down is
 * noise, a fat margin on a thin book is a trap, and an empty page is a
 * legitimate answer.
 */

const {
  positionAttention,
  dataAttention,
  bestFlip,
  capitalShare,
  standing,
  greeting,
  DRIFT_WARN_PCT,
  STALE_POSITION_DAYS,
} = await import('@/lib/osrs/dashboard');

type Attention = { id: string; level: string; title: string; detail: string; href: string };

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

const NOW = new Date('2026-11-01T22:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const pos = (over: Partial<Record<string, unknown>> = {}) =>
  ({
    itemId: 1,
    itemName: 'Abyssal whip',
    quantity: 10,
    avgCost: 1_000_000,
    costBasis: 10_000_000,
    oldestOpenedAt: daysAgo(1),
    mark: 1_020_000,
    marketValue: 10_200_000,
    unrealised: 196_000,
    unrealisedPct: 1.96,
    ...over,
  }) as never;

console.log('\nA position barely down is not news');
{
  // The spread alone puts a flip under water the moment it opens. Flagging
  // that would put a warning on every position on the page, every time.
  eq('1% down → nothing', positionAttention([pos({ unrealisedPct: -1 })], NOW).length, 0);
  eq('5% down → still nothing', positionAttention([pos({ unrealisedPct: -5 })], NOW).length, 0);
  eq('up → certainly nothing', positionAttention([pos({ unrealisedPct: 12 })], NOW).length, 0);

  const bad = positionAttention([pos({ unrealisedPct: -14, unrealised: -1_400_000 })], NOW) as Attention[];
  eq('14% down → one warning', bad.length, 1);
  eq('and it is a warning, not a note', bad[0].level, 'warn');
  ok('naming the item', bad[0].title.includes('Abyssal whip'), bad[0].title);
  ok('and the figure, unsigned', bad[0].title.includes('14.0%'), bad[0].title);
  ok('no double negative in the title', !bad[0].title.includes('-14'), bad[0].title);
  // "would clear -940" is not a sentence anyone says.
  ok('a loss is phrased as a loss', bad[0].detail.includes('down on a cost of'), bad[0].detail);
  ok('and carries no minus sign', !bad[0].detail.includes('-1,400,000'), bad[0].detail);

  // Exactly on the line counts, so the threshold is not off by one.
  eq(
    'exactly at the threshold warns',
    positionAttention([pos({ unrealisedPct: DRIFT_WARN_PCT })], NOW).length,
    1
  );
}

console.log('\nAn unpriced position is reported, not skipped');
{
  // The tempting thing is to ignore what cannot be valued. An item with no
  // price is exactly the one you can get stranded in, and silence about it
  // reads as "fine".
  const a = positionAttention(
    [pos({ mark: null, marketValue: null, unrealised: null, unrealisedPct: null })],
    NOW
  ) as Attention[];
  eq('it gets a line', a.length, 1);
  ok('saying the value is unknown', a[0].title.includes('no current price'), a[0].title);
  eq('as information, not alarm', a[0].level, 'info');
}

console.log('\nA position sitting for a week is capital doing nothing');
{
  eq('6 days → quiet', positionAttention([pos({ oldestOpenedAt: daysAgo(6) })], NOW).length, 0);
  const old = positionAttention([pos({ oldestOpenedAt: daysAgo(9) })], NOW) as Attention[];
  eq('9 days → mentioned', old.length, 1);
  ok('with the age', old[0].title.includes('9 days'), old[0].title);
  eq(
    'exactly at the threshold counts',
    positionAttention([pos({ oldestOpenedAt: daysAgo(STALE_POSITION_DAYS) })], NOW).length,
    1
  );

  // A position that is BOTH under water and old gets one line, not two:
  // the drift is the bigger problem and two cards about one item is noise.
  const both = positionAttention(
    [pos({ unrealisedPct: -20, unrealised: -2_000_000, oldestOpenedAt: daysAgo(30) })],
    NOW
  ) as Attention[];
  eq('one line, not two', both.length, 1);
  eq('and it is the drift', both[0].level, 'warn');
}

console.log('\nProblems sort above notes');
{
  const mixed = positionAttention(
    [
      pos({ itemId: 2, itemName: 'Bond', oldestOpenedAt: daysAgo(40) }),
      pos({ itemId: 3, itemName: 'Rune scimitar', unrealisedPct: -30, unrealised: -9 }),
    ],
    NOW
  ) as Attention[];
  eq('two lines', mixed.length, 2);
  eq('warning first', mixed[0].level, 'warn');
  eq('note second', mixed[1].level, 'info');
}

console.log('\nNothing wrong means nothing shown');
{
  eq('no positions → silence', positionAttention([], NOW), []);
  eq('healthy positions → silence', positionAttention([pos(), pos({ itemId: 9 })], NOW), []);
  eq('a fresh account with hiscores → silence', dataAttention({ hiscoresAgeDays: 1, hasAccount: true }), []);
}

console.log('\nMissing groundwork is said once, not repeatedly');
{
  const none = dataAttention({ hiscoresAgeDays: null, hasAccount: false }) as Attention[];
  eq('no account → one line', none.length, 1);
  ok('pointing at accounts', none[0].href === '/accounts');

  const stale = dataAttention({ hiscoresAgeDays: 20, hasAccount: true }) as Attention[];
  eq('stale hiscores → one line', stale.length, 1);
  ok('with the age', stale[0].title.includes('20 days'), stale[0].title);

  // With no account at all, "your hiscores are old" is not the useful
  // sentence — it must not pile both on.
  const neither = dataAttention({ hiscoresAgeDays: 999, hasAccount: false }) as Attention[];
  eq('no account wins over stale', neither.length, 1);
  eq('and it is the account one', neither[0].id, 'no-account');
}

console.log('\nThe best flip is the best one you can fund, and can trust');
{
  const flip = (over: Record<string, unknown> = {}) =>
    ({
      itemId: 1,
      name: 'Item',
      buyPrice: 100,
      sellPrice: 110,
      marginPerUnit: 8,
      roiPercent: 8,
      unitsPerWindow: 100,
      profitPerWindow: 800,
      capitalRequired: 10_000,
      buyLimit: 100,
      hourlyVolume: 5_000,
      stalenessMinutes: 2,
      confidence: 'good',
      ...over,
    }) as never;

  // Biggest profit per window wins, not biggest margin per unit.
  const picked = bestFlip([
    flip({ itemId: 1, profitPerWindow: 800 }),
    flip({ itemId: 2, profitPerWindow: 5_000 }),
    flip({ itemId: 3, profitPerWindow: 1_200 }),
  ]) as { itemId: number } | null;
  eq('the most profitable is picked', picked?.itemId, 2);

  // A margin you cannot fund is not an opportunity.
  eq(
    'nothing affordable → null',
    bestFlip([flip({ unitsPerWindow: 0, profitPerWindow: 50_000 })]),
    null
  );

  // A fat margin on a thin or stale book is the single most misleading
  // thing this page could lead with.
  eq('thin books are refused', bestFlip([flip({ confidence: 'thin', profitPerWindow: 99_999 })]), null);
  eq('stale books are refused', bestFlip([flip({ confidence: 'stale', profitPerWindow: 99_999 })]), null);
  eq('unknown books are refused', bestFlip([flip({ confidence: 'unknown', profitPerWindow: 99_999 })]), null);

  const mixed = bestFlip([
    flip({ itemId: 7, confidence: 'thin', profitPerWindow: 99_999 }),
    flip({ itemId: 8, confidence: 'good', profitPerWindow: 10 }),
  ]) as { itemId: number } | null;
  eq('a trustworthy small one beats a huge trap', mixed?.itemId, 8);

  eq('an empty market → null', bestFlip([]), null);
  eq('a losing flip is not offered', bestFlip([flip({ profitPerWindow: -5 })]), null);
  eq('a zero-profit flip is not offered', bestFlip([flip({ profitPerWindow: 0 })]), null);
}

console.log('\nCapital share');
{
  eq('half your stack', capitalShare(500_000, 1_000_000), 50);
  eq('all of it', capitalShare(1_000_000, 1_000_000), 100);
  eq('capped, never 150%', capitalShare(1_500_000, 1_000_000), 100);
  eq('no stack → unknown rather than divide by zero', capitalShare(100, 0), null);
}

console.log('\nStanding refuses to quote a total it cannot stand behind');
{
  const empty = standing([], 5_000_000);
  eq('no positions: the total is the cash', empty.total, 5_000_000);
  eq('and the book is zero, not unknown', empty.openValue, 0);

  const good = standing([pos(), pos({ itemId: 2, costBasis: 2_000_000, marketValue: 2_100_000, unrealised: 50_000 })], 5_000_000);
  eq('two positions counted', good.positionCount, 2);
  eq('unrealised summed', good.openUnrealised, 246_000);
  // 5m cash + 12m sunk + 246k gain
  eq('total is cash plus book', good.total, 17_246_000);

  // One unmarkable position makes the whole total unknown rather than
  // quietly short. A number missing a chunk still reads as complete.
  const partial = standing(
    [pos(), pos({ itemId: 2, mark: null, marketValue: null, unrealised: null, unrealisedPct: null })],
    5_000_000
  );
  eq('an unmarkable position makes the total unknown', partial.total, null);
  eq('and the book value too', partial.openValue, null);
  eq('but the count is still honest', partial.positionCount, 2);
  eq('and the cash is still known', partial.cashStack, 5_000_000);
}

console.log('\nGreetings that are not lies at 3am');
{
  eq('3am', greeting(3), 'Still up');
  eq('9am', greeting(9), 'Morning');
  eq('2pm', greeting(14), 'Afternoon');
  eq('8pm', greeting(20), 'Evening');
  eq('midnight', greeting(0), 'Still up');
  eq('nonsense is neutral', greeting(99), 'Hello');
  eq('NaN is neutral', greeting(NaN), 'Hello');
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
