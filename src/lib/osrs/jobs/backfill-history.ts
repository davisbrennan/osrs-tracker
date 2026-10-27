/**
 * Fetch the history we were not running to collect.
 *
 * Everything else here builds its own history an hour at a time, which means
 * a freshly deployed site has nothing to compare today against for weeks.
 * The wiki's timeseries endpoint already holds that past, and `fetchTimeseries`
 * was written and tested for it long before anything used it.
 *
 * Budgeted hard, for the same reason as the wiki descriptions: one request
 * per item, ~4,000 items, and a volunteer-run API. A slice per run, busiest
 * items first, with a pause between requests. Items people actually look at
 * get their history within hours; the long tail fills in over days.
 *
 * This only ever ADDS days that are missing. The daily rollup owns recent
 * days, and `ON CONFLICT DO NOTHING` means a backfilled bar never overwrites
 * one computed from our own hourly data, which is the better measurement.
 */

import { sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';
import { osrsPriceDaily } from '@/database/schema';
import { fetchTimeseries } from '@/lib/osrs/api';
import { HISTORY_RETENTION_DAYS } from '@/lib/osrs/jobs/sync-prices';
import { MIN_SAMPLE_DAYS } from '@/lib/osrs/stats';
import { sleep, type JobResult } from '@/lib/osrs/jobs/util';

/** Items per run. One request each. */
const ITEMS_PER_RUN = 40;

/** Pause between requests. */
const PAUSE_MS = 1_500;

/**
 * Items with too little history to say anything about.
 *
 * Ordered by how heavily they trade, because that is a good proxy for
 * whether anyone will open the page. An item nobody looks at can wait.
 */
async function itemsNeedingHistory(limit: number): Promise<{ id: number; bars: number }[]> {
  const rows = await db.execute<{ id: number; bars: number }>(sql`
    SELECT i.id, COALESCE(d.bars, 0)::int AS bars
    FROM osrs_items i
    JOIN osrs_prices p ON p.item_id = i.id
    LEFT JOIN (
      SELECT item_id, count(*) AS bars
      FROM osrs_price_daily
      GROUP BY item_id
    ) d ON d.item_id = i.id
    WHERE COALESCE(d.bars, 0) < ${MIN_SAMPLE_DAYS}
    ORDER BY p.hourly_volume DESC, i.id
    LIMIT ${limit}
  `);
  return rowsOf<{ id: number; bars: number }>(rows);
}

export async function backfillHistory(budget = ITEMS_PER_RUN): Promise<JobResult> {
  const due = await itemsNeedingHistory(budget);
  if (due.length === 0) return { due: 0, written: 0, note: 'every traded item has enough history' };

  const cutoff = new Date(Date.now() - HISTORY_RETENTION_DAYS * 86_400_000);
  let written = 0;
  let failed = 0;

  for (const [i, item] of due.entries()) {
    if (i > 0) await sleep(PAUSE_MS);

    let points;
    try {
      // 24h steps: one point per day, which is the granularity the bars are
      // stored at, so nothing has to be re-aggregated or interpolated.
      points = await fetchTimeseries(item.id, '24h');
    } catch {
      // A failed item is not a failed run — it stays due and comes round
      // again next time. That is what makes this safe to schedule often.
      failed++;
      continue;
    }

    const values = points
      .map((p) => ({
        itemId: item.id,
        day: new Date(p.timestamp * 1000),
        avgHigh: p.avgHigh,
        avgLow: p.avgLow,
        volume: (p.highVolume ?? 0) + (p.lowVolume ?? 0),
      }))
      .filter((v) => v.day >= cutoff && (v.avgHigh !== null || v.avgLow !== null))
      .map((v) => ({
        itemId: v.itemId,
        // The column is a date; an ISO date string is unambiguous about which
        // day a timestamp belongs to, which a Date in a local zone is not.
        day: v.day.toISOString().slice(0, 10),
        avgHigh: v.avgHigh,
        avgLow: v.avgLow,
        volume: v.volume,
      }));

    if (values.length === 0) continue;

    // DO NOTHING, not DO UPDATE: a bar rolled up from our own hourly points
    // is a better measurement than one fetched at a coarser step, so it wins.
    await db.insert(osrsPriceDaily).values(values).onConflictDoNothing();
    written += values.length;
  }

  return { due: due.length, requested: due.length - failed, failed, written };
}
