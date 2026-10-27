'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsWatchlist, osrsItems, osrsPrices } from '@/database/schema';
import { requireUser, currentUser } from '@/lib/session';

export type WatchResult = { ok: true; watching: boolean } | { ok: false; error: string };

/**
 * Follow or unfollow an item.
 *
 * One call rather than add/remove, because the button is a toggle and
 * splitting it invites the two getting out of step with what is on screen.
 * The new state is returned so the caller renders the truth rather than
 * assuming the flip worked.
 */
export async function toggleWatch(itemId: number): Promise<WatchResult> {
  const user = await requireUser();
  if (!Number.isInteger(itemId)) return { ok: false, error: 'Unknown item.' };

  const existing = await db
    .select({ itemId: osrsWatchlist.itemId })
    .from(osrsWatchlist)
    .where(and(eq(osrsWatchlist.userId, user.id), eq(osrsWatchlist.itemId, itemId)))
    .limit(1);

  if (existing.length > 0) {
    await db
      .delete(osrsWatchlist)
      .where(and(eq(osrsWatchlist.userId, user.id), eq(osrsWatchlist.itemId, itemId)));
    revalidatePath('/watchlist');
    revalidatePath(`/item/${itemId}`);
    return { ok: true, watching: false };
  }

  // onConflictDoNothing: double-clicking the button must not be an error.
  await db
    .insert(osrsWatchlist)
    .values({ userId: user.id, itemId })
    .onConflictDoNothing();
  revalidatePath('/watchlist');
  revalidatePath(`/item/${itemId}`);
  return { ok: true, watching: true };
}

export async function isWatching(userId: string | null, itemId: number): Promise<boolean> {
  if (!userId) return false;
  const rows = await db
    .select({ itemId: osrsWatchlist.itemId })
    .from(osrsWatchlist)
    .where(and(eq(osrsWatchlist.userId, userId), eq(osrsWatchlist.itemId, itemId)))
    .limit(1);
  return rows.length > 0;
}

export type WatchRow = {
  id: number;
  name: string;
  members: boolean;
  buyLimit: number | null;
  low: number | null;
  high: number | null;
  /** Last trade on each side. Without these, confidence is always unknown. */
  lowTime: Date | null;
  highTime: Date | null;
  fetchedAt: Date | null;
  hourlyVolume: number | null;
  addedAt: Date;
};

/** Every item the signed-in user follows, with the quote attached. */
export async function watchlistFor(userId: string): Promise<WatchRow[]> {
  return db
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
      // Selected as the column, NOT as a raw COALESCE fragment. Drizzle's
      // bigint({ mode: 'number' }) converts on the way out, and a raw sql<>
      // fragment bypasses that conversion — `sql<number>` is only a type
      // assertion, so the value arrives as the string Postgres sent and
      // toLocaleString silently renders it without separators.
      hourlyVolume: osrsPrices.hourlyVolume,
      addedAt: osrsWatchlist.createdAt,
    })
    .from(osrsWatchlist)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsWatchlist.itemId))
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsWatchlist.itemId))
    .where(eq(osrsWatchlist.userId, userId))
    .orderBy(desc(osrsWatchlist.createdAt));
}

/** Convenience for pages that only need the current user's follows. */
export async function myWatchlist(): Promise<WatchRow[]> {
  const user = await currentUser();
  return user ? watchlistFor(user.id) : [];
}
