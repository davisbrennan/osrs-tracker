/**
 * Suggested offer prices.
 *
 * This is advice about money, so the tests are mostly about the boundary:
 * the exact gp at which a flip stops paying. An off-by-one here does not
 * look wrong on screen — it tells someone to pay a price that loses.
 *
 * The tax is the thing that makes it non-obvious. It is charged on the
 * SALE, floored, free under 50gp and capped at 5m, so the band is not
 * symmetric and cannot be worked out by halving a spread.
 */

const { suggestOffers, maxBuyPrice, marginAfterImproving, tightness, tightnessLabel } =
  await import('@/lib/osrs/offers');
const { marginPerUnit, netSellPrice, breakevenSellPrice, geTax, TAX_EXEMPT_ITEM_IDS } =
  await import('@/lib/osrs/ge');

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

console.log('\nThe most you can pay is exactly what the sale nets, minus one');
{
  // 1,000,000 sells for 980,000 after 2% tax. Pay 979,999 and you make 1gp;
  // pay 980,000 and you make nothing, which is not a flip.
  eq('max buy at 1m', maxBuyPrice(1_000_000), 979_999);
  eq('and that leaves exactly 1gp', marginPerUnit(979_999, 1_000_000), 1);
  eq('one more and it is zero', marginPerUnit(980_000, 1_000_000), 0);

  // The boundary must be exact, not approximately right, at every scale.
  for (const sell of [51, 100, 999, 1_000, 123_456, 2_000_000, 500_000_000]) {
    const mb = maxBuyPrice(sell);
    checks++;
    const good = marginPerUnit(mb, sell) > 0 && marginPerUnit(mb + 1, sell) <= 0;
    if (!good) fail++;
    console.log(
      `  ${good ? '✓' : '✗'} sell ${sell}: max buy ${mb} profits, ${mb + 1} does not`
    );
  }
}

console.log('\nIt is the exact inverse of the breakeven sell price');
{
  // These two have to agree or one of the pages contradicts the other.
  for (const buy of [60, 500, 10_000, 1_000_000]) {
    const sell = breakevenSellPrice(buy);
    checks++;
    const good = maxBuyPrice(sell) >= buy;
    if (!good) fail++;
    console.log(
      `  ${good ? '✓' : '✗'} buy ${buy} → breakeven sell ${sell} → max buy ${maxBuyPrice(sell)} (>= ${buy})`
    );
  }
}

console.log('\nThe band on a real flip');
{
  const o = suggestOffers({ low: 1_000_000, high: 1_050_000 })!;
  eq('buy at the last sell', o.buyAt, 1_000_000);
  eq('sell at the last buy', o.sellAt, 1_050_000);
  eq('tax on the sale', o.tax, 21_000);
  eq('margin', o.margin, 29_000);
  eq('pay no more than', o.maxBuy, 1_028_999);
  eq('accept no less than', o.minSell, 1_020_409);
  // The number that answers "what should I offer": how far you can outbid.
  eq('overbid room', o.overbidRoom, 28_999);
  eq('undercut room', o.undercutRoom, 29_591);
  ok('viable', o.viable);

  // Spending the whole overbid room must leave the flip still (barely) alive.
  eq('at the very top of the band it still pays', marginPerUnit(o.maxBuy, o.sellAt), 1);
  ok('one gp past it does not', marginPerUnit(o.maxBuy + 1, o.sellAt) <= 0);
  // Same from the other side.
  ok('at the bottom of the sell band it still pays', marginPerUnit(o.buyAt, o.minSell) > 0);
  ok('one gp under it does not', marginPerUnit(o.buyAt, o.minSell - 1) <= 0);
}

console.log('\nThe 5m tax cap, which is where the breakeven used to be wrong');
{
  // Above 250m the cap binds, so the tax STOPS scaling and the breakeven
  // sell price is just buy + 5m + 1 — far below the 2% estimate. The old
  // breakeven walked up from buyPrice/0.98 and never down, so on this item
  // it claimed 8,753,061,224 when the true floor is 8,583,000,001: about
  // 170m of undercut room silently deleted.
  const o = suggestOffers({ low: 8_578_000_000, high: 8_778_000_000 })!;
  eq('tax is the cap', o.tax, 5_000_000);
  eq('margin', o.margin, 195_000_000);
  eq('accept no less than', o.minSell, 8_583_000_001);
  eq('which is the cap plus a gp', o.minSell - o.buyAt, 5_000_001);
  ok('and that is far below the 2% estimate',
    o.minSell < Math.floor(o.buyAt / 0.98), `${o.minSell} < ${Math.floor(o.buyAt / 0.98)}`);
  ok('it still pays', marginPerUnit(o.buyAt, o.minSell) > 0);
  ok('and a gp less does not', marginPerUnit(o.buyAt, o.minSell - 1) <= 0);
}

console.log('\nThe breakeven is the LOWEST price that pays, at every scale');
{
  // The bug above survived because the old answer was profitable, just not
  // minimal. Profitability alone is not the property — minimality is.
  let bad = 0;
  const probes = [50, 51, 100, 1_000, 1_000_000, 249_999_999, 250_000_000,
    250_000_001, 2_147_483_647, 8_578_000_000];
  for (let p = 50; p < 20_000_000_000; p = Math.ceil(p * 1.6)) probes.push(p);
  for (const buy of probes) {
    if (marginPerUnit(buy, breakevenSellPrice(buy)) <= 0) bad++;
    if (marginPerUnit(buy, breakevenSellPrice(buy) - 1) > 0) bad++;
  }
  eq(`no breakeven across ${probes.length} prices is off by a gp`, bad, 0);

  // The 49 case: "under 50 is untaxed so sell for one more" is wrong,
  // because the SALE at 50 is taxed and nets 49 exactly.
  eq('buy 49 breaks even at 51, not 50', breakevenSellPrice(49), 51);
  ok('selling at 50 really does not pay', marginPerUnit(49, 50) <= 0);
  eq('buy 48 is genuinely untaxed both ways', breakevenSellPrice(48), 49);
}

console.log('\nA spread that looks like profit and is not');
{
  // The whole thesis of the site. Buy 100, sell 101 loses a gp once the
  // tax lands, so there is no price at which this works.
  const o = suggestOffers({ low: 100, high: 101 })!;
  ok('not viable', !o.viable);
  ok('and the overbid room is negative, not zero', o.overbidRoom < 0, String(o.overbidRoom));
  eq('tightness says so', tightness(o), 'none');
  eq('in words', tightnessLabel('none'), 'no profitable price');
}

console.log('\nUnder 50gp there is no tax, so the band is the whole spread');
{
  const o = suggestOffers({ low: 20, high: 45 })!;
  eq('no tax', o.tax, 0);
  eq('margin is the raw spread', o.margin, 25);
  eq('pay up to one under the sale', o.maxBuy, 44);
  eq('overbid room', o.overbidRoom, 24);
  ok('viable', o.viable);
}

console.log('\nTax-exempt items keep the whole spread too');
{
  const bond = [...TAX_EXEMPT_ITEM_IDS][0] as number;
  const o = suggestOffers({ low: 1_000_000, high: 1_050_000, itemId: bond })!;
  eq('no tax on an exempt item', o.tax, 0);
  eq('margin is the raw spread', o.margin, 50_000);
  eq('and the band is wider than the taxed case', o.overbidRoom, 49_999);
}

console.log('\nThe 5m tax cap widens the band on very expensive items');
{
  // 2% of 500m would be 10m, but the cap is 5m — so the band is far wider
  // than a naive percentage suggests.
  const o = suggestOffers({ low: 480_000_000, high: 500_000_000 })!;
  eq('tax is capped', o.tax, 5_000_000);
  eq('margin', o.margin, 15_000_000);
  eq('max buy', o.maxBuy, 494_999_999);
  ok('overbid room is large', o.overbidRoom > 14_000_000, String(o.overbidRoom));
}

console.log('\nImproving both offers costs both, not one');
{
  // People think about one side at a time and underestimate this.
  const o = suggestOffers({ low: 1_000, high: 1_100 })!;
  eq('untouched', o.margin, marginAfterImproving(o, 0, 0));
  // Overbidding costs the full amount: you simply pay more.
  eq('overbid 10 costs exactly 10', marginAfterImproving(o, 10, 0), o.margin - 10);
  // Undercutting costs slightly LESS than it looks, because the tax falls
  // with the sale price. At 1,100 the tax is floor(22) = 22; at 1,090 it is
  // floor(21.8) = 21, so dropping 10gp of revenue hands back 1gp of tax.
  eq('undercut 10 costs 9, not 10', marginAfterImproving(o, 0, 10), o.margin - 9);
  // The point people miss: both sides cost, and it is near enough double.
  eq('both costs both', marginAfterImproving(o, 10, 10), o.margin - 19);
  ok(
    'and improving both is always worse than improving one',
    marginAfterImproving(o, 10, 10) < marginAfterImproving(o, 10, 0) &&
      marginAfterImproving(o, 10, 10) < marginAfterImproving(o, 0, 10)
  );

  // Negative improvements are nonsense and must not be read as a discount.
  eq('a negative overbid is ignored', marginAfterImproving(o, -50, 0), o.margin);
}

console.log('\nHow much room, as a share of what you tie up');
{
  // Judged proportionally, so a 2gp band on a 50gp item and a 40,000gp
  // band on a 1m item are treated the same way.
  const roomy = suggestOffers({ low: 1_000, high: 1_200 })!;
  eq('a 20% spread is comfortable', tightness(roomy), 'comfortable');

  // 2.4% gross on a million becomes 0.35% after tax — a 3,500gp band on a
  // million-gp commitment. Calling that "room to compete" is bad advice.
  const thin = suggestOffers({ low: 1_000_000, high: 1_024_000 })!;
  eq('a 0.35% margin on a million is tight, not comfortable', tightness(thin), 'tight');

  // One gp of margin and zero room: profitable at exactly these two prices
  // and nowhere else. Viable, so not 'none' — but not room either.
  const edge = suggestOffers({ low: 1_000, high: 1_021 })!;
  eq('one gp of margin', edge.margin, 1);
  eq('and no room at all', edge.overbidRoom + edge.undercutRoom, 0);
  eq('is a knife edge, not "no profitable price"', tightness(edge), 'knife-edge');

  const dead = suggestOffers({ low: 1_000, high: 1_010 })!;
  eq('no profitable price', tightness(dead), 'none');

  // Tightness must only ever get better as the spread widens.
  let worse = 0;
  const rank = { none: 0, 'knife-edge': 1, tight: 2, comfortable: 3 } as const;
  let prev = -1;
  for (let high = 1_000; high <= 1_300; high++) {
    const o = suggestOffers({ low: 1_000, high });
    const r = rank[tightness(o!)];
    if (r < prev) worse++;
    prev = r;
  }
  eq('a wider spread never grades tighter', worse, 0);

  ok('every label reads as English',
    (['comfortable', 'tight', 'knife-edge', 'none'] as const).every((t) => tightnessLabel(t).length > 3));
}

console.log('\nA missing side is unknowable, not free');
{
  eq('no buy price', suggestOffers({ low: null, high: 100 }), null);
  eq('no sell price', suggestOffers({ low: 100, high: null }), null);
  eq('neither', suggestOffers({ low: null, high: null }), null);
  eq('zero is not a price', suggestOffers({ low: 0, high: 100 }), null);
  eq('negative is not a price', suggestOffers({ low: -5, high: 100 }), null);
  eq('NaN is not a price', suggestOffers({ low: NaN, high: 100 }), null);
}

console.log('\nAn inverted book is reported, not silently flipped');
{
  // high < low happens when a price moves fast between the two samples.
  // Swapping them to make a positive margin would invent a flip.
  const o = suggestOffers({ low: 1_000, high: 900 })!;
  ok('not viable', !o.viable);
  ok('margin is negative', o.margin < 0, String(o.margin));
  ok('buyAt is still the buy side', o.buyAt === 1_000);
  ok('sellAt is still the sell side', o.sellAt === 900);
}

console.log('\nThe band never recommends a price that loses money');
{
  // The property that matters, across the whole range of real prices.
  let bad = 0;
  for (let p = 1; p < 300_000_000; p = Math.ceil(p * 1.7)) {
    for (const spreadPct of [0.5, 1, 2, 3, 5, 25]) {
      const low = p;
      const high = Math.round(p * (1 + spreadPct / 100));
      const o = suggestOffers({ low, high });
      if (!o || !o.viable) continue;
      if (marginPerUnit(o.maxBuy, o.sellAt) <= 0) bad++;
      if (marginPerUnit(o.buyAt, o.minSell) <= 0) bad++;
    }
  }
  eq('no suggested extreme ever loses', bad, 0);
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
