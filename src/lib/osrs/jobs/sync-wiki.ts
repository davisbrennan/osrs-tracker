/**
 * Fill in item descriptions from the OSRS Wiki.
 *
 * Deliberately slow and small. There are ~4,000 tradeable items and the wiki
 * is run by volunteers who ask consumers to be reasonable, so this takes a
 * budgeted slice per run rather than sweeping the catalogue: a few batched
 * requests, a pause between them, and it stops. At the default budget the
 * whole catalogue fills in over a few days and then essentially never runs
 * again, because descriptions almost never change.
 *
 * Priority is "what will someone actually open": the items that trade. An
 * item nobody has ever looked up can wait indefinitely.
 *
 * See lib/osrs/wiki.ts for the licensing this text arrives under.
 */

import { sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';
import { osrsItemWiki } from '@/database/schema';
import { fetchWikiSummaries } from '@/lib/osrs/api';
import { titleBatches, TITLES_PER_REQUEST, type WikiEntry } from '@/lib/osrs/wiki';
import { sleep, type JobResult } from '@/lib/osrs/jobs/util';

/** Items per run. Four requests at the default batch size. */
const ITEMS_PER_RUN = 80;

/** Pause between requests, so a run is a trickle and not a burst. */
const PAUSE_MS = 1_200;

/** Re-check a description we already have after this long. */
const REFRESH_AFTER_DAYS = 90;

/**
 * Items most worth describing next.
 *
 * Never fetched at all comes first, ordered by how heavily the item trades,
 * because that is a good proxy for whether a human will open its page. Then
 * anything stale. Known misses are excluded entirely — if the wiki has no
 * article for "Dwarf remains", asking again tomorrow will not change that.
 */
async function dueForFetch(limit: number): Promise<{ id: number; name: string }[]> {
  const rows = await db.execute<{ id: number; name: string }>(sql`
    SELECT i.id, i.name
    FROM osrs_items i
    LEFT JOIN osrs_item_wiki w ON w.item_id = i.id
    LEFT JOIN osrs_prices p ON p.item_id = i.id
    WHERE w.item_id IS NULL
       OR (w.missing = false
           AND w.fetched_at < now() - ${sql.raw(`interval '${REFRESH_AFTER_DAYS} days'`)})
    ORDER BY
      (w.item_id IS NOT NULL),              -- never fetched first
      COALESCE(p.hourly_volume, 0) DESC,    -- then whatever actually trades
      i.id
    LIMIT ${limit}
  `);
  return rowsOf<{ id: number; name: string }>(rows);
}

export async function syncWiki(budget = ITEMS_PER_RUN): Promise<JobResult> {
  const due = await dueForFetch(budget);
  if (due.length === 0) return { fetched: 0, written: 0, note: 'nothing due' };

  const byName = new Map<string, number>();
  for (const row of due) {
    // Two items can share a name across variants; first one wins, the other
    // comes round on a later run.
    if (!byName.has(row.name)) byName.set(row.name, row.id);
  }

  let found = 0;
  let missing = 0;
  const now = new Date();
  const values: (typeof osrsItemWiki.$inferInsert)[] = [];

  const batches = titleBatches([...byName.keys()], TITLES_PER_REQUEST);
  for (const [i, batch] of batches.entries()) {
    if (i > 0) await sleep(PAUSE_MS);

    let results: Map<string, WikiEntry | null>;
    try {
      results = await fetchWikiSummaries(batch);
    } catch {
      // A failed batch is not a failed run. The rows simply stay due, and
      // the next run picks them up — which is also what makes this safe to
      // schedule frequently without worrying about partial failure.
      continue;
    }

    for (const [name, entry] of results) {
      const itemId = byName.get(name);
      if (itemId === undefined) continue;

      if (entry === null) {
        missing++;
        values.push({ itemId, missing: true, fetchedAt: now });
      } else {
        found++;
        values.push({
          itemId,
          title: entry.title,
          pageId: entry.pageId,
          summary: entry.summary,
          url: entry.url,
          missing: false,
          fetchedAt: now,
        });
      }
    }
  }

  if (values.length > 0) {
    await db
      .insert(osrsItemWiki)
      .values(values)
      .onConflictDoUpdate({
        target: osrsItemWiki.itemId,
        set: {
          title: sql`excluded.title`,
          pageId: sql`excluded.page_id`,
          summary: sql`excluded.summary`,
          url: sql`excluded.url`,
          missing: sql`excluded.missing`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });
  }

  return { due: due.length, requested: byName.size, found, missing, written: values.length };
}
