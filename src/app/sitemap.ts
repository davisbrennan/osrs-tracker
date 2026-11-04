import type { MetadataRoute } from 'next';
import { eq, and, isNotNull, gte, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { SITE } from '@/lib/site';
import { GUIDES } from '@/lib/guides';

/**
 * Static pages, then the item pages.
 *
 * The per-item pages are the whole SEO case: somebody searching "abyssal
 * whip price" wants a page with the live margin, the tax, the buy limit and
 * a chart, and that is exactly what /item/[id] is.
 *
 * Two filters, both deliberate. A sitemap is a statement that these URLs are
 * worth crawling, so listing thin ones spends crawl budget to say nothing:
 *
 *  - BOTH SIDES PRICED. An item with no current price renders an empty
 *    state. It is a real page and a useless search result.
 *  - SOME TRADING. An item nobody has traded in the last hour has no margin
 *    worth reading and will not be searched for either.
 *
 * Ordered by volume and capped, so if the catalogue ever outgrows the cap
 * the pages that make it in are the ones people actually look up.
 */

/** Well inside the 50,000-URL limit, and past where the long tail stops mattering. */
const MAX_ITEMS = 5000;

/** Below this an item is not really trading. */
const MIN_VOLUME = 1;

const PAGES = [
  '',
  '/flips',
  '/items',
  '/unusual',
  '/money',
  '/news',
  '/guides',
  '/about',
  '/contact',
  '/privacy',
  '/terms',
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();

  const statics: MetadataRoute.Sitemap = PAGES.map((path) => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    // The pages whose content moves with prices are worth recrawling daily;
    // the legal pages are not.
    changeFrequency: ['', '/flips', '/items', '/money', '/unusual', '/news'].includes(path)
      ? 'daily'
      : 'monthly',
    priority:
      path === ''
        ? 1
        : path === '/flips'
          ? 0.9
          : ['/items', '/money', '/unusual', '/news'].includes(path)
            ? 0.8
            : path === '/guides'
              ? 0.8
              : 0.6,
  }));

  // Guides are the site's only long-form content and change rarely, so they
  // get a real priority and a slow crawl frequency rather than being left
  // out of the sitemap the way static pages usually are.
  const guides: MetadataRoute.Sitemap = GUIDES.map((g) => ({
    url: `${SITE.url}/guides/${g.slug}`,
    lastModified: now,
    changeFrequency: 'monthly' as const,
    priority: 0.7,
  }));

  let items: MetadataRoute.Sitemap = [];
  try {
    const rows = await db
      .select({
        id: osrsItems.id,
        fetchedAt: osrsPrices.fetchedAt,
      })
      .from(osrsItems)
      .innerJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
      .where(
        and(
          isNotNull(osrsPrices.low),
          isNotNull(osrsPrices.high),
          gte(osrsPrices.hourlyVolume, MIN_VOLUME)
        )
      )
      .orderBy(desc(osrsPrices.hourlyVolume))
      .limit(MAX_ITEMS);

    items = rows.map((r) => ({
      url: `${SITE.url}/item/${r.id}`,
      // When the page's content last changed, which for an item is when its
      // price was last refreshed.
      lastModified: r.fetchedAt ?? now,
      changeFrequency: 'daily' as const,
      priority: 0.7,
    }));
  } catch {
    // A sitemap that 500s teaches crawlers the whole file is unreliable.
    // Falling back to the static pages keeps it valid and useful.
  }

  return [...statics, ...guides, ...items];
}
