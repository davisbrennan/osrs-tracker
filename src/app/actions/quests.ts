'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAccounts, osrsSnapshots, osrsQuestProgress } from '@/database/schema';
import { currentUser } from '@/lib/session';
import { QUESTS } from '@/lib/osrs/quest-data';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/** Confirms the account belongs to the signed-in user before anything else. */
async function ownedAccount(accountId: string): Promise<string | null> {
  const user = await currentUser();
  if (!user) return null;
  const [row] = await db
    .select({ id: osrsAccounts.id })
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.id, accountId), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  return row?.id ?? null;
}

export async function setQuestDone(
  accountId: string,
  questId: string,
  done: boolean
): Promise<ActionResult> {
  const owned = await ownedAccount(accountId);
  if (!owned) return { ok: false, error: 'That account is not yours.' };

  // Only ids the dataset knows about. Without this the table would accept
  // any string, and a typo would sit there forever looking like progress.
  if (!QUESTS.some((q) => q.id === questId)) {
    return { ok: false, error: 'Unknown quest.' };
  }

  try {
    if (done) {
      await db
        .insert(osrsQuestProgress)
        .values({ accountId: owned, questId })
        .onConflictDoNothing();
    } else {
      await db
        .delete(osrsQuestProgress)
        .where(
          and(eq(osrsQuestProgress.accountId, owned), eq(osrsQuestProgress.questId, questId))
        );
    }
  } catch {
    return { ok: false, error: 'Could not save that. Try again.' };
  }

  revalidatePath('/unlocks');
  return { ok: true, message: done ? 'Marked done.' : 'Marked not done.' };
}

/** Tick several at once, for the "I've done all of these" case. */
export async function setManyQuestsDone(
  accountId: string,
  questIds: string[]
): Promise<ActionResult> {
  const owned = await ownedAccount(accountId);
  if (!owned) return { ok: false, error: 'That account is not yours.' };

  const known = questIds.filter((id) => QUESTS.some((q) => q.id === id));
  if (known.length === 0) return { ok: false, error: 'Nothing to save.' };

  try {
    await db
      .insert(osrsQuestProgress)
      .values(known.map((questId) => ({ accountId: owned, questId })))
      .onConflictDoNothing();
  } catch {
    return { ok: false, error: 'Could not save that. Try again.' };
  }

  revalidatePath('/unlocks');
  return { ok: true, message: `Marked ${known.length} done.` };
}

export type AccountProgress = {
  id: string;
  rsn: string;
  done: Set<string>;
  levels: Map<string, number>;
  questPoints: number;
  syncedAt: Date | null;
};

/**
 * One account's quest ticks plus the skill levels from its latest hiscores
 * snapshot — the two halves a plan needs.
 */
export async function progressFor(accountId: string): Promise<AccountProgress | null> {
  const user = await currentUser();
  if (!user) return null;

  const [account] = await db
    .select({ id: osrsAccounts.id, rsn: osrsAccounts.rsn })
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.id, accountId), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  if (!account) return null;

  const [ticks, snapshot] = await Promise.all([
    db
      .select({ questId: osrsQuestProgress.questId })
      .from(osrsQuestProgress)
      .where(eq(osrsQuestProgress.accountId, account.id)),
    db
      .select({ skills: osrsSnapshots.skills, takenAt: osrsSnapshots.takenAt })
      .from(osrsSnapshots)
      .where(eq(osrsSnapshots.accountId, account.id))
      .orderBy(desc(osrsSnapshots.takenAt))
      .limit(1),
  ]);

  const levels = new Map<string, number>();
  const raw = snapshot[0]?.skills;
  if (raw && typeof raw === 'object') {
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const level =
        value && typeof value === 'object' && 'level' in (value as Record<string, unknown>)
          ? Number((value as { level: unknown }).level)
          : Number(value);
      if (Number.isFinite(level) && level > 0) levels.set(key, level);
    }
  }

  return {
    id: account.id,
    rsn: account.rsn,
    done: new Set(ticks.map((t) => t.questId)),
    levels,
    // The hiscores do not report quest points, so this stays 0 until a quest
    // in the dataset needs them — at which point it comes from the ticks.
    questPoints: 0,
    syncedAt: snapshot[0]?.takenAt ?? null,
  };
}

/** The user's accounts, for the picker. */
export async function myAccounts(): Promise<{ id: string; rsn: string }[]> {
  const user = await currentUser();
  if (!user) return [];
  return db
    .select({ id: osrsAccounts.id, rsn: osrsAccounts.rsn })
    .from(osrsAccounts)
    .where(eq(osrsAccounts.userId, user.id))
    .orderBy(osrsAccounts.rsn);
}
