/**
 * JSON-LD, for the search results rather than the page.
 *
 * Three pieces of it earn their place here, and nothing else does:
 *
 *  - WEBSITE with a search action, so Google can offer a search box for the
 *    site directly in its results.
 *  - FAQPAGE on the landing page. The questions there are real ones people
 *    type into a search bar — how the Grand Exchange tax works, where the
 *    prices come from — and marked up they can answer those searches
 *    directly.
 *  - PRODUCT with an OFFER on each item page, which is what makes "abyssal
 *    whip price" show a price in the result rather than a blue link.
 *
 * Everything emitted here has to be visible on the page it describes.
 * Marking up a price that is not shown, or an FAQ answer that is not there,
 * is what structured-data penalties are for — so every builder below takes
 * the same values the page renders rather than fetching its own.
 */

import { SITE } from '@/lib/site';

type Json = Record<string, unknown>;

/**
 * Entries to put in an ITEMLIST.
 *
 * Enough to show a crawler what the page is a list of, short of dumping a
 * hundred rows of markup into the head for no gain.
 */
export const SCHEMA_ITEMS = 20;

/** The site itself, plus the search box Google may surface. */
export function websiteSchema(): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: SITE.name,
    alternateName: SITE.longName,
    url: SITE.url,
    description: SITE.description,
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: `${SITE.url}/items?q={search_term_string}`,
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function faqSchema(items: { q: string; a: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(({ q, a }) => ({
      '@type': 'Question',
      name: q,
      acceptedAnswer: { '@type': 'Answer', text: a },
    })),
  };
}

/**
 * A ranked index page — the flip finder, Unusual, Money makers.
 *
 * ITEMLIST is honest here in a way it often is not: these pages really are
 * an ordered list, and the order is the content. The entries carry only the
 * name, position and URL — not the price. A price in the markup that is
 * recalculated every few minutes on the page is a promise the crawl cannot
 * keep, and the per-item PRODUCT schema already states it where it is stable
 * enough to mean something.
 */
export function collectionSchema(opts: {
  name: string;
  description: string;
  path: string;
  /** A URL only where the entry has a page of its own; a list of identical
   *  URLs is worse than no URLs. */
  items: { name: string; url?: string }[];
}): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'CollectionPage',
    name: opts.name,
    description: opts.description,
    url: `${SITE.url}${opts.path}`,
    mainEntity: {
      '@type': 'ItemList',
      numberOfItems: opts.items.length,
      itemListOrder: 'https://schema.org/ItemListOrderDescending',
      itemListElement: opts.items.map((item, i) => ({
        '@type': 'ListItem',
        position: i + 1,
        name: item.name,
        ...(item.url ? { url: item.url } : {}),
      })),
    },
  };
}

export function breadcrumbSchema(trail: { name: string; url: string }[]): Json {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: trail.map((step, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: step.name,
      item: step.url,
    })),
  };
}

/**
 * One tradeable item.
 *
 * The price quoted is the BUY price — what it costs to acquire, which is
 * what someone searching "abyssal whip price" means. Priced in a currency
 * that does not exist, so `priceCurrency` is the in-game coin; there is no
 * ISO code for gp and inventing one would be worse than being plain about
 * it. Availability is left off rather than guessed: an item trading on the
 * Grand Exchange is not "in stock" in the sense the vocabulary means.
 */
export function itemSchema(opts: {
  id: number;
  name: string;
  description: string | null;
  buyPrice: number | null;
  members: boolean;
}): Json {
  const schema: Json = {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: opts.name,
    url: `${SITE.url}/item/${opts.id}`,
    category: opts.members ? 'Old School RuneScape members item' : 'Old School RuneScape item',
    ...(opts.description ? { description: opts.description } : {}),
  };

  if (opts.buyPrice !== null) {
    schema.offers = {
      '@type': 'Offer',
      price: opts.buyPrice,
      priceCurrency: 'GP',
      url: `${SITE.url}/item/${opts.id}`,
      seller: { '@type': 'Organization', name: 'Grand Exchange' },
    };
  }

  return schema;
}

/**
 * Render as a script tag.
 *
 * `JSON.stringify` escapes nothing that matters inside a script element
 * except a literal `</script>` appearing in a string — an item name or a
 * wiki description could in principle contain one — so the closing angle
 * bracket is escaped. The result is still valid JSON to a parser.
 */
export function jsonLdProps(schema: Json | Json[]) {
  return {
    type: 'application/ld+json',
    dangerouslySetInnerHTML: {
      __html: JSON.stringify(schema).replace(/</g, '\\u003c'),
    },
  } as const;
}
