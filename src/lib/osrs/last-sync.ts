/**
 * When did this site last pull prices?
 *
 * Distinct from how old a price is. An item can show a six-hour-old price
 * because nobody has traded it — a fact about the market — or because our
 * poller fell over — a fact about us. Only the second one means the page is
 * untrustworthy, and without this they look identical.
 *
 * The poller writes `fetched_at` on every row it touches, so the newest of
 * them is the moment of the last successful pull. Taken as a maximum rather
 * than from a status row somewhere: it cannot drift out of step with the
 * data, because it IS the data.
 *
 * Note that an individual item can lag this. The wiki's /latest response
 * only carries items that have traded recently, so a quiet item keeps the
 * `fetched_at` from whenever it was last in there. The global figure says
 * the pipeline is healthy; the per-item one on an item page says when that
 * particular row was last confirmed.
 */

import { sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';

/** The poller runs every five minutes; beyond this something is wrong. */
export const SYNC_OVERDUE_MINUTES = 20;

export type SyncStatus = {
  at: Date | null;
  minutesAgo: number | null;
  overdue: boolean;
};

const UNKNOWN: SyncStatus = { at: null, minutesAgo: null, overdue: false };

/**
 * Fails open, like app settings. A page that cannot render because the
 * freshness indicator broke is a worse outcome than a missing indicator,
 * and this is decoration on every page in the site.
 */
export async function lastPriceSync(now: number = Date.now()): Promise<SyncStatus> {
  try {
    const result = await db.execute(sql`SELECT max(fetched_at) AS at FROM osrs_prices`);
    const [row] = rowsOf<{ at: string | Date | null }>(result);
    if (!row?.at) return UNKNOWN;

    const at = row.at instanceof Date ? row.at : new Date(row.at);
    if (Number.isNaN(at.getTime())) return UNKNOWN;

    // Clock skew should read as "just now", never as a negative age.
    const minutesAgo = Math.max(0, (now - at.getTime()) / 60_000);
    return { at, minutesAgo, overdue: minutesAgo > SYNC_OVERDUE_MINUTES };
  } catch {
    return UNKNOWN;
  }
}
