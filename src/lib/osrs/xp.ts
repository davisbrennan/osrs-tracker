/**
 * Experience and levels.
 *
 * The XP curve is fixed by the game and has never changed, so the table is
 * generated once at module load from Jagex's formula rather than hardcoded:
 *
 *   points(L) = floor(L + 300 * 2^(L/7))
 *   xpForLevel(L) = floor( sum of points(1..L-1) / 4 )
 *
 * Two checksums pin it: level 2 is 83 xp and level 99 is 13,034,431 xp. If
 * either moves, the formula has been broken.
 */

export const MAX_LEVEL = 99;
/** The hard cap on a single skill. */
export const MAX_XP = 200_000_000;
/** Level 99 exactly. Kept as a named constant because it reads everywhere. */
export const XP_AT_99 = 13_034_431;

/** xpForLevel[L] = experience required to reach level L. Index 0 is unused. */
export const XP_TABLE: number[] = (() => {
  const table = [0, 0]; // levels 0 and 1 both need 0 xp
  let points = 0;
  for (let level = 1; level < MAX_LEVEL; level++) {
    points += Math.floor(level + 300 * Math.pow(2, level / 7));
    table[level + 1] = Math.floor(points / 4);
  }
  return table;
})();

export function xpForLevel(level: number): number {
  if (level <= 1) return 0;
  if (level >= MAX_LEVEL) return XP_AT_99;
  return XP_TABLE[level];
}

/**
 * The level a given amount of experience represents.
 *
 * Virtual levels (100+) are deliberately not supported: the hiscores cap the
 * reported level at 99 and inventing a different number than the game shows
 * would be confusing rather than helpful.
 */
export function levelFromXp(xp: number): number {
  if (!Number.isFinite(xp) || xp <= 0) return 1;
  for (let level = MAX_LEVEL; level >= 1; level--) {
    if (xp >= XP_TABLE[level]) return level;
  }
  return 1;
}

/** Experience still needed to reach the next level. 0 once 99 is reached. */
export function xpToNextLevel(xp: number): number {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return 0;
  return XP_TABLE[level + 1] - xp;
}

/** How far through the current level, 0–1. Useful for progress bars. */
export function levelProgress(xp: number): number {
  const level = levelFromXp(xp);
  if (level >= MAX_LEVEL) return 1;
  const floorXp = XP_TABLE[level];
  const ceilXp = XP_TABLE[level + 1];
  const span = ceilXp - floorXp;
  if (span <= 0) return 1;
  return Math.min(1, Math.max(0, (xp - floorXp) / span));
}

/** Experience between where you are and a target level. */
export function xpToLevel(currentXp: number, targetLevel: number): number {
  const target = xpForLevel(Math.min(MAX_LEVEL, Math.max(1, targetLevel)));
  return Math.max(0, target - currentXp);
}

export type Projection = {
  xpRemaining: number;
  /** Experience per hour, measured from the player's own history. */
  xpPerHour: number;
  hours: number | null;
  /** When they would arrive, at the measured rate. */
  eta: Date | null;
};

/**
 * Time to a goal, based on the rate this player actually achieved rather than
 * a wiki-optimal rate. A guide saying 55k/hr is useless to someone who plays
 * while watching television; their own last-fortnight average is not.
 */
export function project(
  currentXp: number,
  targetLevel: number,
  xpPerHour: number,
  from: Date = new Date()
): Projection {
  const xpRemaining = xpToLevel(currentXp, targetLevel);
  if (xpRemaining <= 0) {
    return { xpRemaining: 0, xpPerHour, hours: 0, eta: from };
  }
  if (!Number.isFinite(xpPerHour) || xpPerHour <= 0) {
    return { xpRemaining, xpPerHour: 0, hours: null, eta: null };
  }
  const hours = xpRemaining / xpPerHour;
  return {
    xpRemaining,
    xpPerHour,
    hours,
    eta: new Date(from.getTime() + hours * 3_600_000),
  };
}

/**
 * Experience per hour between two snapshots.
 *
 * Returns null rather than a wild number when the window is too short to mean
 * anything — two snapshots a minute apart would imply an absurd rate.
 */
export function ratePerHour(
  earlierXp: number,
  earlierAt: Date,
  laterXp: number,
  laterAt: Date,
  minMinutes = 30
): number | null {
  const ms = laterAt.getTime() - earlierAt.getTime();
  if (ms < minMinutes * 60_000) return null;
  const gained = laterXp - earlierXp;
  if (gained <= 0) return 0;
  return gained / (ms / 3_600_000);
}

/** 13,034,431 reads badly in a table; 13.0M does not. */
export function formatXp(xp: number): string {
  if (!Number.isFinite(xp)) return '0';
  const abs = Math.abs(xp);
  if (abs >= 10_000_000) return `${(xp / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000_000) return `${(xp / 1_000_000).toFixed(2)}M`;
  if (abs >= 100_000) return `${Math.round(xp / 1000)}K`;
  if (abs >= 10_000) return `${(xp / 1000).toFixed(1)}K`;
  return Math.round(xp).toLocaleString('en-US');
}
