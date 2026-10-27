/**
 * The JSON hiscores parser, against fixtures shaped like Jagex's response.
 *
 * The point of this endpoint is that it cannot be thrown out of alignment
 * by a new skill or boss, so the tests below deliberately include unknown
 * entries and reordered rows — the cases that silently corrupted the CSV.
 */
let fail = 0;
let checks = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` WANT ${JSON.stringify(want)}`}`
  );
};
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const { parseHiscoresJson, recordedActivities } = await import('@/lib/osrs/hiscores-json');
const { SKILLS } = await import('@/lib/osrs/skills');

console.log('--- a normal response ---');
// Built from SKILLS so it is COMPLETE. A partial response is a real warning
// condition, so a hand-written four-skill fixture would trip it and tell us
// nothing useful.
const fullSkills = SKILLS.map((m, i) => ({
  id: i,
  name: m.name,
  rank: 500 + i,
  level: m.key === 'overall' ? 1500 : 70,
  xp: m.key === 'overall' ? 50_000_000 : 737_627,
}));
// Override a couple so the assertions below are about specific values.
fullSkills.find((s) => s.name === 'Magic')!.xp = 203_254;
fullSkills.find((s) => s.name === 'Magic')!.level = 57;
fullSkills.find((s) => s.name === 'Attack')!.rank = 500;

const normal = parseHiscoresJson({
  skills: fullSkills,
  activities: [
    { id: 0, name: 'League Points', rank: -1, score: -1 },
    { id: 6, name: 'Clue Scrolls (all)', rank: 4000, score: 212 },
    { id: 8, name: 'Clue Scrolls (easy)', rank: 5000, score: 90 },
    { id: 40, name: 'Zulrah', rank: 12000, score: 1043 },
    { id: 41, name: 'Vorkath', rank: 9000, score: 2210 },
    { id: 50, name: 'Soul Wars Zeal', rank: 700, score: 5000 },
  ],
});
eq('attack level', normal.skills.attack.level, 70);
eq('magic xp', normal.skills.magic.xp, 203_254);
eq('rank preserved', normal.skills.attack.rank, 500);
eq('no warnings', normal.warnings.length, 0);

console.log('--- unranked is null, not zero or -1 ---');
const unranked = parseHiscoresJson({
  skills: [{ name: 'Attack', rank: -1, level: 1, xp: -1 }],
  activities: [{ name: 'Zulrah', rank: -1, score: -1 }],
});
eq('unranked rank is null', unranked.skills.attack.rank, null);
eq('negative xp becomes 0, never -1', unranked.skills.attack.xp, 0);
eq('unranked activity score is null', unranked.activities[0].score, null);

console.log('--- hitpoints floor ---');
const fresh = parseHiscoresJson({
  skills: [{ name: 'Hitpoints', rank: -1, level: 1, xp: 0 }],
  activities: [],
});
eq('hitpoints never below 10', fresh.skills.hitpoints.level, 10);

console.log('--- the whole point: a NEW skill shifts nothing ---');
// A skill Jagex has not shipped, inserted in the middle. On the positional
// CSV this would move every value after it by one line.
const withNewSkill = parseHiscoresJson({
  skills: [
    ...fullSkills.slice(0, 3),
    { id: 99, name: 'Shapeshifting', rank: 10, level: 42, xp: 60_000 },
    ...fullSkills.slice(3),
  ],
  activities: [],
});
eq('magic is still magic despite a new skill before it', withNewSkill.skills.magic.level, 57);
eq('attack untouched', withNewSkill.skills.attack.xp, 737_627);
ok(
  'unknown skill is reported',
  withNewSkill.warnings.some((w) => w.includes('Shapeshifting'))
);

console.log('--- order does not matter at all ---');
const shuffled = parseHiscoresJson({
  skills: fullSkills.slice().reverse(),
  activities: [],
});
eq('magic still correct when listed first', shuffled.skills.magic.level, 57);
eq('attack still correct when listed second', shuffled.skills.attack.level, 70);

console.log('--- field-name tolerance ---');
const alt = parseHiscoresJson({
  skills: [{ name: 'Attack', rank: 5, level: 70, experience: 737_627 }],
  activities: [{ name: 'Zulrah', rank: 5, count: 1043 }],
});
eq('reads "experience" as well as "xp"', alt.skills.attack.xp, 737_627);
eq('reads "count" as well as "score"', alt.activities[0].score, 1043);

console.log('--- classification ---');
eq('clues detected', normal.activities.find((a) => a.name === 'Clue Scrolls (all)')!.kind, 'clue');
eq('bosses default', normal.activities.find((a) => a.name === 'Zulrah')!.kind, 'boss');
eq(
  'minigames detected',
  normal.activities.find((a) => a.name === 'Soul Wars Zeal')!.kind,
  'minigame'
);
ok(
  'an unknown row is treated as a boss rather than dropped',
  parseHiscoresJson({
    skills: [{ name: 'Attack', rank: 1, level: 1, xp: 0 }],
    activities: [{ name: 'Some New Boss', rank: 1, score: 5 }],
  }).activities[0].kind === 'boss'
);

console.log('--- recordedActivities ---');
const bosses = recordedActivities(normal.activities, 'boss');
eq('only recorded rows', bosses.length, 2);
eq('biggest first', bosses[0].name, 'Vorkath');
eq('unranked excluded', recordedActivities(unranked.activities, 'boss').length, 0);

console.log('--- malformed input ---');
try {
  parseHiscoresJson({ nope: true });
  fail++;
  console.log('  ✗ should have thrown on a missing skills array');
} catch (e) {
  ok('missing skills array rejected', (e as Error).message.includes('no skills array'));
}
const noActivities = parseHiscoresJson({
  skills: [{ name: 'Attack', rank: 1, level: 5, xp: 100 }],
});
ok(
  'missing activities warns rather than throws',
  noActivities.warnings.some((w) => w.includes('activities'))
);

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
process.exit(fail ? 1 : 0);
