/**
 * Roll the hourly price history into daily bars.
 *
 * Costs nothing: it reads data already collected and writes one row per item
 * per day. No external requests, so it can run as often as is useful.
 *
 * Re-rolls the last few days every time rather than only yesterday. Today's
 * bar is incomplete until the day ends, hourly points can arrive late, and
 * the upsert makes rewriting a bar harmless. Tracking "which days are done"
 * would be state that can go wrong for no benefit.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { HISTORY_RETENTION_DAYS } from '@/lib/osrs/jobs/sync-prices';
import type { JobResult } from '@/lib/osrs/jobs/util';

/** How many recent days to recompute on each run. */
const REROLL_DAYS = 3;

export async function rollupDaily(days = REROLL_DAYS): Promise<JobResult> {
  const result = await db.execute(sql`
    INSERT INTO osrs_price_daily (item_id, day, avg_high, avg_low, volume)
    SELECT
      item_id,
      (ts AT TIME ZONE 'UTC')::date AS day,
      -- An average of hourly averages. Volume-weighting would be better in
      -- principle, but the wiki's hourly volumes count trades rather than
      -- the quantity behind them, so weighting by it would not mean what it
      -- looks like it means.
      ROUND(AVG(avg_high))::int,
      ROUND(AVG(avg_low))::int,
      COALESCE(SUM(high_volume), 0) + COALESCE(SUM(low_volume), 0)
    FROM osrs_price_history
    WHERE ts >= (now() - (${days} || ' days')::interval)
    GROUP BY item_id, (ts AT TIME ZONE 'UTC')::date
    ON CONFLICT (item_id, day) DO UPDATE SET
      avg_high = EXCLUDED.avg_high,
      avg_low  = EXCLUDED.avg_low,
      volume   = EXCLUDED.volume
  `);

  return { days, written: result.rowCount ?? 0 };
}

/**
 * Drop daily bars past the retention window.
 *
 * Deliberately the same window as the hourly history, so the privacy page's
 * single stated retention period stays true of everything.
 */
export async function pruneDaily(): Promise<JobResult> {
  const result = await db.execute(sql`
    DELETE FROM osrs_price_daily
    WHERE day < (now() - (${HISTORY_RETENTION_DAYS} || ' days')::interval)::date
  `);
  return { retentionDays: HISTORY_RETENTION_DAYS, deleted: result.rowCount ?? 0 };
}
