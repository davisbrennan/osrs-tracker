/**
 * Structured data.
 *
 * The failure mode here is unusual: bad JSON-LD does not break the page.
 * Nothing renders differently, no error appears, and the site looks fine for
 * months while every rich result quietly fails to appear. So the things
 * worth asserting are the ones no screenshot would catch — that the JSON
 * parses at all, that a price of zero is not dropped as falsy, and that a
 * hostile item name cannot close the script tag it is sitting inside.
 */

const {
  websiteSchema,
  faqSchema,
  breadcrumbSchema,
  collectionSchema,
  itemSchema,
  jsonLdProps,
  SCHEMA_ITEMS,
} = await import('@/lib/structured-data');

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

/** What a browser does with the script tag's contents. */
const rendered = (schema: Record<string, unknown> | Record<string, unknown>[]) =>
  JSON.parse(jsonLdProps(schema).dangerouslySetInnerHTML.__html);

console.log('\nEverything parses, and carries a @context');
{
  const all: Record<string, Record<string, unknown>> = {
    website: websiteSchema(),
    faq: faqSchema([{ q: 'How does the tax work?', a: 'Two percent of the sale.' }]),
    breadcrumb: breadcrumbSchema([{ name: 'Items', url: 'https://x/items' }]),
    collection: collectionSchema({
      name: 'Flips',
      description: 'd',
      path: '/flips',
      items: [{ name: 'Rune scimitar', url: 'https://x/item/1' }],
    }),
    item: itemSchema({ id: 1, name: 'Rune scimitar', description: null, buyPrice: 10, members: false }),
  };
  for (const [name, schema] of Object.entries(all)) {
    let parsed: Record<string, unknown> | null = null;
    try {
      parsed = rendered(schema) as Record<string, unknown>;
    } catch (e) {
      parsed = null;
      console.log(`    ${name} threw: ${String(e)}`);
    }
    ok(`${name} parses`, parsed !== null);
    ok(`${name} has @context`, parsed?.['@context'] === 'https://schema.org');
    ok(`${name} has @type`, typeof parsed?.['@type'] === 'string');
  }
}

console.log('\nAn item name cannot break out of the script tag');
{
  const html = jsonLdProps(
    itemSchema({
      id: 7,
      name: 'Evil </script><script>alert(1)</script> whip',
      description: 'Also </SCRIPT> nasty',
      buyPrice: 1,
      members: true,
    })
  ).dangerouslySetInnerHTML.__html;

  ok('no literal "</" survives', !html.includes('</'), html.slice(0, 40));
  ok('no "<" at all survives', !html.includes('<'));
  ok('escaped as \\u003c', html.includes('\\u003c'));
  // The whole point: it is escaped for HTML but still valid JSON, so the
  // name arrives intact rather than mangled.
  const parsed = JSON.parse(html) as { name: string };
  eq('name round-trips intact', parsed.name, 'Evil </script><script>alert(1)</script> whip');
}

console.log('\nAn offer is omitted, not faked, when there is no price');
{
  const unpriced = itemSchema({ id: 2, name: 'Nothing', description: null, buyPrice: null, members: false });
  ok('no offers key at all', !('offers' in unpriced));

  // A free item is a real thing in OSRS and 0 is falsy, so this is the
  // branch a truthiness check would silently drop.
  const free = itemSchema({ id: 3, name: 'Free', description: null, buyPrice: 0, members: false }) as {
    offers?: { price?: number };
  };
  ok('a price of 0 still emits an offer', free.offers !== undefined);
  eq('and the price is 0, not absent', free.offers?.price, 0);
}

console.log('\nA description is omitted rather than emitted as null');
{
  const none = itemSchema({ id: 4, name: 'X', description: null, buyPrice: 1, members: false });
  ok('no description key', !('description' in none));
  const some = itemSchema({ id: 5, name: 'X', description: 'A sword.', buyPrice: 1, members: false });
  eq('description present when given', (some as { description?: string }).description, 'A sword.');
}

console.log('\nMembers status reaches the category');
{
  const m = itemSchema({ id: 6, name: 'X', description: null, buyPrice: 1, members: true }) as {
    category: string;
  };
  const f = itemSchema({ id: 6, name: 'X', description: null, buyPrice: 1, members: false }) as {
    category: string;
  };
  ok('members item says so', m.category.includes('members'));
  ok('free item does not', !f.category.includes('members'));
}

console.log('\nBreadcrumb positions are 1-based and in order');
{
  const b = breadcrumbSchema([
    { name: 'Items', url: 'https://x/items' },
    { name: 'Rune scimitar', url: 'https://x/item/1' },
  ]) as { itemListElement: { position: number; name: string }[] };
  eq('positions', b.itemListElement.map((e) => e.position), [1, 2]);
  eq('names in order', b.itemListElement.map((e) => e.name), ['Items', 'Rune scimitar']);
}

console.log('\nItemList entries carry a URL only when they have one');
{
  const withUrls = collectionSchema({
    name: 'Flips',
    description: 'd',
    path: '/flips',
    items: [
      { name: 'A', url: 'https://x/item/1' },
      { name: 'B', url: 'https://x/item/2' },
    ],
  }) as { mainEntity: { numberOfItems: number; itemListElement: { url?: string }[] } };
  eq('numberOfItems matches', withUrls.mainEntity.numberOfItems, 2);
  ok('urls present', withUrls.mainEntity.itemListElement.every((e) => typeof e.url === 'string'));

  // Money makers are rows, not pages. Twenty ListItems all pointing at
  // /money would be worse than none.
  const noUrls = collectionSchema({
    name: 'Money makers',
    description: 'd',
    path: '/money',
    items: [{ name: 'Making magic potions' }, { name: 'Cleaning herbs' }],
  }) as { mainEntity: { itemListElement: Record<string, unknown>[] } };
  ok('no url key when none given', noUrls.mainEntity.itemListElement.every((e) => !('url' in e)));
  ok('still named', noUrls.mainEntity.itemListElement.every((e) => typeof e.name === 'string'));
}

console.log('\nThe search action points at a page that takes a query');
{
  const w = websiteSchema() as {
    potentialAction: { target: { urlTemplate: string }; 'query-input': string };
  };
  const t = w.potentialAction.target.urlTemplate;
  ok('template has the placeholder', t.includes('{search_term_string}'));
  ok('query-input names the same variable', w.potentialAction['query-input'].includes('search_term_string'));
  // /items is the page whose ?q= actually filters. Pointing this at a page
  // that ignores the parameter yields a search box that does nothing.
  ok('aimed at /items?q=', t.includes('/items?q='), t);
}

console.log('\nFAQ answers survive as answers');
{
  const f = faqSchema([
    { q: 'Q1', a: 'A1' },
    { q: 'Q2', a: 'A2' },
  ]) as { mainEntity: { name: string; acceptedAnswer: { text: string } }[] };
  eq('two questions', f.mainEntity.length, 2);
  eq('question text', f.mainEntity[0].name, 'Q1');
  eq('answer text', f.mainEntity[1].acceptedAnswer.text, 'A2');
  ok('each has an accepted answer', f.mainEntity.every((e) => e.acceptedAnswer.text.length > 0));
}

console.log('\nAn array of schemas renders as a JSON array');
{
  const arr = rendered([websiteSchema(), faqSchema([{ q: 'a', a: 'b' }])]) as unknown[];
  ok('is an array', Array.isArray(arr));
  eq('of two', arr.length, 2);
  eq(
    'types',
    (arr as { '@type': string }[]).map((s) => s['@type']),
    ['WebSite', 'FAQPage']
  );
}

console.log('\nThe list cap is sane');
ok('SCHEMA_ITEMS is a small positive integer', Number.isInteger(SCHEMA_ITEMS) && SCHEMA_ITEMS > 0 && SCHEMA_ITEMS <= 50, String(SCHEMA_ITEMS));

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
