/**
 * The news feed parser.
 *
 * This is the only place in the app that takes arbitrary XML from someone
 * else and writes it to the database, so the tests that matter are the
 * hostile ones: a javascript: link, a title that is all entities, an item
 * with no link, a date from 2095.
 */

const {
  parseFeed,
  safeUrl,
  decodeEntities,
  tagText,
  feedUrl,
  DEFAULT_FEED_URL,
  MAX_FEED_ITEMS,
} = await import('@/lib/osrs/news-feed');

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

const rss = (items: string) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>News</title>${items}</channel></rss>`;

const item = (inner: string) => `<item>${inner}</item>`;

console.log('\nAn ordinary feed');
{
  const xml = rss(
    item(
      `<title>Sailing Beta Launch</title><link>https://secure.runescape.com/news/sailing</link><guid isPermaLink="false">news-9921</guid><pubDate>Mon, 26 Oct 2026 11:00:00 GMT</pubDate>`
    ) +
      item(
        `<title>Poll 84 Results</title><link>https://secure.runescape.com/news/poll-84</link><guid>news-9920</guid><pubDate>Thu, 22 Oct 2026 09:30:00 GMT</pubDate>`
      )
  );
  const items = parseFeed(xml);
  eq('two items', items.length, 2);
  eq('title', items[0].title, 'Sailing Beta Launch');
  eq('url', items[0].url, 'https://secure.runescape.com/news/sailing');
  eq('guid is the identity', items[0].externalId, 'news-9921');
  ok('date parsed', items[0].publishedAt instanceof Date);
  eq('to the right year', items[0].publishedAt?.getUTCFullYear(), 2026);
}

console.log('\nA javascript: link never reaches the database');
{
  // Stored XSS waiting for a click. The item is dropped entirely rather
  // than stored with a blanked href.
  const xml = rss(
    item(`<title>Click me</title><link>javascript:alert(1)</link><guid>x1</guid>`) +
      item(`<title>Fine</title><link>https://example.com/a</link><guid>x2</guid>`)
  );
  const items = parseFeed(xml);
  eq('only the safe one survives', items.length, 1);
  eq('and it is the right one', items[0].title, 'Fine');

  eq('javascript: refused', safeUrl('javascript:alert(1)'), null);
  eq('with whitespace too', safeUrl('  javascript:alert(1)  '), null);
  eq('data: refused', safeUrl('data:text/html,<script>'), null);
  eq('file: refused', safeUrl('file:///etc/passwd'), null);
  eq('nonsense refused', safeUrl('not a url'), null);
  eq('empty refused', safeUrl(''), null);
  eq('null refused', safeUrl(null), null);
  ok('https kept', safeUrl('https://example.com/x') === 'https://example.com/x');
  ok('http kept', safeUrl('http://example.com/x') === 'http://example.com/x');
}

console.log('\nEntities and CDATA are decoded');
{
  // "Sailing &amp; You" rendered literally is the tell that nobody looked.
  const xml = rss(
    item(`<title>Sailing &amp; You &#8212; part 2</title><link>https://e.com/1</link><guid>g1</guid>`) +
      item(`<title><![CDATA[Bonds & Trading]]></title><link>https://e.com/2</link><guid>g2</guid>`)
  );
  const items = parseFeed(xml);
  eq('named entity decoded', items[0].title, 'Sailing & You — part 2');
  eq('CDATA unwrapped', items[1].title, 'Bonds & Trading');

  eq('amp', decodeEntities('a &amp; b'), 'a & b');
  eq('lt and gt', decodeEntities('&lt;tag&gt;'), '<tag>');
  eq('numeric', decodeEntities('&#65;'), 'A');
  eq('hex', decodeEntities('&#x41;'), 'A');
  eq('unknown entities are left alone', decodeEntities('&bogus;'), '&bogus;');
  // An out-of-range code point throws if handed straight to fromCodePoint,
  // which would take down the whole sync over one bad character.
  eq('an impossible code point does not throw', decodeEntities('&#99999999;'), '');
}

console.log('\nHalf-formed items are dropped, not stored blank');
{
  const xml = rss(
    item(`<link>https://e.com/no-title</link><guid>a</guid>`) +
      item(`<title>No link</title><guid>b</guid>`) +
      item(`<title></title><link>https://e.com/empty</link><guid>c</guid>`) +
      item(`<title>Good</title><link>https://e.com/good</link><guid>d</guid>`)
  );
  const items = parseFeed(xml);
  eq('only the complete one', items.length, 1);
  eq('and it is the good one', items[0].title, 'Good');
}

console.log('\nIdentity, so the same headline is not posted twice');
{
  // No guid: the link has to serve, or every sync reposts everything.
  const noGuid = parseFeed(rss(item(`<title>T</title><link>https://e.com/z</link>`)));
  eq('falls back to the link', noGuid[0].externalId, 'https://e.com/z');

  // The same guid twice in one document is a feed bug; take it once.
  const dupes = parseFeed(
    rss(
      item(`<title>A</title><link>https://e.com/1</link><guid>same</guid>`) +
        item(`<title>B</title><link>https://e.com/2</link><guid>same</guid>`)
    )
  );
  eq('a repeated guid is taken once', dupes.length, 1);
}

console.log('\nDates that are not dates');
{
  const bad = parseFeed(
    rss(item(`<title>T</title><link>https://e.com/1</link><guid>g</guid><pubDate>sometime</pubDate>`))
  );
  // Null, not 1970 — an epoch date would pin the item to the bottom of the
  // feed forever and look deliberate.
  eq('unparseable → null', bad[0].publishedAt, null);

  const future = parseFeed(
    rss(
      item(
        `<title>T</title><link>https://e.com/1</link><guid>g</guid><pubDate>Mon, 01 Jan 2095 00:00:00 GMT</pubDate>`
      )
    )
  );
  // Otherwise it sits at the top of the feed until 2095.
  eq('a date from 2095 → null', future[0].publishedAt, null);

  const missing = parseFeed(rss(item(`<title>T</title><link>https://e.com/1</link><guid>g</guid>`)));
  eq('no date at all → null', missing[0].publishedAt, null);
}

console.log('\nAtom as well as RSS');
{
  const atom = `<?xml version="1.0"?><feed xmlns="http://www.w3.org/2005/Atom">
    <entry><title>Atom item</title><link href="https://e.com/atom"/><id>atom-1</id><updated>2026-10-30T10:00:00Z</updated></entry>
  </feed>`;
  const items = parseFeed(atom);
  eq('an entry is an item', items.length, 1);
  eq('href is the link', items[0].url, 'https://e.com/atom');
  eq('id is the identity', items[0].externalId, 'atom-1');
  ok('updated is the date', items[0].publishedAt?.getUTCFullYear() === 2026);
}

console.log('\nRubbish in does not throw');
{
  eq('empty string', parseFeed(''), []);
  eq('not xml', parseFeed('hello'), []);
  eq('empty channel', parseFeed(rss('')), []);
  eq('html instead of a feed', parseFeed('<html><body>404</body></html>'), []);
  ok('a truncated document does not throw', Array.isArray(parseFeed('<rss><channel><item><title>T')));
}

console.log('\nThe feed is a trickle, not a firehose');
{
  const many = rss(
    Array.from({ length: 50 }, (_, i) =>
      item(`<title>N${i}</title><link>https://e.com/${i}</link><guid>g${i}</guid>`)
    ).join('')
  );
  eq('capped', parseFeed(many).length, MAX_FEED_ITEMS);
  eq('and the cap is explicit', parseFeed(many, 3).length, 3);
}

console.log('\ntagText');
{
  eq('reads a tag', tagText('<a>hi</a>', 'a'), 'hi');
  eq('tolerates attributes', tagText('<a href="x">hi</a>', 'a'), 'hi');
  eq('collapses whitespace', tagText('<a>  hi\n  there </a>', 'a'), 'hi there');
  eq('missing tag → null', tagText('<a>hi</a>', 'b'), null);
  eq('empty tag → null', tagText('<a></a>', 'a'), null);
}

console.log('\nThe feed URL is configurable');
{
  // I could not verify the Old School variant from where this was written,
  // so it must be correctable without a release.
  delete process.env.OSRS_NEWS_FEED_URL;
  eq('defaults to the documented feed', feedUrl(), DEFAULT_FEED_URL);
  ok('which is the official host', DEFAULT_FEED_URL.includes('secure.runescape.com'));
  process.env.OSRS_NEWS_FEED_URL = 'https://example.com/custom.rss';
  eq('the env var wins', feedUrl(), 'https://example.com/custom.rss');
  delete process.env.OSRS_NEWS_FEED_URL;
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
