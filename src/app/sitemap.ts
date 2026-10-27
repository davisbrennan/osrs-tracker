import type { MetadataRoute } from 'next';
import { SITE } from '@/lib/site';

/**
 * Static pages only, for now.
 *
 * Per-item pages are the eventual SEO draw — a page per tradeable item with
 * its chart and live margin is the thing that gets found — but listing URLs
 * before the route exists just feeds crawlers 404s. They get added here in
 * the same change that builds /item/[id], ordered by trade volume and capped,
 * since a sitemap stuffed with thousands of thin pages is a liability rather
 * than an asset.
 */
const PAGES = ['', '/flips', '/items', '/privacy', '/terms'];

export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return PAGES.map((path) => ({
    url: `${SITE.url}${path}`,
    lastModified: now,
    changeFrequency: path === '' || path === '/flips' ? 'daily' : 'monthly',
    priority: path === '' ? 1 : path === '/flips' ? 0.9 : 0.6,
  }));
}
