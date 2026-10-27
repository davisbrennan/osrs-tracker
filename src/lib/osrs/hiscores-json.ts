/**
 * The hiscores, read from Jagex's JSON endpoint.
 *
 * This replaces positional CSV parsing as the primary path, and it is a real
 * correctness upgrade rather than a tidy-up. The CSV at index_lite.ws is an
 * unlabelled list: the Nth line is whichever skill or boss Jagex currently
 * has Nth. Add a skill — Sailing — or a boss, and every value after it shifts
 * by one, silently, while still looking entirely plausible. Several other
 * trackers hit exactly that and migrated here for the same reason.
 *
 * index_lite.json names every entry, so a new boss appears as a new named
 * row and nothing else moves. The CSV parser stays as a fallback for when
 * the JSON endpoint is unavailable, and it keeps its own self-check.
 *
 * Field names are read defensively — xp or experience, score or count —
 * because this endpoint is undocumented and we would rather degrade than
 * throw if Jagex renames something.
 */

import { SKILLS, type SkillKey, type SkillRow, HITPOINTS_MINIMUM } from '@/lib/osrs/skills';

export type Activity = {
  /** Jagex's own name, shown verbatim. */
  name: string;
  rank: number | null;
  /** Kill count, completions, or points, depending on the row. */
  score: number | null;
  kind: ActivityKind;
};

export type ActivityKind = 'clue' | 'boss' | 'minigame';

export type ParsedHiscores = {
  skills: Record<string, SkillRow>;
  activities: Activity[];
  warnings: string[];
};

/**
 * Rows that are not bosses.
 *
 * Matched case-insensitively against the start of the name. Anything
 * unmatched is treated as a boss, which is the right default: the list of
 * bosses grows constantly, while this set barely changes. A miscategorised
 * row still shows its correct name and count — it just sits under the wrong
 * heading, which is a cosmetic problem rather than a wrong number.
 */
const MINIGAME_PREFIXES = [
  'league points',
  'deadman points',
  'bounty hunter',
  'lms',
  'last man standing',
  'pvp arena',
  'soul wars',
  'rifts closed',
  'guardians of the rift',
  'colosseum glory',
  'collections logged',
];

function classify(name: string): ActivityKind {
  const n = name.trim().toLowerCase();
  if (n.includes('clue scroll')) return 'clue';
  if (MINIGAME_PREFIXES.some((p) => n.startsWith(p))) return 'minigame';
  return 'boss';
}

/** -1 is Jagex's "unranked". Zero is a real zero and is kept. */
function valueOrNull(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return n < 0 ? null : n;
}

/** First present key wins; the endpoint is undocumented and has drifted. */
function pick(row: Record<string, unknown>, keys: string[]): unknown {
  for (const k of keys) {
    if (row[k] !== undefined) return row[k];
  }
  return undefined;
}

/** Jagex's display name to our key: "Woodcutting" -> "woodcutting". */
const SKILL_BY_NAME = new Map<string, SkillKey>(
  SKILLS.map((s) => [s.name.trim().toLowerCase(), s.key])
);

export function parseHiscoresJson(body: unknown): ParsedHiscores {
  const warnings: string[] = [];
  const root = body as Record<string, unknown> | null;

  const rawSkills = root?.skills;
  const rawActivities = root?.activities;

  if (!Array.isArray(rawSkills)) {
    throw new Error('The hiscores JSON had no skills array.');
  }

  const skills: Record<string, SkillRow> = {};
  const unknownSkills: string[] = [];

  for (const entry of rawSkills as Record<string, unknown>[]) {
    const name = String(pick(entry, ['name']) ?? '').trim();
    if (!name) continue;

    const key = SKILL_BY_NAME.get(name.toLowerCase());
    if (!key) {
      // A skill we don't know about — Jagex shipped one since this was
      // written. Worth saying, but not worth failing over: every other
      // skill is still correctly named and correctly valued, which is the
      // whole advantage of reading by name.
      unknownSkills.push(name);
      continue;
    }

    const level = valueOrNull(pick(entry, ['level'])) ?? 1;
    const xp = valueOrNull(pick(entry, ['xp', 'experience'])) ?? 0;

    skills[key] = {
      key,
      name: SKILLS.find((s) => s.key === key)!.name,
      rank: valueOrNull(pick(entry, ['rank'])),
      // Every account starts at 10 Hitpoints; an unranked HP reported as 1
      // would make a fresh account compute as combat 1 instead of 3.
      level: key === 'hitpoints' ? Math.max(level, HITPOINTS_MINIMUM) : level,
      xp,
    };
  }

  if (unknownSkills.length > 0) {
    warnings.push(
      `The hiscores returned ${unknownSkills.length} skill(s) this app does not know: ${unknownSkills.join(', ')}. Add them to SKILLS in src/lib/osrs/skills.ts.`
    );
  }

  // Any skill we expect but didn't receive is left absent rather than
  // invented, so the pages show nothing instead of a confident zero.
  const missing = SKILLS.filter((m) => !skills[m.key]).map((m) => m.name);
  if (missing.length > 0 && missing.length < SKILLS.length) {
    warnings.push(`The hiscores did not return: ${missing.join(', ')}.`);
  }

  const activities: Activity[] = [];
  if (Array.isArray(rawActivities)) {
    for (const entry of rawActivities as Record<string, unknown>[]) {
      const name = String(pick(entry, ['name']) ?? '').trim();
      if (!name) continue;
      const score = valueOrNull(pick(entry, ['score', 'count', 'kills']));
      activities.push({
        name,
        rank: valueOrNull(pick(entry, ['rank'])),
        score,
        kind: classify(name),
      });
    }
  } else {
    warnings.push('The hiscores JSON had no activities array.');
  }

  return { skills, activities, warnings };
}

/** Only the rows the player has actually recorded, biggest first. */
export function recordedActivities(activities: Activity[], kind: ActivityKind): Activity[] {
  return activities
    .filter((a) => a.kind === kind && a.score !== null && a.score > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}
