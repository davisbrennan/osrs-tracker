/**
 * The five-minute poll: current prices and hourly volumes for every item.
 *
 * Two endpoints, deliberately fetched together. /latest gives the prices;
 * /1h gives the volumes, and volume is not decoration here — it is what
 * separates a reachable margin from a trap, and ge.ts refuses to rate
 * confidence without it. Fetching them apart would mean rows where the price
 * is fresh and the volume is an hour older than it looks.
 */

import { sql, inArray } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices, osrsPriceHistory } from '@/database/schema';
import { fetchLatest, fetchHourly } from '@/lib/osrs/api';
import { errorMessage } from '@/lib/osrs/jobs/record';
import {
  chunk,
  secondsToDate,
  hourBucket,
  safeInt,
  safeDate,
  type JobResult,
} from '@/lib/osrs/jobs/util';

/**
 * How long hourly history is kept. Roughly 4,000 items x 24 hours is 96,000
 * rows a day, so 90 days is about 8.6 million — large but ordinary for
 * Postgres, and enough to answer "has this margin actually held?", which is
 * the question the wiki's own per-item timeseries cannot answer in bulk.
 */
export const HISTORY_RETENTION_DAYS = 90;

export async function syncPrices(now: Date = new Date()): Promise<JobResult> {
  // Both endpoints at once: they are independent, and a serial fetch would
  // widen the gap between the price and the volume describing it.
  const [latest, hourly] = await Promise.all([fetchLatest(), fetchHourly()]);

  const volumeById = new Map(hourly.map((v) => [v.itemId, v]));

  // Every row below has a foreign key onto osrs_items. The wiki ships prices
  // for items the moment they exist, so on the day Jagex adds an item our
  // catalogue is behind and these ids have nowhere to go. Filtering here
  // turns "the whole batch fails" into "a handful of new items wait for
  // tonight's mapping refresh".
  const known = new Set((await db.select({ id: osrsItems.id }).from(osrsItems)).map((r) => r.id));
  if (known.size === 0) {
    return {
      skipped: true,
      reason: 'item catalogue is empty — run sync-items first',
    };
  }

  // Keyed by item id, not an array. ON CONFLICT DO UPDATE cannot touch the
  // same row twice in one statement — Postgres raises 21000 and the whole
  // batch dies — so two entries for one item would break the poll on every
  // single run. The ids come from JSON object keys and so should already be
  // unique; a Map makes that true by construction rather than by trust.
  const byItem = new Map<number, typeof osrsPrices.$inferInsert>();
  let unknownItems = 0;
  // Values the wiki sent that an integer column will not take. Counted
  // rather than ignored: a number that cannot be stored is worth knowing
  // about, and a count of zero is the normal case.
  let rejectedValues = 0;

  for (const p of latest) {
    if (!known.has(p.itemId)) {
      unknownItems++;
      continue;
    }
    const v = volumeById.get(p.itemId);

    // Nulls are preserved all the way down. An item that has never traded
    // is unknown, not free — see the note in api.ts about Number(null).
    // safeInt turns a value too large for the column into the same
    // "unknown" rather than letting it abort the batch; before this, one
    // out-of-range price stopped the poll for all four thousand items.
    const high = safeInt(p.high);
    const low = safeInt(p.low);
    if ((p.high !== null && high === null) || (p.low !== null && low === null)) rejectedValues++;

    byItem.set(p.itemId, {
      itemId: p.itemId,
      high,
      highTime: safeDate(secondsToDate(p.highTime)),
      low,
      lowTime: safeDate(secondsToDate(p.lowTime)),
      // Both sides summed, which is the shape confidenceOf() in ge.ts expects.
      hourlyVolume: v ? v.highVolume + v.lowVolume : 0,
      fetchedAt: now,
    });
  }

  const priceRows = [...byItem.values()];
  const written = await writePrices(priceRows);

  const history = await writeHourlyHistory(hourly, known, now);

  return {
    prices: written.written,
    volumes: hourly.length,
    unknownItems,
    rejectedValues,
    ...(written.rejectedRows > 0
      ? { rejectedRows: written.rejectedRows, rejectedBecause: written.firstReason }
      : {}),
    ...history,
  };
}

/**
 * Write the price rows, and do not let one bad row cost all the others.
 *
 * These go in batches of a thousand, and a batch is one statement: if
 * Postgres refuses a single value in it, the whole statement aborts and
 * those thousand items keep yesterday's price. With the poll on a five
 * minute loop and the failure deterministic, that is a permanent outage of
 * the site's central number caused by one row.
 *
 * So a failed batch is retried row by row. The good rows land, the bad ones
 * are counted and the first reason is reported, which also identifies WHICH
 * item is unacceptable — something the batch error cannot tell you, because
 * it names the statement rather than the row.
 *
 * The slow path only runs for a batch that already failed, so the normal
 * case stays one statement per thousand rows.
 */
async function writePrices(
  rows: (typeof osrsPrices.$inferInsert)[]
): Promise<{ written: number; rejectedRows: number; firstReason: string | null }> {
  const upsert = (values: (typeof osrsPrices.$inferInsert)[]) =>
    db
      .insert(osrsPrices)
      .values(values)
      .onConflictDoUpdate({
        target: osrsPrices.itemId,
        set: {
          high: sql`excluded.high`,
          highTime: sql`excluded.high_time`,
          low: sql`excluded.low`,
          lowTime: sql`excluded.low_time`,
          hourlyVolume: sql`excluded.hourly_volume`,
          fetchedAt: sql`excluded.fetched_at`,
        },
      });

  let written = 0;
  let rejectedRows = 0;
  let firstReason: string | null = null;

  for (const batch of chunk(rows, 1000)) {
    try {
      await upsert(batch);
      written += batch.length;
    } catch (batchError) {
      // Narrow it to the offending rows rather than losing the batch.
      for (const row of batch) {
        try {
          await upsert([row]);
          written++;
        } catch (rowError) {
          rejectedRows++;
          if (firstReason === null) {
            firstReason = `item ${row.itemId}: ${errorMessage(rowError)}`;
          }
        }
      }
      // If every row in the batch failed individually too, the problem is
      // not the data — it is the table, the connection or the disk. Re-throw
      // so it is reported as the outage it is rather than as 1,000 bad rows.
      if (rejectedRows >= batch.length) throw batchError;
    }
  }

  return { written, rejectedRows, firstReason };
}

/**
 * Append one history row per item per hour.
 *
 * Written on whichever poll happens to be first in the hour, not on a
 * separate hourly schedule, and keyed on the truncated hour with
 * onConflictDoNothing. That means the remaining eleven polls are cheap
 * no-ops, and a worker that restarts mid-hour picks the hour back up instead
 * of either duplicating the row or losing it — the behaviour falls out of the
 * primary key rather than needing a flag somewhere.
 */
async function writeHourlyHistory(
  hourly: Awaited<ReturnType<typeof fetchHourly>>,
  known: Set<number>,
  now: Date
): Promise<JobResult> {
  const ts = hourBucket(now);
  const rows = hourly
    .filter((v) => known.has(v.itemId))
    .map((v) => ({
      itemId: v.itemId,
      ts,
      // Integer columns, same exposure as the price row above.
      avgHigh: safeInt(v.avgHigh),
      avgLow: safeInt(v.avgLow),
      highVolume: v.highVolume,
      lowVolume: v.lowVolume,
    }));

  let inserted = 0;
  for (const batch of chunk(rows, 1000)) {
    const res = await db.insert(osrsPriceHistory).values(batch).onConflictDoNothing();
    inserted += res.rowCount ?? 0;
  }
  return { historyHour: ts.toISOString(), historyInserted: inserted };
}

/** Drop history past the retention window. Daily. */
export async function pruneHistory(now: Date = new Date()): Promise<JobResult> {
  const cutoff = new Date(now.getTime() - HISTORY_RETENTION_DAYS * 86_400_000);
  const res = await db.delete(osrsPriceHistory).where(sql`${osrsPriceHistory.ts} < ${cutoff}`);
  return { cutoff: cutoff.toISOString(), deleted: res.rowCount ?? 0 };
}

/**
 * Prices for a specific set of items, for the pages that need them.
 *
 * Lives here rather than in a route so the worker and the UI agree on the
 * shape of a price row.
 */
export async function pricesFor(itemIds: number[]) {
  if (itemIds.length === 0) return [];
  return db.select().from(osrsPrices).where(inArray(osrsPrices.itemId, itemIds));
}
