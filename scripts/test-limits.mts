/**
 * Buy-limit capacity.
 *
 * The case that matters is the wiki's own worked example, because it is the
 * one a rolling-window implementation gets wrong: buy 60 at 12:00 and 40 at
 * 14:00, and the WHOLE limit returns at 16:00 — not 60 at 16:00 and 40 at
 * 18:00. There is an explicit test below asserting the rolling answer is NOT
 * what comes out.
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

const { limitStatus, buyWindows, formatResetIn, BUY_LIMIT_WINDOW_MS } = await import(
  '@/lib/osrs/limits'
);

const WHIP = 4151;
const RUNE = 560;

/** 2026-01-01, at the given hour and minute, local. */
const at = (h: number, m = 0) => new Date(2026, 0, 1, h, m, 0, 0);
const buy = (quantity: number, when: Date, itemId = WHIP) =>
  ({ itemId, side: 'buy' as const, quantity, executedAt: when });
const sell = (quantity: number, when: Date, itemId = WHIP) =>
  ({ itemId, side: 'sell' as const, quantity, executedAt: when });

console.log('--- the window is four hours ---');
eq('as milliseconds', BUY_LIMIT_WINDOW_MS, 4 * 60 * 60 * 1000);

console.log('--- nothing bought means the whole limit is available ---');
{
  const s = limitStatus(WHIP, 100, [], at(12));
  eq('nothing used', s.used, 0);
  eq('all of it remaining', s.remaining, 100);
  eq('no window is open', s.resetsAt, null);
  eq('and nothing to count down', s.resetsInMs, null);
  ok('not exhausted', s.exhausted === false);
}

console.log('--- one buy opens a window ---');
{
  const s = limitStatus(WHIP, 100, [buy(60, at(12))], at(13));
  eq('60 used', s.used, 60);
  eq('40 left', s.remaining, 40);
  eq('resets four hours after the FIRST buy', s.resetsAt?.getTime(), at(16).getTime());
  eq('three hours to go', s.resetsInMs, 3 * 60 * 60 * 1000);
}

console.log("--- the wiki's worked example: 60 at 12:00, 40 at 14:00 ---");
{
  const trades = [buy(60, at(12)), buy(40, at(14))];

  const during = limitStatus(WHIP, 100, trades, at(15));
  eq('both buys counted', during.used, 100);
  eq('nothing left', during.remaining, 0);
  ok('exhausted', during.exhausted);
  eq('still resets at 16:00, not 18:00', during.resetsAt?.getTime(), at(16).getTime());

  // The second buy must NOT extend or restart the window.
  ok(
    'the 14:00 buy did not push the reset out',
    during.resetsAt!.getTime() !== at(18).getTime(),
    'a restarting timer would say 18:00'
  );

  const after = limitStatus(WHIP, 100, trades, at(16, 1));
  eq('the WHOLE limit is back at 16:00', after.remaining, 100);
  eq('not just the first 60', after.used, 0);
  ok('and no window is open', after.resetsAt === null);

  // This is the rolling-window answer, and it is the wrong one. At 16:01 a
  // rolling implementation still counts the 40 bought at 14:00.
  ok(
    'a rolling window would wrongly report 60 remaining',
    after.remaining !== 60,
    'fixed window resets everything at once'
  );
}

console.log('--- a buy after the reset opens a fresh window ---');
{
  const trades = [buy(60, at(12)), buy(40, at(14)), buy(25, at(16, 30))];
  const s = limitStatus(WHIP, 100, trades, at(17));
  eq('only the new buy counts', s.used, 25);
  eq('75 left', s.remaining, 75);
  eq('the new window ends at 20:30', s.resetsAt?.getTime(), at(20, 30).getTime());

  const windows = buyWindows(trades);
  eq('two windows in total', windows.length, 2);
  eq('the first held 100 units', windows[0].units, 100);
  eq('the second holds 25', windows[1].units, 25);
}

console.log('--- buying over the limit cannot go negative ---');
{
  // The game would not permit this, but a mistyped fill can.
  const s = limitStatus(WHIP, 100, [buy(140, at(12))], at(13));
  eq('used is what was recorded', s.used, 140);
  eq('remaining floors at zero', s.remaining, 0);
  ok('and it reads as exhausted', s.exhausted);
}

console.log('--- sells never consume buying capacity ---');
{
  const s = limitStatus(WHIP, 100, [sell(500, at(12)), sell(200, at(13))], at(13, 30));
  eq('nothing used', s.used, 0);
  eq('full limit', s.remaining, 100);
  ok('no window opened', s.resetsAt === null);
}

console.log('--- an unpublished limit stays unknown rather than guessed ---');
{
  const s = limitStatus(WHIP, null, [buy(60, at(12))], at(13));
  eq('we still know what was bought', s.used, 60);
  eq('but not what is left', s.remaining, null);
  ok('and it is never reported as exhausted', s.exhausted === false);
  ok('while the window is still tracked', s.resetsAt?.getTime() === at(16).getTime());
}

console.log('--- items do not contaminate each other ---');
{
  const trades = [buy(60, at(12), WHIP), buy(9000, at(12, 30), RUNE)];
  eq('whip counts only whips', limitStatus(WHIP, 100, trades, at(13)).used, 60);
  eq('runes count only runes', limitStatus(RUNE, 12000, trades, at(13)).used, 9000);
  eq('and runes have their own headroom', limitStatus(RUNE, 12000, trades, at(13)).remaining, 3000);
}

console.log('--- input order does not change the answer ---');
{
  const forwards = [buy(60, at(12)), buy(40, at(14))];
  const backwards = [buy(40, at(14)), buy(60, at(12))];
  eq(
    'same window either way',
    limitStatus(WHIP, 100, backwards, at(15)).resetsAt?.getTime(),
    limitStatus(WHIP, 100, forwards, at(15)).resetsAt?.getTime()
  );
  eq('same usage', limitStatus(WHIP, 100, backwards, at(15)).used, 100);
}

console.log('--- the boundary is exclusive at exactly four hours ---');
{
  // A buy at exactly 16:00 belongs to the NEXT window, not the one closing.
  const s = limitStatus(WHIP, 100, [buy(60, at(12)), buy(10, at(16))], at(16, 5));
  eq('only the 16:00 buy counts', s.used, 10);
  eq('and it opened a window to 20:00', s.resetsAt?.getTime(), at(20).getTime());
}

console.log('--- countdown formatting ---');
{
  eq('hours and minutes', formatResetIn(72 * 60_000), '1h 12m');
  eq('whole hours drop the minutes', formatResetIn(120 * 60_000), '2h');
  eq('under an hour', formatResetIn(48 * 60_000), '48m');
  eq('seconds round down to a phrase', formatResetIn(30_000), 'under a minute');
  eq('nothing to show', formatResetIn(null), null);
  eq('elapsed is nothing to show', formatResetIn(-5), null);
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
