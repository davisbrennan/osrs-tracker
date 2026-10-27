'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, count, isNull } from 'drizzle-orm';
import { db } from '@/database';
import { osrsGoals, osrsAccounts } from '@/database/schema';
import { requireUser } from '@/lib/session';
import { SKILLS } from '@/lib/osrs/skills';
import { MAX_LEVEL } from '@/lib/osrs/xp';
import { MAX_GOALS } from '@/lib/osrs/constants';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export async function addGoal(formData: FormData): Promise<ActionResult> {
  const user = await requireUser();

  const accountId = String(formData.get('accountId') ?? '');
  const skill = String(formData.get('skill') ?? '');
  const targetLevel = Number(formData.get('targetLevel'));
  const note = String(formData.get('note') ?? '').trim() || null;

  // Ownership is checked against the session, never trusted from the form.
  const [account] = await db
    .select({ id: osrsAccounts.id })
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.id, accountId), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  if (!account) return { ok: false, error: 'Not found.' };

  const meta = SKILLS.find((s) => s.key === skill && s.key !== 'overall');
  if (!meta) return { ok: false, error: 'Pick a skill.' };

  if (!Number.isInteger(targetLevel) || targetLevel < 2 || targetLevel > MAX_LEVEL) {
    return { ok: false, error: `Target level must be between 2 and ${MAX_LEVEL}.` };
  }

  // isNull, not eq(..., null): SQL's `= NULL` is never true, so the
  // comparison would silently count zero goals and the cap would never bite.
  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(osrsGoals)
    .where(and(eq(osrsGoals.accountId, accountId), isNull(osrsGoals.achievedAt)));

  if (existing >= MAX_GOALS) {
    return { ok: false, error: `That account already has ${MAX_GOALS} goals.` };
  }

  await db.insert(osrsGoals).values({ accountId, skill, targetLevel, note });

  revalidatePath(`/accounts/${accountId}`);
  return { ok: true, message: `Goal added: ${meta.name} ${targetLevel}.` };
}

export async function removeGoal(goalId: string): Promise<ActionResult> {
  const user = await requireUser();

  // Join through accounts so a goal id from another user matches nothing.
  const [goal] = await db
    .select({ id: osrsGoals.id, accountId: osrsGoals.accountId })
    .from(osrsGoals)
    .innerJoin(osrsAccounts, eq(osrsAccounts.id, osrsGoals.accountId))
    .where(and(eq(osrsGoals.id, goalId), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  if (!goal) return { ok: false, error: 'Not found.' };

  await db.delete(osrsGoals).where(eq(osrsGoals.id, goalId));
  revalidatePath(`/accounts/${goal.accountId}`);
  return { ok: true, message: 'Goal removed.' };
}
