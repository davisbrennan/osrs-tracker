/**
 * When an alert fires, and what the email then says.
 *
 * The firing decision gets the attention because its failure modes are both
 * bad and silent: an alert that never fires looks exactly like a quiet
 * market, and one that fires constantly trains its owner to ignore the
 * whole feature.
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

const { alertTriggered, alertEmail } = await import('@/lib/osrs/jobs/check-alerts');
const { marginPerUnit, geTax } = await import('@/lib/osrs/ge');

const base = {
  kind: 'price' as const,
  direction: 'below' as const,
  threshold: 1000,
  priceSide: 'low' as const,
  low: 1000,
  high: 1100,
};

console.log('--- price alerts keep working exactly as before ---');
{
  ok('below fires at the threshold', alertTriggered({ ...base, low: 1000 }));
  ok('below fires under it', alertTriggered({ ...base, low: 900 }));
  ok('below does not fire above it', !alertTriggered({ ...base, low: 1001 }));

  const above = { ...base, direction: 'above' as const };
  ok('above fires at the threshold', alertTriggered({ ...above, low: 1000 }));
  ok('above fires over it', alertTriggered({ ...above, low: 1200 }));
  ok('above does not fire under it', !alertTriggered({ ...above, low: 999 }));
}

console.log('--- which side of the book is watched ---');
{
  const onHigh = { ...base, priceSide: 'high' as const, threshold: 1100 };
  ok('reads the high side', alertTriggered({ ...onHigh, high: 1100, low: 99999 }));
  ok('and ignores the low side', !alertTriggered({ ...onHigh, high: 5000, low: 1 }));
}

console.log('--- an untraded item never fires a below alert ---');
{
  // The dangerous one: treating a null price as 0 would mail about every
  // item in the game that has no price.
  ok('null low', !alertTriggered({ ...base, low: null }));
  ok(
    'null high on a high-side alert',
    !alertTriggered({ ...base, priceSide: 'high', high: null })
  );
  ok('and null is not treated as zero', !alertTriggered({ ...base, low: null, threshold: 1 }));
}

console.log('--- margin alerts use the taxed margin, not the raw spread ---');
{
  // Buy 1,000, sell 1,100. Raw spread is 100; tax is floor(1,100 * 0.02) = 22,
  // so the real margin is 78.
  eq('tax on the sale', geTax(1100), 22);
  eq('margin after tax', marginPerUnit(1000, 1100), 78);

  const m = { ...base, kind: 'margin' as const, direction: 'above' as const };
  ok('fires at 78', alertTriggered({ ...m, threshold: 78 }));
  ok('fires below 78', alertTriggered({ ...m, threshold: 50 }));
  ok('does not fire at 79', !alertTriggered({ ...m, threshold: 79 }));
  ok(
    'and would have fired wrongly on the raw spread',
    !alertTriggered({ ...m, threshold: 100 }),
    'the untaxed spread is 100'
  );

  ok('needs both sides', !alertTriggered({ ...m, threshold: 1, low: null }));
  ok('both sides again', !alertTriggered({ ...m, threshold: 1, high: null }));
}

console.log('--- unusual alerts need history AND a real margin ---');
{
  const u = { ...base, kind: 'unusual' as const, direction: 'above' as const, threshold: 90 };

  ok('fires at the percentile', alertTriggered({ ...u, spreadPercentile: 90 }));
  ok('fires above it', alertTriggered({ ...u, spreadPercentile: 99 }));
  ok('stays quiet below it', !alertTriggered({ ...u, spreadPercentile: 89 }));

  // No history is not "unusual", it is "unknown".
  ok('no percentile means silence', !alertTriggered({ ...u, spreadPercentile: null }));
  ok('an absent percentile too', !alertTriggered({ ...u, spreadPercentile: undefined }));

  // The trap this exists to avoid: an item whose spread is normally zero
  // sits at the 100th percentile the moment it has a spread of one gp.
  ok(
    'a historically wide but worthless margin does not fire',
    !alertTriggered({ ...u, spreadPercentile: 100, low: 1000, high: 1001 }),
    `margin after tax is ${marginPerUnit(1000, 1001)}`
  );
  ok(
    'but a historically wide and profitable one does',
    alertTriggered({ ...u, spreadPercentile: 100, low: 1000, high: 1200 })
  );
  ok('and it still needs prices', !alertTriggered({ ...u, spreadPercentile: 100, low: null }));
}

/* -------------------------------------------------------------------- email */

console.log('--- the email link points at a route that exists ---');
{
  process.env.APP_URL = 'https://rspill.com';
  const mail = alertEmail({
    itemName: 'Abyssal whip',
    itemId: 4151,
    direction: 'below',
    threshold: 1_500_000,
    priceSide: 'low',
    price: 1_480_000,
    buy: 1_480_000,
    sell: 1_520_000,
    buyLimit: 70,
  });

  ok('links to /item/', mail.text.includes('https://rspill.com/item/4151'), 'the real route');
  ok(
    'and NOT to /ge/item/, which has never existed',
    !mail.text.includes('/ge/item/') && !mail.html.includes('/ge/item/'),
    'every alert email used to 404 here'
  );
  ok('the button carries the same link', mail.html.includes('https://rspill.com/item/4151'));
}

console.log('--- each kind says what actually happened ---');
{
  const common = {
    itemName: 'Abyssal whip',
    itemId: 4151,
    priceSide: 'low' as const,
    price: 1_480_000,
    buy: 1_480_000,
    sell: 1_520_000,
    buyLimit: 70,
  };

  const price = alertEmail({ ...common, direction: 'below', threshold: 1_500_000 });
  ok('price subject names the threshold', price.subject.includes('below'), price.subject);

  const margin = alertEmail({
    ...common,
    kind: 'margin',
    direction: 'above',
    threshold: 5000,
  });
  ok('margin subject says margin', margin.subject.toLowerCase().includes('margin'), margin.subject);
  ok('and not "is below"', !margin.subject.includes('is below'), margin.subject);

  const unusual = alertEmail({
    ...common,
    kind: 'unusual',
    direction: 'above',
    threshold: 90,
    spreadPercentile: 97,
  });
  ok('unusual subject says unusual', unusual.subject.includes('unusually wide'), unusual.subject);
  ok('the body quotes the percentile', unusual.text.includes('97%'), unusual.text.split('\n')[1]);
  ok(
    'and does not claim a price crossing',
    !unusual.text.includes('instant-sell price is now'),
    'that would be a different alert'
  );
}

console.log('--- the email carries the flip maths, not just the trigger ---');
{
  process.env.APP_URL = 'https://rspill.com';
  const mail = alertEmail({
    itemName: 'Abyssal whip',
    itemId: 4151,
    direction: 'below',
    threshold: 1_500_000,
    priceSide: 'low',
    price: 1_480_000,
    buy: 1_480_000,
    sell: 1_520_000,
    buyLimit: 70,
  });
  ok('quotes the margin after tax', /Margin after tax/.test(mail.text));
  ok('and the breakeven', /Breakeven sell price/.test(mail.text));
  ok('and the buy limit', /Buy limit: 70/.test(mail.text));
}

console.log('--- an item with one side missing says so rather than inventing a margin ---');
{
  const mail = alertEmail({
    itemName: 'Thing',
    itemId: 1,
    direction: 'below',
    threshold: 100,
    priceSide: 'low',
    price: 90,
    buy: 90,
    sell: null,
    buyLimit: null,
  });
  ok('explains the gap', mail.text.includes('No complete two-sided price'));
  ok('and quotes no margin', !/Margin after tax/.test(mail.text));
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
