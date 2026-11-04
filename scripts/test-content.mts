/**
 * The written pages, and the generated item descriptions.
 *
 * Two different failure modes here, both invisible on screen.
 *
 * The guides are prose in a data file, so the things that break are
 * structural: a duplicate slug silently shadows a guide, an empty section
 * renders a heading with nothing under it, a missing summary produces a
 * blank meta description on a page whose whole job is to be found.
 *
 * The item blurbs are generated for every item in the catalogue, so a
 * sentence that reads badly reads badly four thousand times. The assertions
 * are about the things that make generated text obviously generated —
 * repeated words, claims that contradict the numbers, and sentences that
 * appear whether or not the fact behind them exists.
 */

const { GUIDES, guideBySlug, guideWords } = await import('@/lib/guides');
const { itemBlurb, liquidity, priceBand } = await import('@/lib/osrs/item-blurb');
const { FOOTER_LINKS, NAV } = await import('@/lib/site');
const { suggestOffers } = await import('@/lib/osrs/offers');

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

console.log('\nEvery guide is complete and reachable');
{
  ok('there are guides at all', GUIDES.length >= 4, `${GUIDES.length}`);

  const slugs = GUIDES.map((g) => g.slug);
  eq('no duplicate slugs', slugs.length - new Set(slugs).size, 0);

  for (const g of GUIDES) {
    ok(`${g.slug}: url-safe slug`, /^[a-z0-9]+(-[a-z0-9]+)*$/.test(g.slug), g.slug);
    ok(`${g.slug}: has a title`, g.title.trim().length > 5);
    ok(`${g.slug}: has a summary for the meta description`, g.summary.trim().length > 40);
    ok(`${g.slug}: summary is not truncated mid-sentence`, /[.!?]$/.test(g.summary.trim()));
    ok(`${g.slug}: has sections`, g.sections.length >= 3, `${g.sections.length}`);
    ok(`${g.slug}: findable by slug`, guideBySlug(g.slug)?.title === g.title);

    for (const s of g.sections) {
      ok(`${g.slug}/"${s.heading}": heading is not empty`, s.heading.trim().length > 3);
      ok(`${g.slug}/"${s.heading}": has body`, s.body.length > 0 && s.body.every((p) => p.trim().length > 40));
    }
  }

  eq('an unknown slug returns nothing', guideBySlug('does-not-exist'), undefined);
  eq('an empty slug returns nothing', guideBySlug(''), undefined);
}

console.log('\nThe guides carry enough content to be worth the page');
{
  // The whole reason these exist. A guide that is three thin paragraphs is
  // the thin content it was written to fix.
  for (const g of GUIDES) {
    const w = guideWords(g);
    ok(`${g.slug} is substantial`, w >= 400, `${w} words`);
  }
  const total = GUIDES.reduce((n, g) => n + guideWords(g), 0);
  ok('and together they are a real body of writing', total >= 2_500, `${total} words`);
}

console.log("\nThe guide's worked example agrees with the engine");
{
  // A guide that teaches arithmetic the site does not actually do is worse
  // than no guide. These are the numbers printed in the prose, checked
  // against the code that produces them on the item page.
  const o = suggestOffers({ low: 1_000_000, high: 1_050_000 })!;
  const prose = GUIDES.find((g) => g.slug === 'what-price-to-offer')!
    .sections.find((s) => s.heading === 'A worked example')!.body.join(' ');

  eq('tax', o.tax, 21_000);
  eq('margin', o.margin, 29_000);
  eq('max buy', o.maxBuy, 1_028_999);
  eq('min sell', o.minSell, 1_020_409);
  eq('overbid room', o.overbidRoom, 28_999);
  eq('undercut room', o.undercutRoom, 29_591);

  for (const n of [o.tax, o.margin, o.maxBuy, o.minSell, o.overbidRoom, o.undercutRoom]) {
    ok(`the guide prints ${n.toLocaleString('en-US')}`,
      prose.includes(n.toLocaleString('en-US')));
  }
  ok('and says the two ranges overlap here', prose.includes('overlap'));
}

console.log('\nThe footer reaches the pages people look for');
{
  // FOOTER_LINKS is `as const`, so widen before searching it.
  const hrefs: string[] = FOOTER_LINKS.map((l: { href: string }) => l.href);
  for (const need of ['/about', '/contact', '/privacy', '/terms']) {
    ok(`footer links ${need}`, hrefs.includes(need));
  }
  eq('no duplicate footer links', hrefs.length - new Set(hrefs).size, 0);
  ok('guides is in the main nav', NAV.some((n) => n.href === '/guides' && n.public));
}

console.log('\nItem descriptions say something true about THIS item');
{
  const whip = itemBlurb({
    name: 'Abyssal whip',
    members: true,
    buyLimit: 70,
    highalch: 72_000,
    value: 120_001,
    low: 1_540_000,
    high: 1_600_000,
    hourlyVolume: 400,
    natureRune: 95,
  });
  ok('it says something', whip.length >= 3, `${whip.length} sentences`);
  ok('names the item', whip[0].startsWith('Abyssal whip'));
  ok('says members-only', whip[0].includes('members-only'));
  ok('and does not say "item" twice in one sentence',
    (whip[0].match(/\bitem\b/g) ?? []).length <= 1, whip[0]);
  ok('mentions the buy limit', whip.some((l) => l.includes('70')));

  // 400 an hour is NOT busy. Promising a quick fill there is bad advice,
  // and the first version did exactly that at anything over 100.
  ok('does not promise a quick fill on a quiet book',
    !whip.some((l) => l.includes('without a long wait')),
    whip.find((l) => l.includes('traded')) ?? '');

  const cannonball = itemBlurb({
    name: 'Cannonball',
    members: true,
    buyLimit: 13_000,
    highalch: 3,
    value: 5,
    low: 183,
    high: 187,
    hourlyVolume: 420_000,
    natureRune: 95,
  });
  ok('a genuinely busy book does get the quick-fill line',
    cannonball.some((l) => l.includes('without a long wait')));
  ok('and is described as heavily traded',
    cannonball.some((l) => l.includes('most heavily traded')));
}

console.log('\nAnd degrades honestly when a fact is missing');
{
  const bare = itemBlurb({
    name: 'Unknown thing',
    members: false,
    buyLimit: null,
    highalch: null,
    value: null,
    low: null,
    high: null,
    hourlyVolume: null,
    natureRune: null,
  });
  ok('still produces something', bare.length >= 2);
  ok('no "null" anywhere', !bare.join(' ').includes('null'), bare.join(' '));
  ok('no "undefined" anywhere', !bare.join(' ').includes('undefined'));
  ok('no "NaN" anywhere', !bare.join(' ').includes('NaN'));
  ok('says the volume is unknown rather than zero',
    bare.some((l) => l.includes('no volume to judge it by')));
  ok('says it is free-to-play', bare[0].includes('free-to-play'));

  // Every sentence must be a sentence.
  for (const line of bare) ok(`"${line.slice(0, 40)}…" ends properly`, /[.!?]$/.test(line.trim()));
}

console.log('\nThe word-pictures match the numbers');
{
  eq('no volume has no description', liquidity(null), null);
  eq('zero volume has no description', liquidity(0), null);
  eq('5 an hour is barely traded', liquidity(5), 'barely traded');
  eq('400 an hour is moderate', liquidity(400), 'traded in moderate numbers');
  eq('420k an hour is the top band', liquidity(420_000), 'one of the most heavily traded items in the game');

  eq('no price has no band', priceBand(null), null);
  eq('zero is not a price', priceBand(0), null);
  eq('183gp is low-value', priceBand(183), 'a low-value item');
  eq('1.54m is mid-priced', priceBand(1_540_000), 'a mid-priced item');
  eq('8.5b is the top band', priceBand(8_578_000_000), 'one of the most expensive items in the game');

  // Monotonic: more volume must never be described as quieter.
  const order = ['barely traded', 'thinly traded', 'traded in moderate numbers', 'traded steadily',
    'very heavily traded', 'one of the most heavily traded items in the game'];
  let worse = 0;
  let prev = -1;
  for (let v = 1; v < 5_000_000; v = Math.ceil(v * 1.5)) {
    const r = order.indexOf(liquidity(v)!);
    if (r < prev) worse++;
    prev = r;
  }
  eq('a busier book never reads as quieter', worse, 0);
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
