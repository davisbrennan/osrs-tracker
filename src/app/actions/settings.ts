'use server';

import { eq } from 'drizzle-orm';
import { db } from '@/database';
import { osrsUserSettings, users } from '@/database/schema';
import { currentUser, userSettings } from '@/lib/session';

/**
 * Save the cash stack.
 *
 * Signed-out callers are a no-op rather than an error: the input is in the
 * masthead for everyone, and a visitor repricing the table they are looking
 * at has done nothing wrong — they just have nowhere to save it to.
 */
export async function saveCashStack(cashStack: number): Promise<void> {
  const user = await currentUser();
  if (!user) return;

  if (!Number.isFinite(cashStack) || cashStack < 0) return;
  // Max cash in OSRS is 2,147,483,647 and a stack cannot exceed it, so
  // anything larger is a typo or someone poking the action.
  const clamped = Math.min(Math.round(cashStack), 2_147_483_647);

  await userSettings(user.id);
  await db
    .update(osrsUserSettings)
    .set({ cashStack: clamped, updatedAt: new Date() })
    .where(eq(osrsUserSettings.userId, user.id));
}

/** Change the display name. The only profile field there is. */
export async function saveDisplayName(name: string): Promise<void> {
  const user = await currentUser();
  if (!user) return;
  await db
    .update(users)
    .set({ name: name.trim().slice(0, 60) })
    .where(eq(users.id, user.id));
}
