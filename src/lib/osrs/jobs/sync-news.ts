/**
 * Pull the official news feed.
 *
 * Headlines and links. Nothing reprints Jagex's article text — a tracker
 * that does is taking their content rather than pointing at it.
 *
 * Runs on a slow cadence because the feed is a trickle: a handful of posts
 * a week, and nobody needs them within five minutes. The sync is an upsert
 * keyed on the feed's own id, so re-reading the same headline updates it in
 * place rather than posting it again — which also means a corrected title
 * on Jagex's side reaches us without creating a duplicate.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { parseFeed, feedUrl } from '@/lib/osrs/news-feed';
import type { JobResult } from '@/lib/osrs/jobs/util';

function userAgent(): string {
  const contact = process.env.OSRS_CONTACT ?? 'contact-not-configured';
  return `rspill-osrs-tracker/0.1 (hobby project; ${contact})`;
}

export async function syncNews(now: Date = new Date()): Promise<JobResult> {
  const url = feedUrl();

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  let xml: string;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: controller.signal,
    });
    if (!res.ok) {
      // Reported rather than thrown. A feed being down is not an outage of
      // this site, and the run log records what happened either way.
      return { skipped: true, reason: `feed returned ${res.status}`, url };
    }
    xml = await res.text();
  } catch (e) {
    return { skipped: true, reason: `feed unreachable: ${String(e).slice(0, 120)}`, url };
  } finally {
    clearTimeout(timer);
  }

  const items = parseFeed(xml);

  // Nothing parsed from a document that did arrive means the feed is not
  // the shape we expect — most likely the URL is wrong. Worth saying so
  // plainly, because the alternative is an empty news panel that looks
  // like "no news lately".
  if (items.length === 0) {
    return { fetched: 0, stored: 0, bytes: xml.length, url, warning: 'feed parsed to no items' };
  }

  let stored = 0;
  for (const i of items) {
    try {
      await db.execute(sql`
        insert into osrs_news (source, title, url, external_id, published_at, published)
        values ('jagex', ${i.title}, ${i.url}, ${i.externalId},
                ${i.publishedAt ?? now}, true)
        on conflict (source, external_id) where external_id is not null
        do update set title = excluded.title,
                      url = excluded.url,
                      updated_at = now()
      `);
      stored++;
    } catch {
      // One bad row must not cost the rest of the feed, the same reasoning
      // as the price insert.
    }
  }

  return { fetched: items.length, stored, url };
}
