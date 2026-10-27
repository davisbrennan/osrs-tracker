'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, count, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAccounts, osrsSnapshots } from '@/database/schema';
import { requireUser, MAX_TRACKED_ACCOUNTS } from '@/lib/session';
import { normaliseRsn, combatLevel, type SkillRow } from '@/lib/osrs/skills';
import { ACCOUNT_TYPES } from '@/lib/osrs/constants';
import { type Activity } from '@/lib/osrs/hiscores-json';
import { fetchHiscores, FetchError } from '@/lib/osrs/api';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

/**
 * Track a RuneScape name.
 *
 * The hiscores are fetched synchronously here rather than left to the poller,
 * because the two things that can go wrong — a typo and a name too low-level
 * to be ranked — are both things the person needs telling about while they
 * are still looking at the form. Waiting six hours to find out the name was
 * wrong is not a feature.
 */
export async function addAccount(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const raw = String(formData.get('rsn') ?? '');
  const accountType = String(formData.get('accountType') ?? 'main');

  const rsn = normaliseRsn(raw);
  if (!rsn) {
    return {
      ok: false,
      error:
        'That is not a valid RuneScape name. One to twelve characters, letters, numbers, spaces, hyphens and underscores.',
    };
  }
  if (!ACCOUNT_TYPES.some((t) => t.value === accountType)) {
    return { ok: false, error: 'Unknown account type.' };
  }

  const rsnKey = rsn.toLowerCase();

  const [existing] = await db
    .select({ id: osrsAccounts.id })
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.userId, user.id), eq(osrsAccounts.rsnKey, rsnKey)))
    .limit(1);
  if (existing) return { ok: false, error: `You are already tracking ${rsn}.` };

  // The cap exists because every tracked name is a recurring request to
  // Jagex's hiscores, which is a free service run as a courtesy.
  const [{ value: tracked }] = await db
    .select({ value: count() })
    .from(osrsAccounts)
    .where(eq(osrsAccounts.userId, user.id));
  if (tracked >= MAX_TRACKED_ACCOUNTS) {
    return {
      ok: false,
      error: `You can track ${MAX_TRACKED_ACCOUNTS} accounts. Remove one first.`,
    };
  }

  let result;
  try {
    result = await fetchHiscores(rsn);
  } catch (err) {
    const retryable = err instanceof FetchError ? err.retryable : true;
    return {
      ok: false,
      error: retryable
        ? 'The hiscores are not responding right now. Try again in a minute.'
        : 'Could not read the hiscores for that name.',
    };
  }

  if (!result.found) {
    return {
      ok: false,
      error: `The hiscores have no record of “${rsn}”. Check the spelling — and note that Jagex only ranks accounts above a certain level, so a brand new account will not appear yet.`,
    };
  }

  const [created] = await db
    .insert(osrsAccounts)
    .values({
      userId: user.id,
      rsn,
      rsnKey,
      accountType,
      // The first account tracked becomes the default one.
      isPrimary: tracked === 0,
    })
    .returning({ id: osrsAccounts.id });

  await writeSnapshot(created.id, result.hiscores.skills, result.hiscores.activities);

  revalidatePath('/accounts');
  return { ok: true, message: `Tracking ${rsn}.` };
}

/** Pull the hiscores again, now. Rate-limited per account. */
export async function refreshAccount(accountId: string): Promise<ActionResult> {
  const user = await requireUser();

  const [account] = await db
    .select()
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.id, accountId), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  if (!account) return { ok: false, error: 'Not found.' };

  // A refresh button with no limit is a button for pointing a crowd at
  // Jagex's hiscores. The poller covers everyone every six hours anyway;
  // this is only for when you have just levelled and want to see it.
  if (account.lastSyncedAt) {
    const secondsAgo = (Date.now() - account.lastSyncedAt.getTime()) / 1000;
    if (secondsAgo < 60) {
      return { ok: false, error: 'Just refreshed. Try again in a minute.' };
    }
  }

  let result;
  try {
    result = await fetchHiscores(account.rsn);
  } catch {
    return { ok: false, error: 'The hiscores are not responding right now.' };
  }

  if (!result.found) {
    await db
      .update(osrsAccounts)
      .set({ missingSince: new Date(), lastSyncedAt: new Date() })
      .where(eq(osrsAccounts.id, account.id));
    revalidatePath('/accounts');
    return { ok: false, error: `The hiscores no longer list ${account.rsn}.` };
  }

  const changed = await writeSnapshot(
    account.id,
    result.hiscores.skills,
    result.hiscores.activities
  );

  revalidatePath('/accounts');
  revalidatePath(`/accounts/${account.id}`);
  return {
    ok: true,
    message: changed ? 'Updated.' : 'No change since the last check.',
  };
}

export async function removeAccount(accountId: string): Promise<ActionResult> {
  const user = await requireUser();
  const deleted = await db
    .delete(osrsAccounts)
    .where(and(eq(osrsAccounts.id, accountId), eq(osrsAccounts.userId, user.id)))
    .returning({ rsn: osrsAccounts.rsn });

  if (deleted.length === 0) return { ok: false, error: 'Not found.' };

  revalidatePath('/accounts');
  return { ok: true, message: `Stopped tracking ${deleted[0].rsn}. Its snapshots are gone too.` };
}

/**
 * Store a snapshot, unless nothing moved.
 *
 * Shared with the poller's logic on purpose — an idle account polled daily
 * for a year would otherwise leave 365 identical rows and make every
 * progress chart a flat line built from redundant data.
 */
async function writeSnapshot(
  accountId: string,
  skills: Record<string, SkillRow>,
  activities: Activity[]
): Promise<boolean> {
  const overall = skills.overall;
  const individual = Object.values(skills).filter((s) => s.key !== 'overall');

  const totalXp =
    overall?.xp && overall.xp > 0
      ? overall.xp
      : individual.reduce((sum, s) => sum + Math.max(0, s.xp), 0);
  const totalLevel =
    overall?.level && overall.level > 0
      ? overall.level
      : individual.reduce((sum, s) => sum + s.level, 0);

  const [previous] = await db
    .select({ totalXp: osrsSnapshots.totalXp })
    .from(osrsSnapshots)
    .where(eq(osrsSnapshots.accountId, accountId))
    .orderBy(desc(osrsSnapshots.takenAt))
    .limit(1);

  const changed = !previous || previous.totalXp !== totalXp;
  const now = new Date();

  if (changed) {
    await db.insert(osrsSnapshots).values({
      accountId,
      takenAt: now,
      skills,
      totalLevel,
      totalXp,
      combatLevel: combatLevel(skills),
      activities,
    });
  }

  await db
    .update(osrsAccounts)
    .set({ lastSyncedAt: now, missingSince: null })
    .where(eq(osrsAccounts.id, accountId));

  return changed;
}
