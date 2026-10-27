'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, sql, desc, inArray } from 'drizzle-orm';
import { db } from '@/database';
import { osrsTrades, osrsItems, osrsPrices } from '@/database/schema';
import { requireUser } from '@/lib/session';
import { geTax, parseGp } from '@/lib/osrs/ge';
import type { Trade } from '@/lib/osrs/portfolio';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export type ItemMatch = {
  id: number;
  name: string;
  members: boolean;
  low: number | null;
  high: number | null;
};

/** Item search for the blotter's picker. Capped — it feeds a dropdown. */
export async function searchItems(query: string): Promise<ItemMatch[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  return (
    db
      .select({
        id: osrsItems.id,
        name: osrsItems.name,
        members: osrsItems.members,
        low: osrsPrices.low,
        high: osrsPrices.high,
      })
      .from(osrsItems)
      .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
      .where(sql`${osrsItems.name} ILIKE ${'%' + q + '%'}`)
      // Prefix matches first: typing "whip" should surface the whip before
      // "Abyssal whip (or)" and the rest.
      .orderBy(sql`CASE WHEN ${osrsItems.name} ILIKE ${q + '%'} THEN 0 ELSE 1 END`, osrsItems.name)
      .limit(10)
  );
}

/**
 * Record one execution.
 *
 * A fill, not a round trip. Buying 10,000 death runes takes several buys
 * because of the four-hour limit, and each is logged separately — which is
 * what lets the cost basis be right when they went in at different prices.
 */
export async function addTrade(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const itemId = Number(formData.get('itemId'));
  const side = String(formData.get('side') ?? '');
  const quantity = Number(formData.get('quantity'));
  const price = parseGp(String(formData.get('price') ?? ''));
  const whenRaw = String(formData.get('executedAt') ?? '').trim();
  const note = String(formData.get('note') ?? '').trim() || null;

  if (side !== 'buy' && side !== 'sell') return { ok: false, error: 'Pick buy or sell.' };
  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: 'Pick an item.' };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: 'Quantity must be a whole number above zero.' };
  }
  if (price === null || price < 0) {
    return { ok: false, error: 'Price must be a number — 1.5m, 250k and 1500000 all work.' };
  }

  // A blank time means now. A supplied one is accepted so a session's worth
  // of trades can be entered afterwards without them all stacking on one
  // timestamp, which would make FIFO order arbitrary.
  let executedAt = new Date();
  if (whenRaw) {
    const parsed = new Date(whenRaw);
    if (Number.isNaN(parsed.getTime())) return { ok: false, error: 'That date is not readable.' };
    if (parsed.getTime() > Date.now() + 60_000) {
      return { ok: false, error: 'That is in the future.' };
    }
    executedAt = parsed;
  }

  const [item] = await db
    .select({ id: osrsItems.id, name: osrsItems.name })
    .from(osrsItems)
    .where(eq(osrsItems.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: 'That item is not in the catalogue.' };

  // Tax is computed and stored at execution, never derived on read — a later
  // change to the GE's rate must not rewrite what you actually paid.
  const taxPaid = side === 'sell' ? geTax(price, itemId) * quantity : null;

  await db.insert(osrsTrades).values({
    userId: user.id,
    itemId,
    side,
    quantity,
    price,
    executedAt,
    taxPaid,
    source: 'manual',
    note,
  });

  revalidatePath('/journal');
  return {
    ok: true,
    message: `${side === 'buy' ? 'Bought' : 'Sold'} ${quantity.toLocaleString('en-US')} × ${item.name}.`,
  };
}

export async function deleteTrade(tradeId: string): Promise<ActionResult> {
  const user = await requireUser();
  const deleted = await db
    .delete(osrsTrades)
    .where(and(eq(osrsTrades.id, tradeId), eq(osrsTrades.userId, user.id)))
    .returning({ id: osrsTrades.id });

  if (deleted.length === 0) return { ok: false, error: 'Not found.' };
  revalidatePath('/journal');
  // Worth saying plainly: removing one fill re-matches everything after it.
  return { ok: true, message: 'Deleted. Positions and P&L have been recalculated.' };
}

/**
 * Close an open position, from the positions table.
 *
 * Shorthand for "sell this quantity at this price now" — the same thing as
 * logging a sell, reached from where you are looking at the position.
 */
export async function closePosition(
  itemId: number,
  quantity: number,
  priceRaw: string
): Promise<ActionResult> {
  const form = new FormData();
  form.set('itemId', String(itemId));
  form.set('side', 'sell');
  form.set('quantity', String(quantity));
  form.set('price', priceRaw);
  return addTrade(form);
}

/** The whole blotter, with item names, ready for the portfolio builder. */
export async function allTrades(userId: string): Promise<Trade[]> {
  const rows = await db
    .select({
      id: osrsTrades.id,
      itemId: osrsTrades.itemId,
      itemName: osrsItems.name,
      side: osrsTrades.side,
      quantity: osrsTrades.quantity,
      price: osrsTrades.price,
      executedAt: osrsTrades.executedAt,
      taxPaid: osrsTrades.taxPaid,
      note: osrsTrades.note,
    })
    .from(osrsTrades)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsTrades.itemId))
    .where(eq(osrsTrades.userId, userId))
    .orderBy(desc(osrsTrades.executedAt));

  return rows.map((r) => ({ ...r, side: r.side as 'buy' | 'sell' }));
}

/** Current instant-buy prices for the items a book touches. */
export async function marksFor(itemIds: number[]): Promise<Map<number, number | null>> {
  if (itemIds.length === 0) return new Map();
  const rows = await db
    .select({ itemId: osrsPrices.itemId, high: osrsPrices.high })
    .from(osrsPrices)
    .where(inArray(osrsPrices.itemId, itemIds));
  return new Map(rows.map((r) => [r.itemId, r.high]));
}
