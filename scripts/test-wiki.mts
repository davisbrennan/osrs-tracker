/**
 * Parsing the wiki's extracts API.
 *
 * This file carries more weight than usual. The sandbox this was built in
 * cannot reach the wiki, so the parser was written against the documented
 * response shape rather than against a live call — which is exactly when a
 * parser should be strict about what it accepts and forgiving about what it
 * does with surprises.
 *
 * So both format versions are covered, because the docs and the deployed
 * MediaWiki do not always agree on which one you get; title normalisation
 * and redirects are covered, because "Whip" and "abyssal whip" both have to
 * find the same article; and malformed payloads are covered, because an
 * upstream change should leave item pages working without a description
 * rather than throwing on render.
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
  parseExtracts,
  firstSentences,
  articleUrl,
  buildExtractsUrl,
  titleBatches,
  WIKI_LICENCE,
} = await import('@/lib/osrs/wiki');

const WHIP_TEXT =
  'The abyssal whip is a one-handed Melee weapon requiring 70 Attack to wield. ' +
  'It is a popular weapon due to its high accuracy and attack speed. ' +
  'It is obtained as a drop from abyssal demons. ' +
  'The whip can be upgraded with an abyssal tentacle. ' +
  'A fifth sentence that should be cut.';

console.log('--- formatversion=2: pages is an array ---');
{
  const payload = {
    batchcomplete: true,
    query: {
      pages: [{ pageid: 1234, ns: 0, title: 'Abyssal whip', extract: WHIP_TEXT }],
    },
  };
  const out = parseExtracts(payload, ['Abyssal whip']);
  const e = out.get('Abyssal whip');
  ok('found the entry', e !== null && e !== undefined);
  eq('title', e!.title, 'Abyssal whip');
  eq('page id', e!.pageId, 1234);
  eq('url', e!.url, 'https://oldschool.runescape.wiki/w/Abyssal_whip');
  ok('summary is trimmed to four sentences', !e!.summary.includes('fifth sentence'));
  ok('and keeps the first', e!.summary.startsWith('The abyssal whip is a one-handed'));
}

console.log('--- legacy format: pages is an object keyed by page id ---');
{
  const payload = {
    query: {
      pages: {
        '1234': { pageid: 1234, ns: 0, title: 'Abyssal whip', extract: WHIP_TEXT },
      },
    },
  };
  const e = parseExtracts(payload, ['Abyssal whip']).get('Abyssal whip');
  ok('parsed the same way', e !== null && e !== undefined);
  eq('same title', e!.title, 'Abyssal whip');
  eq('same page id', e!.pageId, 1234);
}

console.log('--- a normalised title still maps back to what we asked for ---');
{
  const payload = {
    query: {
      normalized: [{ from: 'abyssal whip', to: 'Abyssal whip' }],
      pages: [{ pageid: 1234, title: 'Abyssal whip', extract: WHIP_TEXT }],
    },
  };
  const out = parseExtracts(payload, ['abyssal whip']);
  ok('keyed by the title we sent', out.get('abyssal whip') !== null);
  eq('but reports the real article', out.get('abyssal whip')!.title, 'Abyssal whip');
}

console.log('--- a redirect is followed ---');
{
  const payload = {
    query: {
      redirects: [{ from: 'Whip', to: 'Abyssal whip' }],
      pages: [{ pageid: 1234, title: 'Abyssal whip', extract: WHIP_TEXT }],
    },
  };
  eq('resolves to the target', parseExtracts(payload, ['Whip']).get('Whip')!.title, 'Abyssal whip');
}

console.log('--- normalisation then redirect, chained ---');
{
  const payload = {
    query: {
      normalized: [{ from: 'whip', to: 'Whip' }],
      redirects: [{ from: 'Whip', to: 'Abyssal whip' }],
      pages: [{ pageid: 1234, title: 'Abyssal whip', extract: WHIP_TEXT }],
    },
  };
  const e = parseExtracts(payload, ['whip']).get('whip');
  ok('both hops followed', e !== null && e !== undefined);
  eq('landing on the article', e!.title, 'Abyssal whip');
}

console.log('--- a missing article is null, not an empty description ---');
{
  const fv2 = { query: { pages: [{ ns: 0, title: 'Nonexistent thing', missing: true }] } };
  eq('formatversion 2', parseExtracts(fv2, ['Nonexistent thing']).get('Nonexistent thing'), null);

  // The legacy format uses an empty string for `missing`, which is falsy —
  // so presence, not truthiness, has to be the test.
  const legacy = { query: { pages: { '-1': { ns: 0, title: 'Nonexistent thing', missing: '' } } } };
  eq(
    'legacy empty-string missing is still a miss',
    parseExtracts(legacy, ['Nonexistent thing']).get('Nonexistent thing'),
    null
  );
}

console.log('--- an invalid title is a miss too ---');
{
  const payload = { query: { pages: [{ title: 'Bad|title', invalid: true }] } };
  eq('invalid', parseExtracts(payload, ['Bad|title']).get('Bad|title'), null);
}

console.log('--- a page with no extract is a miss, not an empty string ---');
{
  const payload = { query: { pages: [{ pageid: 7, title: 'Thing' }] } };
  eq('no extract', parseExtracts(payload, ['Thing']), new Map([['Thing', null]]));

  const blank = { query: { pages: [{ pageid: 7, title: 'Thing', extract: '   ' }] } };
  eq('whitespace extract', parseExtracts(blank, ['Thing']).get('Thing'), null);
}

console.log('--- every requested title is accounted for ---');
{
  const payload = {
    query: {
      pages: [
        { pageid: 1, title: 'Abyssal whip', extract: WHIP_TEXT },
        { ns: 0, title: 'Ghost item', missing: true },
      ],
    },
  };
  const out = parseExtracts(payload, ['Abyssal whip', 'Ghost item', 'Never mentioned']);
  eq('three keys back for three asked', out.size, 3);
  ok('the hit is a hit', out.get('Abyssal whip') !== null);
  eq('the miss is null', out.get('Ghost item'), null);
  eq('and one the API ignored is null too', out.get('Never mentioned'), null);
}

console.log('--- malformed payloads degrade, they do not throw ---');
{
  for (const [label, payload] of [
    ['null', null],
    ['a string', 'not json'],
    ['an empty object', {}],
    ['query missing', { batchcomplete: true }],
    ['query not an object', { query: 42 }],
    ['pages missing', { query: {} }],
    ['pages the wrong type', { query: { pages: 'nope' } }],
    ['normalized the wrong type', { query: { normalized: 'nope', pages: [] } }],
    ['a page that is not an object', { query: { pages: [null, 5, 'x'] } }],
  ] as const) {
    let threw = false;
    let size = -1;
    try {
      size = parseExtracts(payload, ['Abyssal whip']).size;
    } catch {
      threw = true;
    }
    ok(`${label} does not throw`, !threw);
    eq(`  and still answers for the title`, size, 1);
  }
}

console.log('--- a redirect loop terminates ---');
{
  const payload = {
    query: {
      redirects: [
        { from: 'A', to: 'B' },
        { from: 'B', to: 'A' },
      ],
      pages: [{ pageid: 1, title: 'A', extract: 'Text.' }],
    },
  };
  let threw = false;
  try {
    parseExtracts(payload, ['A']);
  } catch {
    threw = true;
  }
  ok('no infinite loop', !threw);
}

console.log('--- sentence trimming ---');
{
  eq('keeps n sentences', firstSentences('One. Two. Three. Four. Five.', 2), 'One. Two.');
  eq('collapses whitespace', firstSentences('One.\n\n  Two.', 2), 'One. Two.');
  eq('short text is returned whole', firstSentences('Only one.', 4), 'Only one.');
  eq('empty is empty', firstSentences('   ', 4), '');
  ok(
    'does not split on a decimal',
    firstSentences('It costs 1.5m coins to buy. Then more.', 1) ===
      'It costs 1.5m coins to buy.'
  );
  ok(
    'does not cut mid-sentence when there is no terminator',
    firstSentences('No terminator here', 1) === 'No terminator here'
  );
}

console.log('--- article URLs ---');
{
  eq('spaces become underscores', articleUrl('Abyssal whip'), 'https://oldschool.runescape.wiki/w/Abyssal_whip');
  eq(
    'a slash is escaped so it cannot change the path',
    articleUrl('Grand Exchange/Buying limits'),
    'https://oldschool.runescape.wiki/w/Grand_Exchange%2FBuying_limits'
  );
  ok('parentheses survive', articleUrl('Saradomin brew(4)').endsWith('Saradomin_brew(4)'));
}

console.log('--- the request we build ---');
{
  const url = buildExtractsUrl(['Abyssal whip', 'Nature rune']);
  ok('hits the wiki api', url.startsWith('https://oldschool.runescape.wiki/api.php?'));
  for (const bit of [
    'action=query',
    'prop=extracts',
    'exintro=1',
    'explaintext=1',
    'redirects=1',
    'formatversion=2',
  ]) {
    ok(`carries ${bit}`, url.includes(bit));
  }
  // URLSearchParams encodes a space as `+` and the pipe as %7C. MediaWiki
  // decodes both, so this is correct — it just is not the literal string.
  ok('titles are pipe-joined', url.includes('titles=Abyssal+whip%7CNature+rune'));
  eq(
    'and decode back to the titles we asked for',
    new URL(url).searchParams.get('titles'),
    'Abyssal whip|Nature rune'
  );
}

console.log('--- batching ---');
{
  const titles = Array.from({ length: 45 }, (_, i) => `Item ${i}`);
  const batches = titleBatches(titles, 20);
  eq('three batches', batches.length, 3);
  eq('full, full, remainder', batches.map((b) => b.length), [20, 20, 5]);
  eq('nothing lost', batches.flat().length, 45);
  eq('nothing to batch', titleBatches([], 20).length, 0);
}

console.log('--- the licence we must display ---');
{
  eq('is the non-commercial one', WIKI_LICENCE.name, 'CC BY-NC-SA 3.0');
  ok('with a link', WIKI_LICENCE.url.startsWith('https://creativecommons.org/'));
}

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
