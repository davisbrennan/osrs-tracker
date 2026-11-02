/**
 * Player stats from stored snapshots.
 *
 * Two distinctions carry most of these tests, and both are the difference
 * between a figure and a false statement:
 *
 *   - No earlier snapshot is not "0 XP this week". One is "we have not
 *     watched for a week"; the other says you did nothing.
 *   - Unranked is not zero. The hiscores omit what you are not ranked in,
 *     so a boss killed twice and a boss never fought arrive identical.
 */

const {
  xpGained,
  nextLevels,
  activityHighlights,
  totalClues,
  spanLabel,
  WEEK_MS,
} = await import('@/lib/osrs/progress-stats');
const { xpForLevel } = await import('@/lib/osrs/xp');

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

const NOW = new Date('2026-11-01T18:00:00Z');
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

const snap = (days: number, totalXp: number, skills: Record<string, number> = {}) => ({
  takenAt: daysAgo(days),
  totalXp,
  totalLevel: 411,
  skills: Object.fromEntries(
    Object.entries(skills).map(([k, xp]) => [k, { level: 1, xp }])
  ) as Record<string, { level: number; xp: number }>,
});

console.log('\nNo history is not zero progress');
{
  // The whole point. "0 XP this week" is a claim about a week nobody
  // watched, and it reads as an accusation.
  eq('one snapshot → unknown', xpGained([snap(0, 100_000)], NOW).xp, null);
  eq('no snapshots → unknown', xpGained([], NOW).xp, null);
  eq('and no per-skill breakdown either', xpGained([snap(0, 100_000)], NOW).bySkill, []);

  // A baseline far older than the window is not "this week" and must not
  // be passed off as it.
  const ancient = xpGained([snap(0, 500_000), snap(90, 100_000)], NOW);
  eq('a 90-day-old baseline is refused', ancient.xp, null);
}

console.log('\nXP over the week it was actually measured');
{
  const g = xpGained(
    [
      snap(0, 500_000, { magic: 200_000, woodcutting: 130_000 }),
      snap(6, 400_000, { magic: 180_000, woodcutting: 100_000 }),
    ],
    NOW
  );
  eq('total gained', g.xp, 100_000);
  ok('over roughly six days', (g.overMs ?? 0) > 5 * 86_400_000, String(g.overMs));
  eq('biggest skill first', g.bySkill[0], { skill: 'woodcutting', xp: 30_000 });
  eq('then the next', g.bySkill[1], { skill: 'magic', xp: 20_000 });

  // Equal gains must not reshuffle between loads, so ties break
  // alphabetically rather than by whatever order the object happened in.
  const tied = xpGained(
    [snap(0, 500_000, { zalcano: 10, agility: 10 }), snap(5, 400_000, { zalcano: 0, agility: 0 })],
    NOW
  );
  eq('ties are stable', tied.bySkill.map((s) => s.skill), ['agility', 'zalcano']);

  // The span is reported because it is rarely exactly seven days, and
  // calling a 3-day gain "this week" without saying so overstates it.
  eq('span is a real duration, not assumed', spanLabel(g.overMs), '6d');
}

console.log('\nA snapshot just outside the window can still be the baseline');
{
  // Hiscores sync every six hours in budgeted slices, so the nearest
  // snapshot to a week ago is rarely inside it. Being strict would report
  // "no history" for an account that plainly has some.
  const g = xpGained([snap(0, 500_000), snap(8, 400_000)], NOW);
  eq('an 8-day-old baseline is accepted', g.xp, 100_000);
  ok('and the span says 8 days, not 7', spanLabel(g.overMs) === '8d', spanLabel(g.overMs));
}

console.log('\nThe hiscores dropping a row is not XP loss');
{
  // A skill briefly missing from the feed produces a negative delta.
  // Showing "-40,000 Magic" would be alarming nonsense.
  const g = xpGained(
    [snap(0, 500_000, { magic: 100_000 }), snap(3, 400_000, { magic: 140_000 })],
    NOW
  );
  ok('no negative skill rows', g.bySkill.every((s) => s.xp > 0), JSON.stringify(g.bySkill));
  ok('and the total never goes below zero', (g.xp ?? 0) >= 0);
}

console.log('\nClosest level-ups, by what is nearly done');
{
  // One xp into level 50, and nearly at level 61.
  const skills = {
    magic: { level: 50, xp: xpForLevel(50) },
    thieving: { level: 60, xp: xpForLevel(61) - 100 },
    cooking: { level: 30, xp: xpForLevel(30) + 5 },
  };
  const next = nextLevels(skills, 3);
  eq('closest first', next[0].skill, 'thieving');
  eq('heading for the next level', next[0].next, 61);
  eq('with the real gap', next[0].xpToGo, 100);
  ok('progress is a percentage', next[0].progressPct > 90, String(next[0].progressPct));

  // A skill at the very start of a level is the furthest away, not the
  // closest — sorting by level rather than remaining XP would invert this.
  eq('freshly levelled sorts last', next[next.length - 1].skill, 'magic');

  // 99 has no next level to be close to.
  const maxed = nextLevels({ magic: { level: 99, xp: xpForLevel(99) } }, 3);
  eq('a maxed skill is excluded', maxed, []);

  eq('overall is not a skill', nextLevels({ overall: { level: 99, xp: 1 } }, 3), []);
  eq('the limit is honoured', nextLevels(skills, 1).length, 1);
}

console.log('\nUnranked is not zero');
{
  const acts = [
    { name: 'Zulrah', rank: 100, score: 42, kind: 'boss' as const },
    // Never fought: the hiscores report this as unranked, not as zero.
    { name: 'Vorkath', rank: null, score: null, kind: 'boss' as const },
    { name: 'Obor', rank: 5, score: 0, kind: 'boss' as const },
    { name: 'Hespori', rank: 9, score: 7, kind: 'boss' as const },
  ];
  const bosses = activityHighlights(acts, 'boss', 4);
  eq('only genuinely recorded kills', bosses.map((b) => b.name), ['Zulrah', 'Hespori']);
  ok('a null score is dropped', !bosses.some((b) => b.name === 'Vorkath'));
  ok('and a zero score too', !bosses.some((b) => b.name === 'Obor'));
  eq('biggest first', bosses[0].score, 42);

  eq('a kind with nothing recorded is empty', activityHighlights(acts, 'clue', 4), []);
  eq('an empty list stays empty', activityHighlights([], 'boss', 4), []);
}

console.log('\nClue totals do not double-count the "All" row');
{
  // Jagex ships an "All" row beside the per-tier ones. Summing everything
  // counts every clue twice.
  const withAll = [
    { name: 'Clue Scrolls (all)', rank: 1, score: 30, kind: 'clue' as const },
    { name: 'Clue Scrolls (easy)', rank: 1, score: 20, kind: 'clue' as const },
    { name: 'Clue Scrolls (medium)', rank: 1, score: 10, kind: 'clue' as const },
  ];
  eq('the all row wins', totalClues(withAll), 30);

  const tiersOnly = [
    { name: 'Clue Scrolls (easy)', rank: 1, score: 20, kind: 'clue' as const },
    { name: 'Clue Scrolls (medium)', rank: 1, score: 10, kind: 'clue' as const },
  ];
  eq('without it, the tiers are summed', totalClues(tiersOnly), 30);

  eq('no clues at all → unknown, not zero', totalClues([]), null);
  eq(
    'all unranked → unknown',
    totalClues([{ name: 'Clue Scrolls (easy)', rank: null, score: null, kind: 'clue' }]),
    null
  );
}

console.log('\nSpan labels');
{
  eq('hours under two days', spanLabel(30 * 3_600_000), '30h');
  eq('days beyond that', spanLabel(6 * 86_400_000), '6d');
  eq('null is unknown', spanLabel(null), 'unknown');
  eq('zero is unknown, not "0h"', spanLabel(0), 'unknown');
  eq('negative is unknown', spanLabel(-5), 'unknown');
}

console.log('\nThe window is a week');
{
  eq('seven days', WEEK_MS, 7 * 86_400_000);
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
