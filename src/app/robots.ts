import type { MetadataRoute } from 'next';
import { SITE, NOINDEX_PATHS } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      // The flip finder and item pages are the point of being indexed, so
      // everything is allowed except what sits behind sign-in.
      allow: '/',
      disallow: [...NOINDEX_PATHS],
    },
    sitemap: `${SITE.url}/sitemap.xml`,
    host: SITE.url,
  };
}
