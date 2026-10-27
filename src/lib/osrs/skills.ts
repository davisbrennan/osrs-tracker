/**
 * The hiscores.
 *
 * Endpoint (CSV, one "rank,level,xp" per line):
 *   https://secure.runescape.com/m=hiscore_oldschool/index_lite.ws?player=NAME
 *
 * The response is positional — there are no labels — so SKILLS below IS the
 * parser. Get the order wrong and every stat is silently attributed to the
 * wrong skill, which looks plausible and is completely wrong. That is why
 * parseHiscores returns warnings instead of trusting itself.
 *
 * Unranked entries come back as -1.
 */

export type SkillKey =
  | 'overall'
  | 'attack'
  | 'defence'
  | 'strength'
  | 'hitpoints'
  | 'ranged'
  | 'prayer'
  | 'magic'
  | 'cooking'
  | 'woodcutting'
  | 'fletching'
  | 'fishing'
  | 'firemaking'
  | 'crafting'
  | 'smithing'
  | 'mining'
  | 'herblore'
  | 'agility'
  | 'thieving'
  | 'slayer'
  | 'farming'
  | 'runecraft'
  | 'hunter'
  | 'construction'
  | 'sailing';

export type SkillMeta = {
  key: SkillKey;
  name: string;
  /** Combat skills get grouped first in the UI, as the game does. */
  combat: boolean;
  /** Members-only skills are dimmed for free accounts. */
  members: boolean;
};

/**
 * Order matters absolutely — this is the wire format.
 *
 * The first 24 entries (overall plus 23 skills) have been stable for years.
 *
 * Sailing is listed last because that is where a newly released skill is
 * normally appended, so existing parsers keep working. That position has NOT
 * been verified against a live response, which is why parseHiscores warns
 * when the row count disagrees with this list rather than assuming. Verify it
 * once against a known account and correct here if needed; it is the only
 * place that would need changing.
 */
export const SKILLS: SkillMeta[] = [
  { key: 'overall', name: 'Overall', combat: false, members: false },
  { key: 'attack', name: 'Attack', combat: true, members: false },
  { key: 'defence', name: 'Defence', combat: true, members: false },
  { key: 'strength', name: 'Strength', combat: true, members: false },
  { key: 'hitpoints', name: 'Hitpoints', combat: true, members: false },
  { key: 'ranged', name: 'Ranged', combat: true, members: false },
  { key: 'prayer', name: 'Prayer', combat: true, members: false },
  { key: 'magic', name: 'Magic', combat: true, members: false },
  { key: 'cooking', name: 'Cooking', combat: false, members: false },
  { key: 'woodcutting', name: 'Woodcutting', combat: false, members: false },
  { key: 'fletching', name: 'Fletching', combat: false, members: true },
  { key: 'fishing', name: 'Fishing', combat: false, members: false },
  { key: 'firemaking', name: 'Firemaking', combat: false, members: false },
  { key: 'crafting', name: 'Crafting', combat: false, members: false },
  { key: 'smithing', name: 'Smithing', combat: false, members: false },
  { key: 'mining', name: 'Mining', combat: false, members: false },
  { key: 'herblore', name: 'Herblore', combat: false, members: true },
  { key: 'agility', name: 'Agility', combat: false, members: true },
  { key: 'thieving', name: 'Thieving', combat: false, members: true },
  { key: 'slayer', name: 'Slayer', combat: false, members: true },
  { key: 'farming', name: 'Farming', combat: false, members: true },
  { key: 'runecraft', name: 'Runecraft', combat: false, members: false },
  { key: 'hunter', name: 'Hunter', combat: false, members: true },
  { key: 'construction', name: 'Construction', combat: false, members: true },
  { key: 'sailing', name: 'Sailing', combat: false, members: true },
];

export const SKILL_COUNT = SKILLS.length;

/** Every account begins with Hitpoints 10; there is no such thing as HP 1. */
export const HITPOINTS_MINIMUM = 10;

export type SkillRow = {
  key: SkillKey;
  name: string;
  rank: number | null;
  level: number;
  xp: number;
};

export type Hiscores = {
  skills: Record<string, SkillRow>;
  /** Rows after the skills — bosses, clues, minigames — kept raw for later. */
  activityRows: { rank: number | null; score: number | null }[];
  /** Anything that suggests the parse may be misaligned. */
  warnings: string[];
};

/** -1 means unranked, which is different from zero. */
function num(raw: string): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return null;
  return n;
}

/**
 * Parse the lite CSV.
 *
 * Deliberately tolerant about length: Jagex adds rows over time, and a parser
 * that throws on an unexpected row count would break the whole app the day a
 * new boss ships. It warns instead, and the caller decides.
 */
export function parseHiscores(csv: string): Hiscores {
  const warnings: string[] = [];
  const lines = String(csv ?? '')
    .trim()
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return { skills: {}, activityRows: [], warnings: ['The hiscores returned nothing.'] };
  }

  const skills: Record<string, SkillRow> = {};
  const available = Math.min(SKILLS.length, lines.length);

  if (lines.length < SKILLS.length) {
    // Fewer rows than skills means our list is ahead of the live API — most
    // likely Sailing is not in this response. Everything before it is still
    // correctly aligned, so parse what is there and say so.
    warnings.push(
      `The hiscores returned ${lines.length} rows but this app expects at least ${SKILLS.length} ` +
        `skills. Skills beyond row ${lines.length} were not returned — check whether the skill ` +
        `list in src/lib/osrs/skills.ts matches the live API.`
    );
  }

  for (let i = 0; i < available; i++) {
    const parts = lines[i].split(',');
    const meta = SKILLS[i];
    const level = num(parts[1]);
    const xp = num(parts[2]);

    // Unranked skills come back as -1. They are level 1 — except Hitpoints,
    // which every account starts at 10. Defaulting it to 1 produces a
    // character that cannot exist and throws the combat level out.
    const floorLevel = meta.key === 'hitpoints' ? HITPOINTS_MINIMUM : 1;

    skills[meta.key] = {
      key: meta.key,
      name: meta.name,
      rank: num(parts[0]),
      level: level === null ? floorLevel : Math.max(floorLevel, level),
      xp: xp === null ? 0 : xp,
    };
  }

  const activityRows = lines.slice(SKILLS.length).map((line) => {
    const parts = line.split(',');
    return { rank: num(parts[0]), score: num(parts[1]) };
  });

  // A cheap sanity check that catches misalignment: the sum of the individual
  // skill levels should equal the reported overall level.
  const overall = skills.overall;
  if (overall) {
    const summed = Object.values(skills)
      .filter((s) => s.key !== 'overall')
      .reduce((total, s) => total + s.level, 0);
    if (overall.level > 0 && Math.abs(summed - overall.level) > 0) {
      warnings.push(
        `Total level mismatch: the hiscores say ${overall.level} but the individual skills ` +
          `add up to ${summed}. The skill list is probably out of order or missing a skill.`
      );
    }
  }

  return { skills, activityRows, warnings };
}

/** The game's combat level formula. */
export function combatLevel(s: Record<string, SkillRow>): number {
  const lvl = (k: SkillKey) => s[k]?.level ?? 1;
  const base = 0.25 * (lvl('defence') + lvl('hitpoints') + Math.floor(lvl('prayer') / 2));
  const melee = 0.325 * (lvl('attack') + lvl('strength'));
  const range = 0.325 * Math.floor((3 * lvl('ranged')) / 2);
  const mage = 0.325 * Math.floor((3 * lvl('magic')) / 2);
  return Math.floor(base + Math.max(melee, range, mage));
}

/** RSNs are 1–12 characters: letters, digits, spaces, hyphens and underscores. */
export function normaliseRsn(raw: string): string | null {
  const s = String(raw ?? '')
    .trim()
    .replace(/[_\s]+/g, ' ');
  if (!s || s.length > 12) return null;
  if (!/^[a-zA-Z0-9 -]+$/.test(s)) return null;
  return s;
}

/** The hiscores use underscores where a name has spaces. */
export function rsnToQuery(rsn: string): string {
  return encodeURIComponent(rsn.replace(/ /g, '_'));
}
