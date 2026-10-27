/**
 * Who is asking.
 *
 * The tenancy model here is far simpler than the one this codebase grew up
 * with: there are no shared workspaces, so there is no membership table and
 * no role matrix. A row belongs to exactly one user, and the only question
 * ever asked is "is this mine?".
 *
 * That makes the security boundary a single pattern rather than a system:
 * every query that touches user data filters on userId from the session, and
 * never on an id that arrived from the client.
 */

import { headers } from 'next/headers';
import { eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/database';
import { osrsUserSettings } from '@/database/schema';

/**
 * How many RuneScape accounts one user may track.
 *
 * Signups are open, so this is the difference between a hobby project and an
 * unwitting load generator pointed at Jagex's hiscores — every tracked name
 * is a recurring request to a free service run as a courtesy. Five covers a
 * main, an ironman and some alts; anyone who genuinely needs more can ask.
 */
export const MAX_TRACKED_ACCOUNTS = 5;

/** The default cash stack for a visitor who has not set one: 1m. */
export const DEFAULT_CASH_STACK = 1_000_000;

/** Current user, or null. Safe from any server component or route handler. */
export async function currentUser() {
  const s = await auth.api.getSession({ headers: await headers() });
  return s?.user ?? null;
}

/** Current user, or throw. For actions where being signed out is a bug. */
export async function requireUser() {
  const user = await currentUser();
  if (!user) throw new Error('Not signed in.');
  return user;
}

/**
 * This user's settings, creating the row on first read.
 *
 * Done here rather than at signup so that accounts which predate the table —
 * or arrive through some future auth path that forgets — still work.
 */
export async function userSettings(userId: string) {
  const [existing] = await db
    .select()
    .from(osrsUserSettings)
    .where(eq(osrsUserSettings.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(osrsUserSettings)
    .values({ userId, cashStack: DEFAULT_CASH_STACK })
    // A concurrent first request would otherwise collide on the primary key.
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await db
    .select()
    .from(osrsUserSettings)
    .where(eq(osrsUserSettings.userId, userId))
    .limit(1);
  return raced;
}

/**
 * The cash stack to price the flip finder against.
 *
 * Signed-out visitors get the default rather than an empty table, because a
 * flip finder showing nothing is a worse first impression than one showing
 * what a million gp can do.
 */
export async function cashStackFor(userId: string | null): Promise<number> {
  if (!userId) return DEFAULT_CASH_STACK;
  const settings = await userSettings(userId);
  return settings?.cashStack ?? DEFAULT_CASH_STACK;
}
