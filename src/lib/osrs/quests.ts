/**
 * What stands between you and a thing you want.
 *
 * Every quest planner answers "what are this quest's requirements". That is
 * the easy half and it is not the question people ask. The question is "I
 * want fairy rings — what do I actually have to do", and answering it
 * correctly needs three distinctions the obvious model throws away:
 *
 * START VERSUS COMPLETE. A quest's skill requirements are usually needed to
 * FINISH it, not to begin. Fairytale II lists 40 Thieving, 49 Farming and 57
 * Herblore — and fairy rings need only that the quest be STARTED, so none of
 * those levels are on the path. A planner that cannot tell these apart sends
 * someone to grind Herblore from 1 to 57 for nothing. That is not a corner
 * case; it is the single most useful thing this page says.
 *
 * PARTIAL COMPLETION AS A GOAL. "Progress until you are granted permission"
 * is a real and common unlock condition. Modelling goals as "quest complete"
 * only cannot express it.
 *
 * BOOSTABLE OR NOT. A level you can reach with a potion for one action is a
 * different obligation from one you must train to. Fairytale II's Farming
 * and Herblore are boostable; its Thieving is not.
 *
 * The data lives in quest-data.ts, compiled from the wiki and cited per
 * entry. Requirements are facts and carry no licence; nothing here copies
 * the wiki's prose.
 */

export type Stage = 'started' | 'complete';

export type SkillReq = {
  /** Lower-case skill key, matching lib/osrs/skills.ts. */
  skill: string;
  level: number;
  /** Reachable with a temporary boost for the one action that needs it. */
  boostable: boolean;
};

export type Quest = {
  id: string;
  name: string;
  members: boolean;
  /** Quests that must be COMPLETE before this one can be started. */
  requires: string[];
  /** Levels needed to begin. Usually none. */
  startSkills: SkillReq[];
  /** Levels needed to finish. Includes anything in startSkills. */
  completeSkills: SkillReq[];
  /** Quest points needed before it can be started. */
  pointsRequired?: number;
  /** Items you must have with you. Kept to the ones that block progress. */
  items?: string[];
  /** The wiki page these facts were read from. */
  source: string;
};

export type Unlock = {
  id: string;
  name: string;
  /** One line on what it is and why it is worth having. */
  blurb: string;
  needs: { quest: string; stage: Stage }[];
  /** Requirements that are not quests — an item to carry, say. */
  alsoNeeds?: string[];
  source: string;
};

export type SkillGap = {
  skill: string;
  need: number;
  have: number;
  boostable: boolean;
};

export type Step = {
  quest: Quest;
  /** How far through this quest you need to get. */
  stage: Stage;
  status: 'done' | 'ready' | 'blocked';
  /** Quests that must come first and are not done yet. */
  waitingOn: string[];
  /** Levels short of what this step needs. */
  gaps: SkillGap[];
  /** Quest points short, if any. */
  pointsShort: number;
};

export type Plan = {
  unlock: Unlock;
  steps: Step[];
  /** True when every step is done. */
  complete: boolean;
  /** Steps you could start right now. */
  ready: Step[];
  /** The highest level needed in each skill across the whole plan. */
  levelsNeeded: SkillGap[];
  /** Quests still to do. */
  questsLeft: number;
};

/** The levels a step actually demands, which depends on how far you must get. */
export function skillsFor(quest: Quest, stage: Stage): SkillReq[] {
  return stage === 'complete' ? quest.completeSkills : quest.startSkills;
}

/**
 * Every quest involved in reaching an unlock, in an order you could do them.
 *
 * A quest named at stage `started` still needs all its own prerequisites
 * COMPLETE — you cannot begin a quest whose prerequisites are unfinished —
 * so the recursion always descends at `complete` even when the parent is
 * only wanted started.
 *
 * Where a quest is reachable at both stages, complete wins: it is the
 * stronger obligation, and doing it satisfies the weaker one.
 */
export function expand(
  unlock: Unlock,
  quests: Map<string, Quest>
): { quest: Quest; stage: Stage }[] {
  const stageOf = new Map<string, Stage>();
  const order: string[] = [];

  const visit = (id: string, stage: Stage, seen: Set<string>) => {
    const quest = quests.get(id);
    // A dangling reference is a data error, not a runtime one. Skipping it
    // keeps the page useful; check:quests is what catches it.
    if (!quest) return;

    // Cycles cannot occur in real quest data, but the dataset is written by
    // hand and a cycle here would hang the request rather than fail it.
    if (seen.has(id)) return;

    const existing = stageOf.get(id);

    // 'complete' is the stronger obligation and subsumes 'started', so once
    // a quest is recorded as needing completion there is nothing to revisit.
    if (existing === 'complete') return;
    if (existing === 'started' && stage === 'started') return;

    // First visit: walk its prerequisites and take its place in the order.
    // On an upgrade from 'started' to 'complete' the prerequisites are the
    // same set and the position is unchanged, so only the stage moves.
    if (existing === undefined) {
      const next = new Set(seen).add(id);
      for (const req of quest.requires) visit(req, 'complete', next);
      order.push(id);
    }

    stageOf.set(id, stage);
  };

  for (const need of unlock.needs) visit(need.quest, need.stage, new Set());

  return order
    .map((id) => ({ quest: quests.get(id)!, stage: stageOf.get(id) ?? 'complete' }))
    .filter((s) => s.quest);
}

/**
 * The plan: what is done, what you could start now, and what is blocking the
 * rest.
 *
 * `done` holds quest ids the player has completed. A quest needed only at
 * `started` is NOT satisfied by being started — the app has no way to know
 * someone is mid-quest — so partial steps read as outstanding until the
 * player ticks them off. Said plainly on the page rather than guessed at.
 */
export function planUnlock(
  unlock: Unlock,
  quests: Map<string, Quest>,
  done: Set<string>,
  levels: Map<string, number>,
  questPoints = 0
): Plan {
  const expanded = expand(unlock, quests);

  const steps: Step[] = expanded.map(({ quest, stage }) => {
    const isDone = done.has(quest.id);

    // A finished quest has nothing outstanding, whatever the numbers say.
    // Reporting "Crafting 31 — you have 9" against a quest someone has
    // already completed is noise at best, and reads as an accusation that
    // they are lying at worst.
    if (isDone) {
      return {
        quest,
        stage,
        status: 'done' as const,
        waitingOn: [],
        gaps: [],
        pointsShort: 0,
      };
    }

    const waitingOn = quest.requires.filter((r) => !done.has(r));

    const gaps: SkillGap[] = [];
    for (const req of skillsFor(quest, stage)) {
      const have = levels.get(req.skill) ?? 1;
      if (have < req.level) {
        gaps.push({ skill: req.skill, need: req.level, have, boostable: req.boostable });
      }
    }

    const pointsShort = Math.max(0, (quest.pointsRequired ?? 0) - questPoints);

    const status: Step['status'] = isDone
      ? 'done'
      : waitingOn.length === 0 && gaps.length === 0 && pointsShort === 0
        ? 'ready'
        : 'blocked';

    return { quest, stage, status, waitingOn, gaps, pointsShort };
  });

  const outstanding = steps.filter((s) => s.status !== 'done');

  // The highest level per skill across everything still to do. Reported as
  // one figure per skill rather than per quest, because you train a skill
  // once to its highest requirement, not once per quest that wants it.
  const highest = new Map<string, SkillGap>();
  for (const step of outstanding) {
    for (const gap of step.gaps) {
      const existing = highest.get(gap.skill);
      if (!existing || gap.need > existing.need) {
        // Boostable only survives if EVERY requirement at that level is
        // boostable — one hard requirement means you are training it.
        highest.set(gap.skill, {
          ...gap,
          boostable: existing ? existing.boostable && gap.boostable : gap.boostable,
        });
      } else if (!gap.boostable) {
        existing.boostable = false;
      }
    }
  }

  return {
    unlock,
    steps,
    complete: outstanding.length === 0,
    ready: outstanding.filter((s) => s.status === 'ready'),
    levelsNeeded: [...highest.values()].sort((a, b) => b.need - a.need),
    questsLeft: outstanding.length,
  };
}

/** Plans for every unlock, nearest to finished first. */
export function rankUnlocks(
  unlocks: Unlock[],
  quests: Map<string, Quest>,
  done: Set<string>,
  levels: Map<string, number>,
  questPoints = 0
): Plan[] {
  return unlocks
    .map((u) => planUnlock(u, quests, done, levels, questPoints))
    .sort((a, b) => {
      // Finished ones last: they are no longer a goal.
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      if (a.questsLeft !== b.questsLeft) return a.questsLeft - b.questsLeft;
      // Then by how much training is left, so "nothing but quests" sorts
      // above "and 57 Herblore".
      const levelsOf = (p: Plan) => p.levelsNeeded.reduce((n, g) => n + (g.need - g.have), 0);
      return levelsOf(a) - levelsOf(b);
    });
}

/** "2 quests" / "1 quest". */
export function questCount(n: number): string {
  return `${n} quest${n === 1 ? '' : 's'}`;
}
