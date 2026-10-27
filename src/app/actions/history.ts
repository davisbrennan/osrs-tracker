'use server';

import { eq, and, gte, desc, inArray, sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';
import { osrsItems, osrsPrices, osrsPriceDaily } from '@/database/schema';
import {
  historyContext,
  CONTEXT_DAYS,
  type DailyBar,
  type HistoryContext,
} from '@/lib/osrs/stats';

function since(): string {
  return new Date(Date.now() - CONTEXT_DAYS * 86_400_000).toISOString().slice(0, 10);
}

/** Daily bars for one item, newest last. */
export async function barsFor(itemId: number): Promise<DailyBar[]> {
  const rows = await db
    .select({
      day: osrsPriceDaily.day,
      avgHigh: osrsPriceDaily.avgHigh,
      avgLow: osrsPriceDaily.avgLow,
      volume: osrsPriceDaily.volume,
    })
    .from(osrsPriceDaily)
    .where(and(eq(osrsPriceDaily.itemId, itemId), gte(osrsPriceDaily.day, since())))
    .orderBy(osrsPriceDaily.day);

  return rows.map((r) => ({
    day: new Date(`${r.day}T00:00:00Z`),
    avgHigh: r.avgHigh,
    avgLow: r.avgLow,
    volume: r.volume,
  }));
}

/** One item's standing against its own recent history. */
export async function contextFor(
  itemId: number,
  low: number | null,
  high: number | null,
  volume: number | null
): Promise<HistoryContext> {
  return historyContext(await barsFor(itemId), low, high, volume);
}

export type UnusualRow = {
  id: number;
  name: string;
  members: boolean;
  buyLimit: number | null;
  low: number;
  high: number;
  lowTime: Date | null;
  highTime: Date | null;
  fetchedAt: Date | null;
  hourlyVolume: number;
  context: HistoryContext;
};

/**
 * Items whose current standing is worth a look, with their context.
 *
 * Restricted to items that actually trade, for two reasons. The honest one:
 * an unusual spread on something that changes hands twice a day is a trap,
 * not an opportunity, so filtering to liquid items is what the feature
 * means. The practical one: this keeps the bar count to tens of thousands
 * of rows rather than hundreds of thousands, which means the statistics can
 * run through the same tested engine the item page uses instead of being
 * reimplemented as SQL aggregates that would drift from it.
 */
export async function unusualCandidates(
  minVolume: number,
  limit: number
): Promise<UnusualRow[]> {
  const candidates = await db
    .select({
      id: osrsItems.id,
      name: osrsItems.name,
      members: osrsItems.members,
      buyLimit: osrsItems.buyLimit,
      low: osrsPrices.low,
      high: osrsPrices.high,
      lowTime: osrsPrices.lowTime,
      highTime: osrsPrices.highTime,
      fetchedAt: osrsPrices.fetchedAt,
      hourlyVolume: osrsPrices.hourlyVolume,
    })
    .from(osrsItems)
    .innerJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
    .where(
      and(
        gte(osrsPrices.hourlyVolume, minVolume),
        sql`${osrsPrices.low} IS NOT NULL`,
        sql`${osrsPrices.high} IS NOT NULL`
      )
    )
    .orderBy(desc(osrsPrices.hourlyVolume))
    .limit(limit);

  if (candidates.length === 0) return [];

  const ids = candidates.map((c) => c.id);
  const bars = await db
    .select({
      itemId: osrsPriceDaily.itemId,
      day: osrsPriceDaily.day,
      avgHigh: osrsPriceDaily.avgHigh,
      avgLow: osrsPriceDaily.avgLow,
      volume: osrsPriceDaily.volume,
    })
    .from(osrsPriceDaily)
    .where(and(inArray(osrsPriceDaily.itemId, ids), gte(osrsPriceDaily.day, since())));

  const byItem = new Map<number, DailyBar[]>();
  for (const b of bars) {
    const list = byItem.get(b.itemId) ?? [];
    list.push({
      day: new Date(`${b.day}T00:00:00Z`),
      avgHigh: b.avgHigh,
      avgLow: b.avgLow,
      volume: b.volume,
    });
    byItem.set(b.itemId, list);
  }

  return candidates.map((c) => ({
    id: c.id,
    name: c.name,
    members: c.members,
    buyLimit: c.buyLimit,
    low: c.low!,
    high: c.high!,
    lowTime: c.lowTime,
    highTime: c.highTime,
    fetchedAt: c.fetchedAt,
    hourlyVolume: c.hourlyVolume ?? 0,
    context: historyContext(byItem.get(c.id) ?? [], c.low, c.high, c.hourlyVolume),
  }));
}

/** How much of the catalogue has enough history to be judged yet. */
export async function historyCoverage(): Promise<{ withEnough: number; priced: number }> {
  const result = await db.execute<{ with_enough: number; priced: number }>(sql`
    SELECT
      count(*) FILTER (WHERE COALESCE(d.bars, 0) >= 20)::int AS with_enough,
      count(*)::int AS priced
    FROM osrs_items i
    JOIN osrs_prices p ON p.item_id = i.id AND p.low IS NOT NULL
    LEFT JOIN (
      SELECT item_id, count(*) AS bars
      FROM osrs_price_daily
      WHERE day >= (now() - interval '90 days')::date
      GROUP BY item_id
    ) d ON d.item_id = i.id
  `);

  const [row] = rowsOf<{ with_enough: number; priced: number }>(result);
  return { withEnough: Number(row?.with_enough ?? 0), priced: Number(row?.priced ?? 0) };
}
