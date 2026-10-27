#!/usr/bin/env node
/*
 * Tests for the OSRS calculation modules.
 *
 * These exist because every number the app shows is derived from two things:
 * the XP curve and the GE tax rule. If either is wrong, every figure on every
 * screen is wrong and it would not be obvious from looking — a slightly wrong
 * tax produces plausible numbers that quietly lose money.
 *
 * Run: npm run test:osrs
 */
import {
  xpForLevel,
  levelFromXp,
  xpToNextLevel,
  levelProgress,
  project,
  ratePerHour,
  formatXp,
  XP_AT_99,
} from '../src/lib/osrs/xp.ts';
import {
  SKILLS,
  parseHiscores,
  combatLevel,
  normaliseRsn,
  rsnToQuery,
  HITPOINTS_MINIMUM,
} from '../src/lib/osrs/skills.ts';
import {
  geTax,
  marginPerUnit,
  roiPercent,
  breakevenSellPrice,
  evaluate,
  flipProfit,
  confidenceOf,
  formatGp,
  parseGp,
} from '../src/lib/osrs/ge.ts';

let failures = 0;
let checks = 0;

function eq(label, got, want) {
  checks++;
  const ok = got === want;
  if (!ok) {
    failures++;
    console.error(`  FAIL ${label}: got ${got}, want ${want}`);
  }
}

function assert(label, condition, detail = '') {
  checks++;
  if (!condition) {
    failures++;
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name) {
  console.log(name);
}

// ---------------------------------------------------------------- XP curve
section('XP curve');
// These five pin Jagex's formula. Level 92 being half of 99 is the well-known
// milestone and a good independent check.
eq('level 2', xpForLevel(2), 83);
eq('level 10', xpForLevel(10), 1154);
eq('level 50', xpForLevel(50), 101333);
eq('level 92', xpForLevel(92), 6517253);
eq('level 99', xpForLevel(99), 13034431);
eq('XP_AT_99 agrees', XP_AT_99, 13034431);

eq('0 xp is level 1', levelFromXp(0), 1);
eq('82 xp is still level 1', levelFromXp(82), 1);
eq('83 xp is level 2', levelFromXp(83), 2);
eq('one xp short of 99', levelFromXp(13034430), 98);
eq('exactly 99', levelFromXp(13034431), 99);
eq('200m is still 99', levelFromXp(200000000), 99);

// Every level must round-trip: xp -> level -> same level.
for (let lvl = 1; lvl <= 99; lvl++) {
  assert(`round-trip level ${lvl}`, levelFromXp(xpForLevel(lvl)) === lvl);
}

eq('nothing left at 99', xpToNextLevel(13034431), 0);
eq('start of a level reads 0 progress', levelProgress(xpForLevel(50)), 0);
eq('99 is full', levelProgress(13034431), 1);

// --------------------------------------------------------------- Projection
section('Projection');
eq('already at target', project(xpForLevel(60), 60, 15000).hours, 0);
eq('no rate means no estimate', project(xpForLevel(57), 60, 0).eta, null);
assert('a real rate gives a real estimate', project(xpForLevel(57), 60, 15000).hours > 0);

// A five-minute window would imply an absurd hourly rate, so it is refused.
const t0 = new Date('2026-10-01T00:00:00Z');
const tShort = new Date('2026-10-01T00:05:00Z');
const tLong = new Date('2026-10-01T04:00:00Z');
eq('short window refused', ratePerHour(1000, t0, 5000, tShort), null);
eq('40k over four hours', ratePerHour(1000, t0, 41000, tLong), 10000);
eq('no xp gained', ratePerHour(1000, t0, 1000, tLong), 0);

// --------------------------------------------------------------- GE tax
section('GE tax');
// 2% of the sale, floored, nothing below 50 gp, never more than 5m per item.
eq('1 gp', geTax(1), 0);
eq('49 gp', geTax(49), 0);
eq('50 gp is the first taxed', geTax(50), 1);
eq('74 gp floors to 1', geTax(74), 1);
eq('99 gp', geTax(99), 1);
eq('100 gp', geTax(100), 2);
eq('1,000 gp', geTax(1000), 20);
eq('1m', geTax(1_000_000), 20_000);
eq('just under the cap', geTax(249_999_999), 4_999_999);
eq('cap reached at 250m', geTax(250_000_000), 5_000_000);
eq('beyond the cap', geTax(300_000_000), 5_000_000);

eq('bonds are exempt', geTax(8_000_000, 13190), 0);
eq('chisel is exempt', geTax(500, 1755), 0);
eq('an ordinary item at the same price is not', geTax(500, 4151), 10);

// --------------------------------------------------------------- Margins
section('Margins');
eq('buy 100 sell 120', marginPerUnit(100, 120), 18);
// The one that catches people out: a 1 gp spread on a 100 gp item is a LOSS,
// because the tax takes 2 gp off the sale.
eq('a 1 gp spread on 100 gp loses money', marginPerUnit(100, 101), -1);
eq('and on 1,000 gp it loses more', marginPerUnit(1000, 1010), -10);
assert('ROI of 1000 -> 1100 is 7.8%', Math.abs(roiPercent(1000, 1100) - 7.8) < 0.001);

// Breakeven must be exact: one gp below it always loses, at it always profits.
for (const buy of [60, 100, 500, 1000, 10_000, 150_000, 1_500_000, 50_000_000]) {
  const be = breakevenSellPrice(buy);
  assert(
    `breakeven exact at ${buy}`,
    marginPerUnit(buy, be) > 0 && marginPerUnit(buy, be - 1) <= 0,
    `breakeven ${be}`
  );
}
eq('below the tax threshold, one gp is enough', breakevenSellPrice(40), 41);

// ------------------------------------------------------- Capital awareness
section('Capital awareness');
const fresh = Math.floor(Date.now() / 1000) - 120;
const whip = {
  itemId: 4151,
  name: 'Abyssal whip',
  low: 1_500_000,
  high: 1_560_000,
  lowTime: fresh,
  highTime: fresh,
  buyLimit: 70,
  hourlyVolume: 400,
};
eq('a 500k stack cannot buy a 1.5m item', evaluate(whip, 500_000).unitsPerWindow, 0);
eq('so its profit is honestly zero', evaluate(whip, 500_000).profitPerWindow, 0);
eq('a 10m stack affords six', evaluate(whip, 10_000_000).unitsPerWindow, 6);

const runes = {
  itemId: 560,
  name: 'Death rune',
  low: 180,
  high: 190,
  lowTime: fresh,
  highTime: fresh,
  buyLimit: 10000,
  hourlyVolume: 2_000_000,
};
eq('with plenty of cash the buy limit binds', evaluate(runes, 100_000_000).unitsPerWindow, 10000);

// --------------------------------------------------------------- Confidence
section('Confidence');
eq('busy and fresh', confidenceOf(5000, 2, 100), 'good');
eq('too thin for the window needed', confidenceOf(50, 2, 100), 'thin');
eq('barely trades at all', confidenceOf(5, 2, 1), 'thin');
eq('hours since the last trade', confidenceOf(5000, 180, 10), 'stale');
eq('no volume', confidenceOf(0, 2, 10), 'stale');
eq('no timestamps to judge by', confidenceOf(5000, null, 10), 'unknown');

// A fat margin on something nobody trades must not look like an opportunity.
const trap = evaluate(
  {
    itemId: 99999,
    name: 'Illiquid item',
    low: 1_000_000,
    high: 1_400_000,
    lowTime: Math.floor(Date.now() / 1000) - 7200,
    highTime: fresh,
    buyLimit: 8,
    hourlyVolume: 1,
  },
  50_000_000
);
assert('a fat margin on a dead item is flagged', trap.confidence === 'stale');

// ------------------------------------------------------------------ Flips
section('Flips and formatting');
eq('realised profit on 100 whips', flipProfit(1_500_000, 1_560_000, 100, 4151), 2_880_000);

eq('billions', formatGp(2_147_000_000), '2.15B');
eq('millions', formatGp(1_250_000), '1.25M');
eq('hundreds of thousands', formatGp(250_000), '250K');
eq('tens of thousands', formatGp(15_500), '15.5K');
// Below 10K it stays exact, negative or not.
eq('small numbers stay exact', formatGp(5000), '5,000');
eq('and negatives too', formatGp(-5000), '-5,000');

eq('1.5m', parseGp('1.5m'), 1500000);
eq('250k', parseGp('250k'), 250000);
eq('commas', parseGp('1,000,000'), 1000000);
eq('billions', parseGp('2b'), 2000000000);
eq('plain', parseGp('500'), 500);
eq('empty', parseGp(''), null);
eq('nonsense', parseGp('abc'), null);

// ------------------------------------------------------------- Hiscores
section('Hiscores parsing');

// Build a response the way Jagex would, so the parser is tested against the
// real wire format rather than a convenient shape.
function buildCsv(levels, { skipSailing = false, activities = 5 } = {}) {
  const list = skipSailing ? SKILLS.filter((s) => s.key !== 'sailing') : SKILLS;
  const real = list.filter((s) => s.key !== 'overall');
  const total = real.reduce(
    (sum, s) => sum + (levels[s.key] ?? (s.key === 'hitpoints' ? 10 : 1)),
    0
  );
  const totalXp = real.reduce((sum, s) => sum + xpForLevel(levels[s.key] ?? 1), 0);
  const rows = [`100000,${total},${totalXp}`];
  for (const s of real) {
    const lvl = levels[s.key];
    rows.push(lvl && lvl > 1 ? `500000,${lvl},${xpForLevel(lvl)}` : '-1,-1,-1');
  }
  for (let i = 0; i < activities; i++) rows.push('-1,-1');
  return rows.join('\n');
}

const account = {
  magic: 57,
  ranged: 45,
  hitpoints: 39,
  defence: 38,
  attack: 31,
  strength: 31,
  firemaking: 29,
  woodcutting: 28,
  mining: 26,
  fletching: 23,
  prayer: 15,
  cooking: 15,
  fishing: 14,
  crafting: 9,
  smithing: 8,
};
const parsed = parseHiscores(buildCsv(account));
eq('Magic', parsed.skills.magic.level, 57);
eq('Ranged', parsed.skills.ranged.level, 45);
eq('Hitpoints', parsed.skills.hitpoints.level, 39);
eq('Defence', parsed.skills.defence.level, 38);
eq('Prayer', parsed.skills.prayer.level, 15);
eq('an untrained skill is level 1', parsed.skills.herblore.level, 1);
eq('unranked has no rank', parsed.skills.herblore.rank, null);
eq('xp matches the curve', parsed.skills.magic.xp, xpForLevel(57));
assert(
  'a clean parse warns about nothing',
  parsed.warnings.length === 0,
  parsed.warnings.join(' | ')
);

// The safety net. If our skill list ever drifts out of step with the live API,
// every stat would be attributed to the wrong skill and still look plausible —
// so a misalignment must be detected rather than trusted.
const rows = buildCsv(account).split('\n');
const misaligned = parseHiscores([rows[0], ...rows.slice(2)].join('\n'));
assert(
  'a shifted response is caught by the total-level check',
  misaligned.warnings.some((w) => w.includes('Total level mismatch'))
);

// Sailing's position in the response has not been verified against the live
// API, so the absence of it must degrade gracefully rather than corrupt.
const withoutSailing = parseHiscores(buildCsv(account, { skipSailing: true }));
assert('a missing trailing skill is flagged', withoutSailing.warnings.length > 0);
eq('earlier skills still parse correctly', withoutSailing.skills.magic.level, 57);

// Hitpoints never reads below 10, because no account can be below it.
eq(
  'unranked Hitpoints floors to 10',
  parseHiscores(buildCsv({})).skills.hitpoints.level,
  HITPOINTS_MINIMUM
);
eq('a fresh account is combat 3', combatLevel(parseHiscores(buildCsv({})).skills), 3);
const maxed = Object.fromEntries(SKILLS.filter((s) => s.key !== 'overall').map((s) => [s.key, 99]));
eq('a maxed account is combat 126', combatLevel(parseHiscores(buildCsv(maxed)).skills), 126);

assert('empty input warns', parseHiscores('').warnings.length > 0);
eq('empty input yields no skills', Object.keys(parseHiscores('').skills).length, 0);

eq('RSN trimmed', normaliseRsn('  Zezima  '), 'Zezima');
eq('underscores become spaces', normaliseRsn('B0aty_Man'), 'B0aty Man');
eq('13 characters is too long', normaliseRsn('a'.repeat(13)), null);
eq('12 is allowed', normaliseRsn('a'.repeat(12)), 'a'.repeat(12));
eq('injection rejected', normaliseRsn('bad<script>'), null);
eq('spaces encode as underscores', rsnToQuery('B0aty Man'), 'B0aty_Man');

// ------------------------------------------------------------------ Result
if (failures === 0) {
  console.log(`\ntest:osrs — ${checks} checks, all passed`);
  process.exit(0);
}
console.error(`\ntest:osrs — ${failures} of ${checks} checks FAILED`);
process.exit(1);
