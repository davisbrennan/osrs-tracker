/**
 * Pull hiscores for tracked accounts and store a snapshot.
 *
 * Jagex's hiscores are a courtesy, not a product: unauthenticated, free, and
 * easy to get blocked from. So this walks accounts one at a time with a pause
 * between, oldest-sync-first, and stops after a budget rather than trying to
 * do everything in one pass.
 */

import { eq, sql, and, isNull, or, lt, desc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAccounts, osrsSnapshots } from '@/database/schema';
import { type Activity } from '@/lib/osrs/hiscores-json';
import { fetchHiscores } from '@/lib/osrs/api';
import { FetchError } from '@/lib/osrs/api';
import { combatLevel, type SkillRow } from '@/lib/osrs/skills';
import { sleep, type JobResult } from '@/lib/osrs/jobs/util';

/** Pause between accounts, so a hundred accounts never look like a flood. */
const DELAY_BETWEEN_ACCOUNTS_MS = 1_500;

/** Accounts per run. Keeps one slow pass from blocking the price poll. */
const DEFAULT_BUDGET = 25;

/** An account is due a refresh once its last sync is this old. */
const DEFAULT_STALE_AFTER_HOURS = 20;

export async function syncHiscores(
  opts: {
    budget?: number;
    staleAfterHours?: number;
    now?: Date;
  } = {}
): Promise<JobResult> {
  const budget = opts.budget ?? DEFAULT_BUDGET;
  const staleAfterHours = opts.staleAfterHours ?? DEFAULT_STALE_AFTER_HOURS;
  const now = opts.now ?? new Date();
  const staleBefore = new Date(now.getTime() - staleAfterHours * 3_600_000);

  const due = await db
    .select({
      id: osrsAccounts.id,
      rsn: osrsAccounts.rsn,
    })
    .from(osrsAccounts)
    .where(
      and(
        // Names the hiscores have already denied are parked, not retried
        // every pass. A user re-adding the name clears this.
        isNull(osrsAccounts.missingSince),
        or(isNull(osrsAccounts.lastSyncedAt), lt(osrsAccounts.lastSyncedAt, staleBefore))
      )
    )
    // Never-synced accounts first: someone who just added an RSN is watching
    // the page waiting for it to populate.
    .orderBy(sql`${osrsAccounts.lastSyncedAt} ASC NULLS FIRST`)
    .limit(budget);

  let synced = 0;
  let unchanged = 0;
  let notFound = 0;
  let failed = 0;
  const warnings: string[] = [];

  for (const [index, account] of due.entries()) {
    if (index > 0) await sleep(DELAY_BETWEEN_ACCOUNTS_MS);

    try {
      const result = await fetchHiscores(account.rsn);

      if (!result.found) {
        await db
          .update(osrsAccounts)
          .set({ missingSince: now, lastSyncedAt: now })
          .where(eq(osrsAccounts.id, account.id));
        notFound++;
        continue;
      }

      // The parser's self-check. If the skill list has drifted out of step
      // with Jagex's column order — the Sailing question — this is the thing
      // that says so, and it is worth shouting about because the alternative
      // is a page full of plausible numbers attached to the wrong skills.
      if (result.hiscores.warnings.length > 0) {
        for (const w of result.hiscores.warnings) {
          const message = `${account.rsn}: ${w}`;
          warnings.push(message);
          console.warn(`[osrs] HISCORES PARSE WARNING — ${message}`);
        }
      }

      const stored = await storeSnapshot(
        account.id,
        result.hiscores.skills,
        result.hiscores.activities,
        now
      );
      if (stored) synced++;
      else unchanged++;
    } catch (err) {
      failed++;
      const retryable = err instanceof FetchError ? err.retryable : true;
      console.error(
        `[osrs] hiscores failed for ${account.rsn} (retryable=${retryable}):`,
        err instanceof Error ? err.message : String(err)
      );
      // last_synced_at is deliberately left alone on a retryable failure, so
      // the account stays at the front of the queue next pass. On a permanent
      // failure it is stamped, so one broken name cannot starve the others.
      if (!retryable) {
        await db
          .update(osrsAccounts)
          .set({ lastSyncedAt: now })
          .where(eq(osrsAccounts.id, account.id));
      }
    }
  }

  return { due: due.length, synced, unchanged, notFound, failed, warnings };
}

/**
 * Write a snapshot, unless nothing has moved.
 *
 * An idle account polled daily for a year would otherwise leave 365 identical
 * rows, which makes every progress chart a flat line built from redundant
 * data. Comparing total XP against the previous snapshot is enough: XP only
 * goes up, and any gain at all is worth a row.
 */
async function storeSnapshot(
  accountId: string,
  skills: Record<string, SkillRow>,
  activities: Activity[],
  now: Date
): Promise<boolean> {
  const overall = skills.overall;
  const individual = Object.values(skills).filter((s) => s.key !== 'overall');

  // Prefer Jagex's own total, but fall back to summing — a brand-new account
  // is unranked overall while still having real levels.
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
