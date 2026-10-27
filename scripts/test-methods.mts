/**
 * The money-maker engine.
 *
 * Checked against arithmetic done by hand, not against itself. The cases
 * that matter are the three every published guide gets wrong: the sale tax
 * on the output, the four-hour buy limit on the inputs, and what happens
 * when something has no price at all.
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

const { evaluateMethod, rankMethods, actionsAllowedByLimits, WINDOWS_PER_HOUR } = await import(
  '@/lib/osrs/methods'
);
const { METHODS, methodItemNames } = await import('@/lib/osrs/method-data');
const { buildNameIndex, resolveMethods, nameVariants, normaliseItemName } = await import(
  '@/lib/osrs/method-resolve'
);
const { geTax } = await import('@/lib/osrs/ge');

const INF = Number.POSITIVE_INFINITY;

type P = { itemId: number; buy: number | null; sell: number | null; buyLimit: number | null };
const priceMap = (...rows: P[]) => new Map(rows.map((r) => [r.itemId, r]));

const method = (over: Partial<Parameters<typeof evaluateMethod>[0]> = {}) => ({
  id: 'test',
  name: 'Test method',
  category: 'processing' as const,
  skill: 'Herblore',
  level: 30,
  actionsPerHour: 1000,
  coinCost: 0,
  members: false,
  quest: null,
  note: null,
  sourceUrl: 'https://example.invalid',
  inputs: [{ itemId: 1, name: 'Input', quantity: 1 }],
  outputs: [{ itemId: 2, name: 'Output', quantity: 1 }],
  ...over,
});

console.log('--- a window is four hours, so a limit is a quarter of it per hour ---');
eq('windows per hour', WINDOWS_PER_HOUR, 0.25);

console.log('--- the basic shape, by hand ---');
{
  // Buy at 100, sell at 200. Tax is floor(200 * 0.02) = 4, so 196 comes back.
  // 196 - 100 = 96 per action; 96 * 1,000 = 96,000 an hour.
  const r = evaluateMethod(
    method(),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    INF
  );
  eq('cost per action', r.costPerAction, 100);
  eq('revenue is net of tax', r.revenuePerAction, 196);
  eq('profit per action', r.profitPerAction, 96);
  eq('profit per hour', r.profitPerHour, 96_000);
  eq('nothing is holding it back', r.limitedBy, 'rate');
  eq('capital is an hour of inputs', r.capitalPerHour, 100_000);
}

console.log('--- the sale tax is charged, and can turn a profit into a loss ---');
{
  // Buy 1,000, sell 1,010. Looks like +10. Tax is floor(1,010 * 0.02) = 20,
  // so it is actually -10 and the method is a money loser.
  const r = evaluateMethod(
    method(),
    priceMap(
      { itemId: 1, buy: 1000, sell: 990, buyLimit: null },
      { itemId: 2, buy: 1020, sell: 1010, buyLimit: null }
    ),
    INF
  );
  eq('revenue after 20 tax', r.revenuePerAction, 990);
  eq('a loss, not a 10 gain', r.profitPerAction, -10);
  ok('and the hourly figure is negative', r.profitPerHour! < 0);
}

console.log('--- a coin fee counts as cost, the way a tanner does ---');
{
  // 1 hide at 1,000 plus a 20gp fee; leather sells at 1,100, tax 22.
  const r = evaluateMethod(
    method({ coinCost: 20, actionsPerHour: 2000 }),
    priceMap(
      { itemId: 1, buy: 1000, sell: 980, buyLimit: null },
      { itemId: 2, buy: 1120, sell: 1100, buyLimit: null }
    ),
    INF
  );
  eq('cost includes the fee', r.costPerAction, 1020);
  eq('revenue after tax', r.revenuePerAction, 1078);
  eq('profit per hide', r.profitPerAction, 58);
  eq('per hour', r.profitPerHour, 116_000);
}

console.log('--- the buy limit on an input caps throughput ---');
{
  // The guide says 4,100/hr. The limit says 11,000 per four hours, which is
  // 2,750/hr. The limit wins, and the honest profit is a third lower.
  const r = evaluateMethod(
    method({ actionsPerHour: 4100 }),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: 11_000 },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    INF
  );
  eq('throttled to the limit', r.actionsPerHour, 2750);
  eq('and it says so', r.limitedBy, 'buy limit');
  eq('profit follows the real rate', r.profitPerHour, 96 * 2750);
  ok('which is below the unthrottled figure', r.profitPerHour! < 96 * 4100);
}

console.log('--- a limit above the rate does not slow anything down ---');
{
  const r = evaluateMethod(
    method({ actionsPerHour: 1000 }),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: 40_000 },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    INF
  );
  eq('full rate', r.actionsPerHour, 1000);
  eq('limited only by how fast you can click', r.limitedBy, 'rate');
}

console.log('--- the tightest input governs ---');
{
  const inputs = [
    { itemId: 1, name: 'Loose', quantity: 1 },
    { itemId: 3, name: 'Tight', quantity: 1 },
  ];
  const prices = priceMap(
    { itemId: 1, buy: 10, sell: 9, buyLimit: 40_000 },
    { itemId: 3, buy: 10, sell: 9, buyLimit: 8_000 },
    { itemId: 2, buy: 210, sell: 200, buyLimit: null }
  );
  eq('the ceiling is the smaller one', actionsAllowedByLimits(inputs, prices), 2000);

  const r = evaluateMethod(method({ inputs, actionsPerHour: 4100 }), prices, INF);
  eq('throttled to 2,000', r.actionsPerHour, 2000);
}

console.log('--- needing two of something halves the ceiling ---');
{
  const inputs = [{ itemId: 1, name: 'Input', quantity: 2 }];
  const prices = priceMap(
    { itemId: 1, buy: 10, sell: 9, buyLimit: 8_000 },
    { itemId: 2, buy: 210, sell: 200, buyLimit: null }
  );
  // 8,000 per window is 2,000/hr of units, but each action eats two.
  eq('half the actions', actionsAllowedByLimits(inputs, prices), 1000);
}

console.log('--- an input with no published limit imposes none ---');
{
  const inputs = [{ itemId: 1, name: 'Unlimited', quantity: 1 }];
  const prices = priceMap(
    { itemId: 1, buy: 10, sell: 9, buyLimit: null },
    { itemId: 2, buy: 210, sell: 200, buyLimit: null }
  );
  eq('no ceiling at all', actionsAllowedByLimits(inputs, prices), null);
}

console.log('--- cash caps what you can actually run ---');
{
  // Inputs cost 100 an action; 25,000 gp funds 250 of them.
  const r = evaluateMethod(
    method({ actionsPerHour: 1000 }),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    25_000
  );
  eq('only what you can fund', r.actionsPerHour, 250);
  eq('and it says cash', r.limitedBy, 'cash');
  eq('profit scales down with it', r.profitPerHour, 96 * 250);
  eq('capital is what you must have', r.capitalPerHour, 25_000);
}

console.log('--- with no cash, nothing runs, and it is zero rather than negative ---');
{
  const r = evaluateMethod(
    method(),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    0
  );
  eq('no actions', r.actionsPerHour, 0);
  eq('no profit', r.profitPerHour, 0);
  eq('no capital tied up', r.capitalPerHour, 0);
}

console.log('--- an unpriced item makes the answer null, never a guess ---');
{
  const missingInput = evaluateMethod(
    method(),
    priceMap(
      { itemId: 1, buy: null, sell: null, buyLimit: null },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    INF
  );
  eq('profit is unknown', missingInput.profitPerHour, null);
  eq('per action too', missingInput.profitPerAction, null);
  eq('and it names what is missing', missingInput.unpriced, ['Input']);

  const missingOutput = evaluateMethod(
    method(),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: 2, buy: null, sell: null, buyLimit: null }
    ),
    INF
  );
  eq('an unpriced output is just as unknown', missingOutput.profitPerHour, null);
  eq('named', missingOutput.unpriced, ['Output']);

  // The dangerous failure: treating a missing input price as free.
  ok(
    'a missing input is never free',
    missingInput.profitPerHour !== 96_000 && missingInput.profitPerHour !== 196_000
  );
}

console.log('--- an item absent from the price map is unpriced, not free ---');
{
  const r = evaluateMethod(method(), priceMap({ itemId: 2, buy: 210, sell: 200, buyLimit: null }), INF);
  eq('reported', r.unpriced, ['Input']);
  eq('null profit', r.profitPerHour, null);
}

console.log('--- fractional output quantities work ---');
{
  // Three quarters of an output per action, sell 200, tax 4 → 196 * 0.75.
  const r = evaluateMethod(
    method({ outputs: [{ itemId: 2, name: 'Output', quantity: 0.75 }] }),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: 2, buy: 210, sell: 200, buyLimit: null }
    ),
    INF
  );
  eq('revenue scales', r.revenuePerAction, 147);
  eq('profit per action', r.profitPerAction, 47);
}

console.log('--- a tax-exempt output is not taxed ---');
{
  const BOND = 13190;
  const taxed = geTax(1000, 2);
  const exempt = geTax(1000, BOND);
  ok('the ordinary item is taxed', taxed > 0);
  eq('the exempt one is not', exempt, 0);

  const r = evaluateMethod(
    method({ outputs: [{ itemId: BOND, name: 'Bond', quantity: 1 }] }),
    priceMap(
      { itemId: 1, buy: 100, sell: 90, buyLimit: null },
      { itemId: BOND, buy: 1010, sell: 1000, buyLimit: null }
    ),
    INF
  );
  eq('full sale price', r.revenuePerAction, 1000);
}

console.log('--- level requirements are reported, not enforced ---');
{
  const prices = priceMap(
    { itemId: 1, buy: 100, sell: 90, buyLimit: null },
    { itemId: 2, buy: 210, sell: 200, buyLimit: null }
  );
  eq('below the level', evaluateMethod(method(), prices, INF, new Map([['Herblore', 20]])).locked, true);
  eq('at the level', evaluateMethod(method(), prices, INF, new Map([['Herblore', 30]])).locked, false);
  eq('above it', evaluateMethod(method(), prices, INF, new Map([['Herblore', 99]])).locked, false);
  eq('unknown level is not treated as locked', evaluateMethod(method(), prices, INF).locked, false);
  // The profit is still computed, so a locked method shows what it is worth
  // training towards rather than being hidden.
  ok('and the profit is still worked out', evaluateMethod(method(), prices, INF, new Map([['Herblore', 1]])).profitPerHour === 96_000);
}

console.log('--- ranking puts the best first and the unknowable last ---');
{
  const prices = priceMap(
    { itemId: 1, buy: 100, sell: 90, buyLimit: null },
    { itemId: 2, buy: 210, sell: 200, buyLimit: null },
    { itemId: 4, buy: 500, sell: 490, buyLimit: null },
    { itemId: 5, buy: null, sell: null, buyLimit: null }
  );
  const ranked = rankMethods(
    [
      method({ id: 'small', actionsPerHour: 10 }),
      method({ id: 'big', actionsPerHour: 5000 }),
      method({ id: 'unknown', inputs: [{ itemId: 5, name: 'Mystery', quantity: 1 }] }),
    ],
    prices,
    INF
  );
  eq('order', ranked.map((r) => r.method.id), ['big', 'small', 'unknown']);
  eq('the unknown one is null, not zero', ranked[2].profitPerHour, null);
}

/* ------------------------------------------------------------------ dataset */

console.log('--- the shipped dataset is internally sound ---');
{
  const ids = METHODS.map((m) => m.id);
  eq('every id is unique', ids.length, new Set(ids).size);
  ok('there are methods at all', METHODS.length >= 25, `${METHODS.length} methods`);

  for (const m of METHODS) {
    if (m.actionsPerHour <= 0) ok(`${m.id} has a positive rate`, false);
    if (m.inputs.length === 0) ok(`${m.id} has inputs`, false);
    if (m.outputs.length === 0) ok(`${m.id} has outputs`, false);
    if (!m.sourceUrl.startsWith('https://')) ok(`${m.id} cites a source`, false);
  }
  ok('all rates positive, all have inputs, outputs and a source', true);

  // No gp figure belongs in the dataset — that is the whole premise.
  const raw = JSON.stringify(METHODS);
  ok('no stored profit figures', !/profitPerHour|gpPerHour/.test(raw));

  // The dose trap: mixing yields a 3-dose potion. If any finished-potion
  // output is a (4), the revenue would be overstated by about a third.
  const fourDose = METHODS.flatMap((m) => m.outputs).filter((o) => /\(4\)$/.test(o.name));
  eq('no 4-dose outputs from mixing', fourDose.map((o) => o.name), []);
  const threeDose = METHODS.flatMap((m) => m.outputs).filter((o) => /\(3\)$/.test(o.name));
  ok('finished potions are 3-dose', threeDose.length >= 10, `${threeDose.length} of them`);
}

console.log('--- name variants cover the spacing inconsistency ---');
{
  eq('tight form offers the spaced one', nameVariants('Ranarr potion(unf)'), [
    'Ranarr potion(unf)',
    'Ranarr potion (unf)',
  ]);
  eq('and the reverse', nameVariants('Prayer potion (3)'), [
    'Prayer potion (3)',
    'Prayer potion(3)',
  ]);
  eq('a plain name has one form', nameVariants('Snape grass'), ['Snape grass']);
  eq('normalising is case and space insensitive', normaliseItemName('Ranarr Potion (unf)'), 'ranarr potion(unf)');
}

console.log('--- resolution drops a method rather than mispricing it ---');
{
  const names = methodItemNames();
  ok('the dataset references items', names.length > 10, `${names.length} distinct items`);

  // A catalogue missing one secondary must drop that method, not price it
  // as though the secondary were free.
  const full = buildNameIndex(names.map((n, i) => ({ id: i + 1, name: n })));
  const complete = resolveMethods(METHODS, full);
  eq('everything resolves against a complete catalogue', complete.failed.length, 0);
  eq('and every method survives', complete.resolved.length, METHODS.length);

  const without = buildNameIndex(
    names.filter((n) => n !== 'Snape grass').map((n, i) => ({ id: i + 1, name: n }))
  );
  const partial = resolveMethods(METHODS, without);
  const prayer = partial.resolved.find((m) => m.id === 'prayer-potion');
  ok('the prayer potion method is dropped, not half-priced', prayer === undefined);
  const report = partial.failed.find((f) => f.methodId === 'prayer-potion');
  eq('and it is reported by name', report?.missing, ['Snape grass']);

  // A spaced catalogue must still match a tight dataset name.
  const spaced = buildNameIndex(
    names.map((n, i) => ({ id: i + 1, name: n.replace(/\(/g, ' (') }))
  );
  eq('spacing differences still resolve', resolveMethods(METHODS, spaced).failed.length, 0);
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
