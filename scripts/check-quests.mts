/**
 * Is the quest dataset internally sound?
 *
 * A prerequisite naming a quest that is not defined would silently vanish
 * from every plan — the planner skips what it cannot find, so the page would
 * confidently show a shorter path than really exists. That is the worst
 * failure this dataset has, because it looks like good news.
 *
 * Needs no database.
 */

const { QUESTS, UNLOCKS, questMap, referencedQuestIds } = await import('@/lib/osrs/quest-data');
const { expand } = await import('@/lib/osrs/quests');
const { SKILLS } = await import('@/lib/osrs/skills');

let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.error(`  ✗ ${msg}`);
};

const byId = questMap();

// Every referenced quest exists.
for (const id of referencedQuestIds()) {
  if (!byId.has(id)) fail(`prerequisite "${id}" is referenced but not defined`);
}

// Ids are unique.
const seen = new Set<string>();
for (const q of QUESTS) {
  if (seen.has(q.id)) fail(`duplicate quest id "${q.id}"`);
  seen.add(q.id);
  if (!q.source.startsWith('https://oldschool.runescape.wiki/')) {
    fail(`${q.id} has no wiki source`);
  }
}

// Skill keys must match the hiscores parser, or a requirement silently
// compares against a level that is never populated.
const skillKeys = new Set(SKILLS.map((s: { key: string }) => s.key));
for (const q of QUESTS) {
  for (const r of [...q.startSkills, ...q.completeSkills]) {
    if (!skillKeys.has(r.skill)) fail(`${q.id} requires unknown skill "${r.skill}"`);
    if (r.level < 1 || r.level > 99) fail(`${q.id} has an impossible ${r.skill} level ${r.level}`);
  }
}

// Anything needed to START must also be needed to COMPLETE — you cannot
// lose a requirement by playing further.
for (const q of QUESTS) {
  for (const s of q.startSkills) {
    const c = q.completeSkills.find((x) => x.skill === s.skill);
    if (!c || c.level < s.level) {
      fail(`${q.id} needs ${s.skill} ${s.level} to start but less to complete`);
    }
  }
}

// No cycles, and every unlock resolves to at least one step.
for (const u of UNLOCKS) {
  const steps = expand(u, byId);
  if (steps.length === 0) fail(`unlock "${u.id}" expands to nothing`);
  for (const n of u.needs) {
    if (!byId.has(n.quest)) fail(`unlock "${u.id}" needs undefined quest "${n.quest}"`);
  }
  if (!u.source.startsWith('https://oldschool.runescape.wiki/')) {
    fail(`unlock ${u.id} has no wiki source`);
  }
}

// A quest must not require itself, directly or through a chain.
const reaches = (from: string, target: string, seenIds = new Set<string>()): boolean => {
  if (seenIds.has(from)) return false;
  seenIds.add(from);
  const q = byId.get(from);
  if (!q) return false;
  return q.requires.some((r) => r === target || reaches(r, target, seenIds));
};
for (const q of QUESTS) {
  if (reaches(q.id, q.id)) fail(`${q.id} is part of a requirement cycle`);
}

if (problems) {
  console.error(`\ncheck:quests — ${problems} problem${problems === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(
  `check:quests — ${QUESTS.length} quests, ${UNLOCKS.length} unlocks, all references resolve and every entry is sourced`
);
