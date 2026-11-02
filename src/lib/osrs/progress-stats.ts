/**
 * What has actually changed about this account.
 *
 * Every figure here comes from data the hiscores sync has been storing
 * since day one and nothing has ever read: the historical snapshots, and
 * the `activities` array — clue scrolls, boss kill counts, minigame
 * scores — which has been parsed, stored and displayed nowhere.
 *
 * The discipline is the same as the rest of the dashboard: a statistic
 * that cannot be computed honestly is reported as unknown rather than
 * guessed at. Two cases matter here and both are easy to get wrong.
 *
 * NO EARLIER SNAPSHOT IS NOT ZERO XP. An account tracked since yesterday
 * has no week of history, and "0 XP this week" is a claim about a week
 * that was never observed. It reads as "you did nothing", which is a
 * different and insulting statement.
 *
 * UNRANKED IS NOT ZERO. The hiscores omit anything you are not ranked in,
 * so a boss you have killed twice looks identical to one you have never
 * fought. Reporting that as 0 KC is stating something the data does not
 * say.
 */

import { levelFromXp, xpToNextLevel, xpForLevel, MAX_LEVEL } from '@/lib/osrs/xp';

export type SkillRow = { level: number; xp: number; rank?: number | null };

export type Activity = {
  name: string;
  rank: number | null;
  score: number | null;
  kind: 'clue' | 'boss' | 'minigame';
};

export type Snapshot = {
  takenAt: Date;
  totalXp: number;
  totalLevel: number;
  skills: Record<string, SkillRow>;
};

/** How far back "this week" reaches. */
export const WEEK_MS = 7 * 86_400_000;

/**
 * A snapshot this much older than the window still counts as its baseline.
 *
 * Hiscores sync every six hours and take a budgeted slice, so the nearest
 * snapshot to a week ago is rarely exactly a week old. Insisting on one
 * would report "no history" for an account that plainly has some.
 */
export const BASELINE_SLACK_MS = 3 * 86_400_000;

export type XpGained = {
  /** Null when there is no earlier snapshot to compare against. */
  xp: number | null;
  /** How long the comparison actually spans, which is rarely exactly a week. */
  overMs: number | null;
  /** Per skill, biggest first. Empty when unknown. */
  bySkill: { skill: string; xp: number }[];
};

export function xpGained(
  snapshots: Snapshot[],
  now: Date = new Date(),
  windowMs: number = WEEK_MS
): XpGained {
  if (snapshots.length < 2) return { xp: null, overMs: null, bySkill: [] };

  // Newest first, so the head is "now" and we look backwards for a baseline.
  const sorted = [...snapshots].sort((a, b) => b.takenAt.getTime() - a.takenAt.getTime());
  const latest = sorted[0];
  const cutoff = now.getTime() - windowMs;

  // The oldest snapshot still inside the window, falling back to the newest
  // one outside it when nothing qualifies — but only if it is close enough
  // that calling the result "this week" is not a lie.
  const inside = sorted.filter((s) => s.takenAt.getTime() >= cutoff);
  const baseline =
    inside.length > 1
      ? inside[inside.length - 1]
      : sorted.find((s) => s.takenAt.getTime() < cutoff && s.takenAt.getTime() >= cutoff - BASELINE_SLACK_MS);

  if (!baseline || baseline === latest) return { xp: null, overMs: null, bySkill: [] };

  const bySkill: { skill: string; xp: number }[] = [];
  for (const [skill, row] of Object.entries(latest.skills)) {
    if (skill === 'overall') continue;
    const before = baseline.skills[skill]?.xp ?? 0;
    const delta = row.xp - before;
    // Negative deltas happen when the hiscores briefly drop a row. They are
    // noise, not XP loss, and showing them would be alarming nonsense.
    if (delta > 0) bySkill.push({ skill, xp: delta });
  }
  // Alphabetical on a tie, so two skills with equal gains do not swap
  // places between page loads.
  bySkill.sort((a, b) => (b.xp === a.xp ? a.skill.localeCompare(b.skill) : b.xp - a.xp));

  return {
    xp: Math.max(0, latest.totalXp - baseline.totalXp),
    overMs: latest.takenAt.getTime() - baseline.takenAt.getTime(),
    bySkill,
  };
}

export type NextLevel = {
  skill: string;
  level: number;
  /** The level you are heading for. */
  next: number;
  xpToGo: number;
  /** How far through the current level, 0–100. */
  progressPct: number;
};

/**
 * The level-ups you are closest to.
 *
 * Sorted by XP remaining, not by level, because the useful question is
 * "what is nearly done" rather than "what is highest". Skills already at 99
 * are excluded — there is no next level to be close to.
 */
export function nextLevels(skills: Record<string, SkillRow>, limit = 3): NextLevel[] {
  const out: NextLevel[] = [];

  for (const [skill, row] of Object.entries(skills)) {
    if (skill === 'overall') continue;
    const level = levelFromXp(row.xp);
    if (level >= MAX_LEVEL) continue;

    const toGo = xpToNextLevel(row.xp);
    if (toGo <= 0) continue;

    const base = xpForLevel(level);
    const span = xpForLevel(level + 1) - base;
    const progressPct = span > 0 ? Math.min(100, Math.max(0, ((row.xp - base) / span) * 100)) : 0;

    out.push({ skill, level, next: level + 1, xpToGo: toGo, progressPct });
  }

  return out
    .sort((a, b) => (a.xpToGo === b.xpToGo ? a.skill.localeCompare(b.skill) : a.xpToGo - b.xpToGo))
    .slice(0, limit);
}

export type ActivityHighlight = {
  name: string;
  score: number;
  kind: 'clue' | 'boss' | 'minigame';
};

/**
 * Activities worth showing.
 *
 * Unranked rows are dropped rather than shown as zero. The hiscores simply
 * omit what you are not ranked in, so a boss killed twice and a boss never
 * fought arrive identical — and printing "0" against the second states
 * something the data does not know.
 */
export function activityHighlights(
  activities: Activity[],
  kind: 'clue' | 'boss' | 'minigame',
  limit = 4
): ActivityHighlight[] {
  return activities
    .filter((a) => a.kind === kind && typeof a.score === 'number' && a.score > 0)
    .map((a) => ({ name: a.name, score: a.score as number, kind: a.kind }))
    .sort((a, b) => (b.score === a.score ? a.name.localeCompare(b.name) : b.score - a.score))
    .slice(0, limit);
}

/** Total clue scrolls completed across every tier, or null when unranked. */
export function totalClues(activities: Activity[]): number | null {
  const clues = activities.filter((a) => a.kind === 'clue' && typeof a.score === 'number');
  if (clues.length === 0) return null;

  // Jagex ships an "All" row alongside the per-tier ones. Summing everything
  // would double-count it.
  const all = clues.find((a) => /\ball\b/i.test(a.name));
  if (all && typeof all.score === 'number' && all.score > 0) return all.score;

  const tiers = clues.filter((a) => !/\ball\b/i.test(a.name));
  const sum = tiers.reduce((n, a) => n + (a.score ?? 0), 0);
  return sum > 0 ? sum : null;
}

/** "3d", "16h" — how long a gain was measured over. */
export function spanLabel(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms) || ms <= 0) return 'unknown';
  const hours = ms / 3_600_000;
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
