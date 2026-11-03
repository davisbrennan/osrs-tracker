/**
 * ads.txt — the IAB authorised-sellers file.
 *
 * Without this at the domain root, AdSense flags the account "Earnings at
 * risk — one or more of your sites does not have an ads.txt file", and
 * buyers that honour the standard will not bid on inventory they cannot
 * verify. It is one line and it is the difference between serving ads and
 * serving blanks.
 *
 * A route handler rather than a file in public/, because this project has
 * no public/ directory — robots and the sitemap are generated the same way,
 * and a second mechanism for one static line is not worth it. It also means
 * the publisher id has exactly one home, in lib/site.ts.
 *
 * The trailing field is Google's certification authority id, a fixed
 * constant for every AdSense publisher rather than anything specific to
 * this account.
 */

import { ADSENSE } from '@/lib/site';

const GOOGLE_CERTIFICATION_AUTHORITY_ID = 'f08c47fec0942fa0';

/** Static: the contents never vary by request. */
export const dynamic = 'force-static';

export function GET(): Response {
  const body = `google.com, ${ADSENSE.publisherId}, DIRECT, ${GOOGLE_CERTIFICATION_AUTHORITY_ID}\n`;
  return new Response(body, {
    headers: {
      'content-type': 'text/plain; charset=utf-8',
      // Crawled rarely and changed almost never.
      'cache-control': 'public, max-age=86400',
    },
  });
}
