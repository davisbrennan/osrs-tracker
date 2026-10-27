/**
 * Item browser filtering and sorting.
 *
 * Worth testing because the failure mode is silent: a filter that excludes
 * the wrong rows looks exactly like a short catalogue, and nobody notices an
 * item that is missing. The parser gets the same attention, because every
 * filter arrives as a string off a query string and a mis-parse is the same
 * silent failure one layer up.
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

const {
  parseFilters,
  scoreItems,
  applyDerivedFilters,
  sortItems,
  activeChips,
  hasActiveFilters,
  SORTS,
} = await import('@/lib/osrs/item-filters');
const { formatGp, geTax } = await import('@/lib/osrs/ge');

const INF = Number.POSITIVE_INFINITY;
const NOW = new Date(2026, 0, 1, 12, 0, 0).getTime();
const minsAgo = (m: number) => new Date(NOW - m * 60_000);

type RowOver = Partial<Parameters<typeof scoreItems>[0][number]>;
let nextId = 1;
const row = (over: RowOver = {}) => ({
  id: nextId++,
  name: 'Thing',
  members: false,
  buyLimit: 1000,
  highalch: null,
  low: 1000,
  high: 1100,
  lowTime: minsAgo(5),
  highTime: minsAgo(5),
  hourlyVolume: 500,
  ...over,
});

/* ------------------------------------------------------------------ parsing */

console.log('--- defaults when nothing is set ---');
{
  const f = parseFilters({});
  eq('no name', f.q, '');
  eq('no price floor', f.minPrice, null);
  eq('members is any', f.members, 'any');
  eq('sorted by volume', f.sort, 'volume');
  eq('first page', f.page, 1);
  eq('nothing active', hasActiveFilters(f), false);
}

console.log('--- gp shorthand is accepted everywhere a price is ---');
{
  const f = parseFilters({ minPrice: '1.5m', maxPrice: '250k', minMargin: '2k', minWindow: '1m' });
  eq('1.5m', f.minPrice, 1_500_000);
  eq('250k', f.maxPrice, 250_000);
  eq('2k margin', f.minMargin, 2000);
  eq('1m window', f.minWindow, 1_000_000);
  eq('and it counts as filtered', hasActiveFilters(f), true);
}

console.log('--- nonsense is dropped rather than coerced to zero ---');
{
  // A zero floor and "no floor" must not be the same thing: minPrice=0 would
  // be a no-op, but minVolume=0 wrongly parsed from junk would also be a
  // no-op, so the distinction only matters for how it round-trips. What must
  // never happen is junk becoming a real constraint.
  const f = parseFilters({ minPrice: 'abc', minVolume: 'xyz', minLimit: '-5', page: '0' });
  eq('junk price', f.minPrice, null);
  eq('junk volume', f.minVolume, null);
  eq('negative limit', f.minLimit, null);
  eq('page floors at 1', f.page, 1);
}

console.log('--- a negative return threshold is legitimate ---');
{
  // Most items lose money after tax, so "show me things losing less than 5%"
  // is a real question. Unlike a price, a percentage may be negative.
  eq('negative roi survives', parseFilters({ minRoi: '-5' }).minRoi, -5);
  eq('a percent sign is tolerated', parseFilters({ minRoi: '2.5%' }).minRoi, 2.5);
  eq('but a negative price does not', parseFilters({ minPrice: '-100' }).minPrice, null);
}

console.log('--- enums fall back rather than trusting the query string ---');
{
  eq('unknown sort', parseFilters({ sort: 'nonsense' }).sort, 'volume');
  eq('unknown membership', parseFilters({ members: 'maybe' }).members, 'any');
  eq('every listed sort is accepted', SORTS.every((s) => parseFilters({ sort: s }).sort === s), true);
}

console.log('--- repeated params take the first, not an array ---');
{
  const f = parseFilters({ q: ['whip', 'bow'], sort: ['name', 'roi'] });
  eq('first name', f.q, 'whip');
  eq('first sort', f.sort, 'name');
}

console.log('--- checkboxes are only on when they say 1 ---');
{
  eq('on', parseFilters({ affordable: '1' }).affordable, true);
  eq('absent', parseFilters({}).affordable, false);
  eq('"on" is not 1', parseFilters({ affordable: 'on' }).affordable, false);
}

/* ------------------------------------------------------------------ scoring */

console.log('--- rows without both sides of the book are dropped ---');
{
  const scored = scoreItems(
    [row(), row({ low: null }), row({ high: null }), row({ low: null, high: null })],
    INF,
    null,
    NOW
  );
  eq('only the complete one survives', scored.length, 1);
}

console.log('--- the margin is the taxed one ---');
{
  const [s] = scoreItems([row({ low: 1000, high: 1100 })], INF, null, NOW);
  const tax = geTax(1100);
  eq('tax is 22', tax, 22);
  eq('margin is net of it', s.opportunity.marginPerUnit, 1100 - 22 - 1000);
  ok('which is less than the raw spread', s.opportunity.marginPerUnit < 100);
}

console.log('--- alch profit nets off the nature rune ---');
{
  const [withRune] = scoreItems([row({ highalch: 1200, low: 1000 })], INF, 200, NOW);
  eq('1200 - 200 - 1000', withRune.alchProfit, 0);

  const [profitable] = scoreItems([row({ highalch: 1400, low: 1000 })], INF, 200, NOW);
  eq('a real alch margin', profitable.alchProfit, 200);

  const [noRunePrice] = scoreItems([row({ highalch: 1400 })], INF, null, NOW);
  eq('unknowable without a rune price', noRunePrice.alchProfit, null);

  const [noAlch] = scoreItems([row({ highalch: null })], INF, 200, NOW);
  eq('unalchable', noAlch.alchProfit, null);
}

/* ------------------------------------------------------- derived filtering */

const base = parseFilters({});

console.log('--- margin threshold ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Thin', low: 1000, high: 1010 }), // taxed margin is negative
      row({ name: 'Fat', low: 1000, high: 1500 }), // 1500 - 30 - 1000 = 470
    ],
    INF,
    null,
    NOW
  );
  const kept = applyDerivedFilters(scored, { ...base, minMargin: 100 }, INF);
  eq('only the fat one', kept.map((k) => k.row.name), ['Fat']);
}

console.log('--- return threshold is independent of size ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Cheap', low: 100, high: 130 }), // margin 28 on 100 = 28%
      row({ name: 'Dear', low: 1_000_000, high: 1_010_000 }), // 0.1% ish
    ],
    INF,
    null,
    NOW
  );
  const kept = applyDerivedFilters(scored, { ...base, minRoi: 10 }, INF);
  eq('the small one clears 10%', kept.map((k) => k.row.name), ['Cheap']);
}

console.log('--- "what I can afford" is one unit, not a window ---');
{
  const scored = scoreItems(
    [row({ name: 'Within', low: 900, high: 1100 }), row({ name: 'Beyond', low: 5000, high: 6000 })],
    1000,
    null,
    NOW
  );
  const kept = applyDerivedFilters(scored, { ...base, affordable: true }, 1000);
  eq('only what one unit of cash reaches', kept.map((k) => k.row.name), ['Within']);
}

console.log('--- the alchable filter needs a real profit, not merely a value ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Worth alching', highalch: 1400, low: 1000 }),
      row({ name: 'Break even', highalch: 1200, low: 1000 }),
      row({ name: 'Loses', highalch: 900, low: 1000 }),
      row({ name: 'No alch value', highalch: null, low: 1000 }),
    ],
    INF,
    200,
    NOW
  );
  const kept = applyDerivedFilters(scored, { ...base, alchable: true }, INF);
  eq('strictly profitable only', kept.map((k) => k.row.name), ['Worth alching']);
}

console.log('--- filters compose, they do not override each other ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Both', low: 1000, high: 1500, hourlyVolume: 900 }),
      row({ name: 'Fat but idle', low: 1000, high: 1500, hourlyVolume: 1 }),
      row({ name: 'Busy but thin', low: 1000, high: 1010, hourlyVolume: 900 }),
    ],
    INF,
    null,
    NOW
  );
  // Volume is a SQL filter, so only the margin half applies here — the point
  // is that adding one does not discard the other.
  const kept = applyDerivedFilters(scored, { ...base, minMargin: 100, minRoi: 5 }, INF);
  eq('both thresholds hold', kept.map((k) => k.row.name).sort(), ['Both', 'Fat but idle']);
}

console.log('--- no thresholds set means nothing is excluded ---');
{
  const scored = scoreItems([row(), row(), row()], INF, null, NOW);
  eq('all three survive', applyDerivedFilters(scored, base, INF).length, 3);
}

/* ------------------------------------------------------------------ sorting */

console.log('--- sorting ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Beta', low: 100, high: 130, hourlyVolume: 10, buyLimit: 5 }),
      row({ name: 'Alpha', low: 5000, high: 5400, hourlyVolume: 900, buyLimit: 100 }),
      row({ name: 'Gamma', low: 900, high: 1000, hourlyVolume: 400, buyLimit: 50 }),
    ],
    INF,
    null,
    NOW
  );
  const names = (k: Parameters<typeof sortItems>[1]) =>
    sortItems(scored, k).map((s) => s.row.name);

  eq('busiest first', names('volume'), ['Alpha', 'Gamma', 'Beta']);
  eq('alphabetical', names('name'), ['Alpha', 'Beta', 'Gamma']);
  eq('cheapest first', names('price-asc'), ['Beta', 'Gamma', 'Alpha']);
  eq('dearest first', names('price-desc'), ['Alpha', 'Gamma', 'Beta']);
  eq('biggest buy limit first', names('limit'), ['Alpha', 'Gamma', 'Beta']);

  const byMargin = sortItems(scored, 'margin');
  ok(
    'margin descends',
    byMargin[0].opportunity.marginPerUnit >= byMargin[2].opportunity.marginPerUnit
  );
  const byRoi = sortItems(scored, 'roi');
  ok('return descends', byRoi[0].opportunity.roiPercent >= byRoi[2].opportunity.roiPercent);
}

console.log('--- sorting never mutates the input ---');
{
  const scored = scoreItems([row({ name: 'B' }), row({ name: 'A' })], INF, null, NOW);
  const before = scored.map((s) => s.row.name);
  sortItems(scored, 'name');
  eq('untouched', scored.map((s) => s.row.name), before);
}

console.log('--- ties break on name, so paging is stable ---');
{
  const scored = scoreItems(
    [
      row({ name: 'Zebra', low: 100, high: 110, hourlyVolume: 5 }),
      row({ name: 'Aardvark', low: 100, high: 110, hourlyVolume: 5 }),
    ],
    INF,
    null,
    NOW
  );
  eq('same volume sorts by name', sortItems(scored, 'volume').map((s) => s.row.name), [
    'Aardvark',
    'Zebra',
  ]);
}

/* -------------------------------------------------------------------- chips */

console.log('--- active filters are each reported once, and removable ---');
{
  const f = parseFilters({
    q: 'whip',
    minPrice: '1m',
    members: 'members',
    affordable: '1',
    minRoi: '3',
    fresh: '60',
  });
  const chips = activeChips(f, formatGp);
  eq('one chip per filter', chips.length, 6);
  const params = chips.map((c) => c.param);
  eq('each names the param that clears it', new Set(params).size, params.length);
  ok('the name chip quotes the term', chips.some((c) => c.label.includes('whip')));
  ok('the price chip is formatted', chips.some((c) => c.label.includes('1.00M')));
  ok('membership reads plainly', chips.some((c) => c.label === 'members only'));
  ok('freshness reads plainly', chips.some((c) => c.label === 'last hour'));

  eq('nothing set means no chips', activeChips(parseFilters({}), formatGp).length, 0);
}

console.log('--- free-to-play is distinct from members ---');
{
  eq('f2p chip', activeChips(parseFilters({ members: 'f2p' }), formatGp)[0].label, 'free-to-play only');
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
