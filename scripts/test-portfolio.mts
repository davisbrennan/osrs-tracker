/**
 * The position and P&L engine.
 *
 * Every number the journal shows comes out of this file, so it is tested
 * against hand-computed arithmetic rather than against itself. The cases
 * that matter most are the ones the GE's buy limit forces on people:
 * multiple lots at different prices, and partial closes.
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
const near = (label: string, got: number | null, want: number, tol = 0.01) => {
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

const { buildPortfolio, computeStats, byItem, concentration, equityCurve } =
  await import('@/lib/osrs/portfolio');
const { geTax } = await import('@/lib/osrs/ge');

const WHIP = 4151;
const RUNE = 560;
let seq = 0;
const t = (
  side: 'buy' | 'sell',
  quantity: number,
  price: number,
  day: number,
  itemId = WHIP,
  taxPaid: number | null = null
) => ({
  id: `t${String(++seq).padStart(4, '0')}`,
  itemId,
  itemName: itemId === WHIP ? 'Abyssal whip' : 'Death rune',
  side,
  quantity,
  price,
  executedAt: new Date(2026, 0, day),
  taxPaid,
  note: null,
});

const noMarks = new Map<number, number | null>();

console.log('--- a single round trip ---');
{
  // Buy 1 at 1,000,000; sell 1 at 1,100,000. Tax is 2% of the SALE, floored:
  // 22,000. So profit is 1,100,000 - 22,000 - 1,000,000 = 78,000.
  seq = 0;
  const p = buildPortfolio([t('buy', 1, 1_000_000, 1), t('sell', 1, 1_100_000, 2)], noMarks);
  eq('one close', p.closes.length, 1);
  eq('tax', p.closes[0].tax, 22_000);
  eq('profit is gross minus tax minus cost', p.closes[0].profit, 78_000);
  eq('nothing left open', p.positions.length, 0);
  eq('held one day', p.closes[0].heldMs, 86_400_000);
}

console.log('--- multiple lots: the buy limit makes this the normal case ---');
{
  seq = 0;
  // 70 at 1.5m, then 70 at 1.4m four hours later. Average cost is 1.45m.
  const p = buildPortfolio([t('buy', 70, 1_500_000, 1), t('buy', 70, 1_400_000, 2)], noMarks);
  eq('one position', p.positions.length, 1);
  eq('quantity is the sum', p.positions[0].quantity, 140);
  eq('average cost is weighted', p.positions[0].avgCost, 1_450_000);
  eq('cost basis', p.positions[0].costBasis, 203_000_000);
  eq('oldest lot dates the position', p.positions[0].oldestOpenedAt.getDate(), 1);
}

console.log('--- FIFO consumes the OLDEST lot first ---');
{
  seq = 0;
  const p = buildPortfolio(
    [
      t('buy', 10, 1_000_000, 1), // bought first
      t('buy', 10, 1_200_000, 2),
      t('sell', 10, 1_300_000, 3),
    ],
    noMarks
  );
  eq('one close', p.closes.length, 1);
  eq('matched against the 1.0m lot, not the 1.2m one', p.closes[0].buyPrice, 1_000_000);
  eq('the 1.2m lot is still open', p.positions[0].avgCost, 1_200_000);
  eq('ten still held', p.positions[0].quantity, 10);
}

console.log('--- a sell spanning two lots splits into two closes ---');
{
  seq = 0;
  const p = buildPortfolio(
    [
      t('buy', 10, 1_000_000, 1),
      t('buy', 10, 1_200_000, 2),
      t('sell', 15, 1_300_000, 3), // eats all of lot 1 and half of lot 2
    ],
    noMarks
  );
  eq('two closes', p.closes.length, 2);
  const byLot = p.closes.slice().sort((a, b) => a.buyPrice - b.buyPrice);
  eq('first lot fully consumed', byLot[0].quantity, 10);
  eq('second lot partially', byLot[1].quantity, 5);
  eq('five left open', p.positions[0].quantity, 5);
  eq('and they are the expensive ones', p.positions[0].avgCost, 1_200_000);

  // Tax is per unit, so the two closes must split it rather than each
  // carrying the whole sale's tax.
  const taxPerUnit = geTax(1_300_000, WHIP);
  eq('tax split proportionally', byLot[0].tax + byLot[1].tax, taxPerUnit * 15);
}

console.log('--- partial close leaves the rest open ---');
{
  seq = 0;
  const p = buildPortfolio(
    [t('buy', 1000, 180, 1, RUNE), t('sell', 400, 200, 2, RUNE)],
    new Map([[RUNE, 195]])
  );
  eq('400 closed', p.closes[0].quantity, 400);
  eq('600 open', p.positions[0].quantity, 600);
  eq('cost basis of the remainder', p.positions[0].costBasis, 108_000);
}

console.log('--- a sell with no buy is reported, never valued at zero cost ---');
{
  seq = 0;
  const p = buildPortfolio([t('sell', 5, 1_000_000, 1)], noMarks);
  eq('no closes invented', p.closes.length, 0);
  eq('flagged as unmatched', p.unmatched.length, 1);
  eq('with the quantity', p.unmatched[0].quantity, 5);
  ok(
    'and contributes nothing to realised P&L',
    computeStats(p.closes).realised === 0,
    'treating the missing cost as 0 would report a 5m profit from nothing'
  );
}

console.log('--- over-selling matches what it can and flags the rest ---');
{
  seq = 0;
  const p = buildPortfolio([t('buy', 3, 1_000_000, 1), t('sell', 5, 1_100_000, 2)], noMarks);
  eq('three matched', p.closes[0].quantity, 3);
  eq('two unmatched', p.unmatched[0].quantity, 2);
  eq('no open position', p.positions.length, 0);
}

console.log('--- marking to market takes the exit tax off ---');
{
  seq = 0;
  // 10 bought at 1.0m, market 1.1m. Closing would clear
  // 11,000,000 - (22,000 x 10) - 10,000,000 = 780,000.
  const p = buildPortfolio([t('buy', 10, 1_000_000, 1)], new Map([[WHIP, 1_100_000]]));
  eq('market value is gross', p.positions[0].marketValue, 11_000_000);
  eq('unrealised is net of the tax to get out', p.positions[0].unrealised, 780_000);
  near('as a percentage of cost', p.positions[0].unrealisedPct, 7.8);
}

console.log('--- an unmarkable item is null, not zero ---');
{
  seq = 0;
  const p = buildPortfolio([t('buy', 10, 1_000_000, 1)], noMarks);
  eq('mark', p.positions[0].mark, null);
  eq('market value', p.positions[0].marketValue, null);
  ok('unrealised is unknown rather than a 10m loss', p.positions[0].unrealised === null);
}

console.log('--- order of input does not matter ---');
{
  seq = 0;
  const trades = [
    t('buy', 10, 1_000_000, 1),
    t('buy', 10, 1_200_000, 2),
    t('sell', 10, 1_300_000, 3),
  ];
  const forward = buildPortfolio(trades, noMarks);
  const shuffled = buildPortfolio(trades.slice().reverse(), noMarks);
  eq(
    'same matched buy price however the rows arrive',
    shuffled.closes[0].buyPrice,
    forward.closes[0].buyPrice
  );
  eq('same remaining quantity', shuffled.positions[0].quantity, forward.positions[0].quantity);
}

console.log('--- items never cross-contaminate ---');
{
  seq = 0;
  const p = buildPortfolio(
    [t('buy', 10, 1_000_000, 1, WHIP), t('sell', 10, 200, 2, RUNE)],
    noMarks
  );
  eq('the rune sell does not close the whip', p.closes.length, 0);
  eq('whip still open', p.positions.length, 1);
  eq('rune sell is unmatched', p.unmatched[0].itemId, RUNE);
}

console.log('--- stats ---');
{
  seq = 0;
  // Three closes: +100, -40, +60. Realised 120.
  const p = buildPortfolio(
    [
      t('buy', 1, 1000, 1),
      t('sell', 1, 1100, 2), // under 50gp tax threshold? no: tax on 1100 = 22
      t('buy', 1, 1000, 3),
      t('sell', 1, 900, 4),
      t('buy', 1, 1000, 5),
      t('sell', 1, 1200, 6),
    ],
    noMarks
  );
  const s = computeStats(p.closes);
  eq('three closes', s.trades, 3);
  // 1100-22-1000 = 78 ; 900-18-1000 = -118 ; 1200-24-1000 = 176
  eq('realised', s.realised, 78 - 118 + 176);
  eq('wins', s.wins, 2);
  eq('losses', s.losses, 1);
  eq('gross profit', s.grossProfit, 254);
  eq('gross loss is positive', s.grossLoss, 118);
  near('profit factor', s.profitFactor, 254 / 118);
  near('win rate', s.winRate, 2 / 3);
  eq('capital deployed', s.capitalDeployed, 3000);
  near('return on capital %', s.returnOnCapital, (136 / 3000) * 100);
  eq('best', s.best!.profit, 176);
  eq('worst', s.worst!.profit, -118);
}

console.log('--- max drawdown walks the curve chronologically ---');
{
  seq = 0;
  // +1000, then -600, then +100. Peak 1000, trough 400 → drawdown 600.
  const closes = [
    { profit: 1000, closedAt: new Date(2026, 0, 1) },
    { profit: -600, closedAt: new Date(2026, 0, 2) },
    { profit: 100, closedAt: new Date(2026, 0, 3) },
  ].map((c) => ({
    ...c,
    quantity: 1,
    cost: 0,
    gross: 0,
    tax: 0,
    buyPrice: 0,
    sellPrice: 0,
    itemId: 1,
    itemName: 'x',
    openedAt: c.closedAt,
    heldMs: 0,
  }));
  eq('drawdown', computeStats(closes as never).maxDrawdown, 600);

  // Newest-first input must give the same answer.
  eq('order-independent', computeStats(closes.slice().reverse() as never).maxDrawdown, 600);
}

console.log('--- a book with no losses has an undefined profit factor ---');
{
  seq = 0;
  const p = buildPortfolio([t('buy', 1, 1000, 1), t('sell', 1, 2000, 2)], noMarks);
  const s = computeStats(p.closes);
  eq('null rather than Infinity', s.profitFactor, null);
  ok('because printing ∞ reads as a bug', s.realised > 0);
}

console.log('--- empty book ---');
{
  const s = computeStats([]);
  eq('no trades', s.trades, 0);
  eq('no realised', s.realised, 0);
  eq('no drawdown', s.maxDrawdown, 0);
  eq('profit factor undefined', s.profitFactor, null);
  eq('best is null', s.best, null);
  eq('equity curve empty, not a lone zero point', equityCurve([]).length, 0);
}

console.log('--- by item and concentration ---');
{
  seq = 0;
  const p = buildPortfolio(
    [
      t('buy', 1, 1000, 1, WHIP),
      t('sell', 1, 2000, 2, WHIP),
      t('buy', 1, 1000, 3, RUNE),
      t('sell', 1, 900, 4, RUNE),
      t('buy', 10, 5000, 5, RUNE),
    ],
    noMarks
  );
  const rows = byItem(p.closes);
  eq('two items traded', rows.length, 2);
  eq('best first', rows[0].itemId, WHIP);
  near('rune win rate is zero', rows[1].winRate, 0);

  const conc = concentration(p.positions);
  eq('one open position', conc.length, 1);
  near('so it is the whole book', conc[0].pct, 100);
}

console.log('--- stored tax is preferred over recomputing it ---');
{
  seq = 0;
  // A trade logged with a tax figure from a different rate era must keep it.
  const p = buildPortfolio([t('buy', 1, 1000, 1), t('sell', 1, 1100, 2, WHIP, 55)], noMarks);
  eq('uses the stored 55, not a fresh 22', p.closes[0].tax, 55);
  eq('and the profit follows it', p.closes[0].profit, 1100 - 55 - 1000);
}

console.log('--- equity curve is cumulative ---');
{
  seq = 0;
  const p = buildPortfolio(
    [t('buy', 1, 1000, 1), t('sell', 1, 1100, 2), t('buy', 1, 1000, 3), t('sell', 1, 1200, 4)],
    noMarks
  );
  const curve = equityCurve(p.closes);
  eq('a zero anchor plus one point per close', curve.length, 3);
  eq('starts at zero', curve[0].pnl, 0);
  eq('anchored to the first position opening', curve[0].t, new Date(2026, 0, 1).getTime());
  eq('then the running total', curve[1].pnl, 78);
  eq('and the cumulative total', curve[2].pnl, 78 + 176);
  ok('time only moves forward', curve[2].t > curve[1].t && curve[1].t > curve[0].t);
}

console.log('--- a ticket round trip still matches the OLDEST lot ---');
{
  seq = 0;
  // The ticket can write a buy and its sell together. That pairing is a
  // convenience in the form, NOT a hint to the matcher: if an older lot of
  // the same item is open, FIFO closes THAT one.
  //
  // This is here because the success message once reported profit computed
  // against the price typed into the form, which disagreed with the book by
  // the difference between the two lots.
  const old = t('buy', 2, 14_100_000, 1);
  const buy = t('buy', 2, 14_000_000, 5);
  const sell = t('sell', 2, 15_000_000, 5);
  const p = buildPortfolio([old, buy, sell], noMarks);

  eq('one close', p.closes.length, 1);
  eq('matched against the older, dearer lot', p.closes[0].buyPrice, 14_100_000);
  const tax = geTax(15_000_000, WHIP);
  eq('profit follows that lot', p.closes[0].profit, (15_000_000 - tax - 14_100_000) * 2);
  ok(
    'and NOT the price typed on the ticket',
    p.closes[0].profit !== (15_000_000 - tax - 14_000_000) * 2
  );
  eq('the newer lot stays open', p.positions[0].quantity, 2);
  eq('at its own price', p.positions[0].avgCost, 14_000_000);
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
