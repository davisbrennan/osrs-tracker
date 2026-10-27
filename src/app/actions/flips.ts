'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, sql, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsFlips, osrsItems, osrsPrices } from '@/database/schema';
import { requireUser } from '@/lib/session';
import { geTax, marginPerUnit, parseGp } from '@/lib/osrs/ge';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export type ItemMatch = {
  id: number;
  name: string;
  members: boolean;
  low: number | null;
  high: number | null;
};

/** Item search for the journal's picker. Capped — it feeds a dropdown. */
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
      // An exact prefix match first — typing "whip" should surface the whip
      // before "Abyssal whip (or)" and friends.
      .orderBy(sql`CASE WHEN ${osrsItems.name} ILIKE ${q + '%'} THEN 0 ELSE 1 END`, osrsItems.name)
      .limit(10)
  );
}

/**
 * Record a flip.
 *
 * A flip can be logged open (bought, not yet sold) or closed in one go. The
 * database enforces that a sold flip has both a price and a time, so the two
 * can never drift apart.
 */
export async function addFlip(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const itemId = Number(formData.get('itemId'));
  const quantity = Number(formData.get('quantity'));
  const buyPrice = parseGp(String(formData.get('buyPrice') ?? ''));
  const sellRaw = String(formData.get('sellPrice') ?? '').trim();
  const sellPrice = sellRaw ? parseGp(sellRaw) : null;
  const note = String(formData.get('note') ?? '').trim() || null;

  if (!Number.isInteger(itemId) || itemId <= 0) return { ok: false, error: 'Pick an item.' };
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return { ok: false, error: 'Quantity must be a whole number above zero.' };
  }
  if (buyPrice === null || buyPrice < 0) {
    return { ok: false, error: 'Buy price must be a number — 1.5m, 250k and 1500000 all work.' };
  }
  if (sellRaw && (sellPrice === null || sellPrice < 0)) {
    return { ok: false, error: 'Sell price must be a number, or leave it blank for an open flip.' };
  }

  const [item] = await db
    .select({ id: osrsItems.id, name: osrsItems.name })
    .from(osrsItems)
    .where(eq(osrsItems.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: 'That item is not in the catalogue.' };

  const now = new Date();
  // Tax and profit are computed and STORED on close, never derived on read.
  // A future change to the tax rate must not silently rewrite your history.
  const closed = sellPrice !== null;
  const taxPaid = closed ? geTax(sellPrice, itemId) * quantity : null;
  const profit = closed ? marginPerUnit(buyPrice, sellPrice, itemId) * quantity : null;

  await db.insert(osrsFlips).values({
    userId: user.id,
    itemId,
    quantity,
    buyPrice,
    sellPrice,
    boughtAt: now,
    soldAt: closed ? now : null,
    taxPaid,
    profit,
    note,
  });

  revalidatePath('/journal');
  return {
    ok: true,
    message: closed
      ? `Logged ${quantity} × ${item.name} — ${profit! >= 0 ? 'profit' : 'loss'} of ${Math.abs(profit!).toLocaleString('en-US')} gp.`
      : `Logged ${quantity} × ${item.name} as an open position.`,
  };
}

/** Close an open flip at a sell price. */
export async function closeFlip(flipId: string, sellRaw: string): Promise<ActionResult> {
  const user = await requireUser();

  const sellPrice = parseGp(sellRaw);
  if (sellPrice === null || sellPrice < 0) return { ok: false, error: 'Enter a sell price.' };

  const [flip] = await db
    .select()
    .from(osrsFlips)
    .where(and(eq(osrsFlips.id, flipId), eq(osrsFlips.userId, user.id)))
    .limit(1);
  if (!flip) return { ok: false, error: 'Not found.' };
  if (flip.soldAt) return { ok: false, error: 'That flip is already closed.' };

  const taxPaid = geTax(sellPrice, flip.itemId) * flip.quantity;
  const profit = marginPerUnit(flip.buyPrice, sellPrice, flip.itemId) * flip.quantity;

  await db
    .update(osrsFlips)
    .set({ sellPrice, soldAt: new Date(), taxPaid, profit, updatedAt: new Date() })
    .where(eq(osrsFlips.id, flip.id));

  revalidatePath('/journal');
  return {
    ok: true,
    message: `Closed — ${profit >= 0 ? 'profit' : 'loss'} of ${Math.abs(profit).toLocaleString('en-US')} gp after ${taxPaid.toLocaleString('en-US')} gp tax.`,
  };
}

export async function deleteFlip(flipId: string): Promise<ActionResult> {
  const user = await requireUser();
  const deleted = await db
    .delete(osrsFlips)
    .where(and(eq(osrsFlips.id, flipId), eq(osrsFlips.userId, user.id)))
    .returning({ id: osrsFlips.id });

  if (deleted.length === 0) return { ok: false, error: 'Not found.' };
  revalidatePath('/journal');
  return { ok: true, message: 'Deleted.' };
}

/** Recent flips with their item names and current market price. */
export async function recentFlips(userId: string, limit = 200) {
  return db
    .select({
      id: osrsFlips.id,
      itemId: osrsFlips.itemId,
      name: osrsItems.name,
      quantity: osrsFlips.quantity,
      buyPrice: osrsFlips.buyPrice,
      sellPrice: osrsFlips.sellPrice,
      boughtAt: osrsFlips.boughtAt,
      soldAt: osrsFlips.soldAt,
      taxPaid: osrsFlips.taxPaid,
      profit: osrsFlips.profit,
      note: osrsFlips.note,
      marketHigh: osrsPrices.high,
      marketLow: osrsPrices.low,
    })
    .from(osrsFlips)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsFlips.itemId))
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsFlips.itemId))
    .where(eq(osrsFlips.userId, userId))
    .orderBy(desc(osrsFlips.boughtAt))
    .limit(limit);
}
