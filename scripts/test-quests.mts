/**
 * The unlock planner.
 *
 * The fixture is Brennan's actual account on 1 Nov 2026 — 33 QP, Lost City,
 * Priest in Peril and The Restless Ghost done, Herblore 1, Crafting 9 — and
 * the goal is fairy rings, because that case is where writing this from
 * memory produced three confident errors. Every one of them would have told
 * a real player to go and train something they do not need.
 *
 * So the tests assert the ABSENCE of work as hard as its presence. A planner
 * that over-reports is not conservatively safe; it is wrong in the direction
 * that costs someone a week.
 */

const { planUnlock, expand, rankUnlocks, skillsFor, questCount } = await import(
  '@/lib/osrs/quests'
);
const { QUESTS, UNLOCKS, questMap } = await import('@/lib/osrs/quest-data');

type Plan = Awaited<ReturnType<typeof planUnlock>>;

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

const quests = questMap();
const fairyRings = UNLOCKS.find((u) => u.id === 'fairy-rings')!;
const morytania = UNLOCKS.find((u) => u.id === 'morytania')!;

/** The real account: low levels, three of the chain's quests already done. */
const BRENNAN_DONE = new Set(['lost-city', 'priest-in-peril', 'restless-ghost']);
const BRENNAN_LEVELS = new Map<string, number>([
  ['magic', 57],
  ['ranged', 45],
  ['hitpoints', 39],
  ['defence', 38],
  ['attack', 31],
  ['strength', 31],
  ['firemaking', 29],
  ['woodcutting', 28],
  ['mining', 26],
  ['fletching', 23],
  ['prayer', 15],
  ['crafting', 9],
  ['herblore', 1],
  ['farming', 1],
  ['thieving', 1],
]);

console.log('\nFairy rings from a real low-level account');
{
  const plan = planUnlock(fairyRings, quests, BRENNAN_DONE, BRENNAN_LEVELS, 33) as Plan;

  // The headline claim, and the one that matters: no training at all.
  eq('no skill levels are needed', plan.levelsNeeded, []);
  // Three steps, but only two are whole quests: Fairytale II is wanted
  // started. "Two quests and part of a third" is the honest description,
  // and the distinction is the entire point of the model.
  eq('three steps left', plan.questsLeft, 3);

  const left = plan.steps.filter((s) => s.status !== 'done').map((s) => s.quest.id);
  eq('in order', left, ['nature-spirit', 'fairytale-i', 'fairytale-ii']);

  const whole = plan.steps.filter((s) => s.status !== 'done' && s.stage === 'complete');
  eq('two of them must be finished', whole.length, 2);
  const partial = plan.steps.filter((s) => s.status !== 'done' && s.stage === 'started');
  eq('and one only started', partial.length, 1);
  eq('namely Fairytale II', partial[0].quest.id, 'fairytale-ii');

  // Nature Spirit is startable right now: both its prerequisites are done
  // and it has no skill requirements whatsoever.
  const ns = plan.steps.find((s) => s.quest.id === 'nature-spirit')!;
  eq('Nature Spirit is ready to start', ns.status, 'ready');
  eq('with nothing blocking it', ns.gaps, []);
  eq('and nothing to wait for', ns.waitingOn, []);
}

console.log('\nA finished quest reports nothing outstanding');
{
  // Lost City needs 31 Crafting and 36 Woodcutting to complete. An account
  // that has DONE it but whose hiscores read lower — a stale snapshot, or a
  // level lost to nothing more than my test fixture — must not be shown
  // those as outstanding work. It is done.
  const plan = planUnlock(fairyRings, quests, BRENNAN_DONE, BRENNAN_LEVELS, 33) as Plan;
  const lostCity = plan.steps.find((s) => s.quest.id === 'lost-city')!;
  eq('Lost City is done', lostCity.status, 'done');
  eq('with no gaps listed', lostCity.gaps, []);
  eq('and nothing to wait for', lostCity.waitingOn, []);

  // And it contributes nothing to the training summary.
  ok(
    'its skills are absent from the plan total',
    !plan.levelsNeeded.some((g) => g.skill === 'crafting' || g.skill === 'woodcutting'),
    JSON.stringify(plan.levelsNeeded)
  );
}

console.log('\nThe 57 Herblore that is not actually required');
{
  const plan = planUnlock(fairyRings, quests, BRENNAN_DONE, BRENNAN_LEVELS, 33) as Plan;

  // Fairytale II appears at stage `started`, so its COMPLETION levels —
  // 40 Thieving, 49 Farming, 57 Herblore — are not on the path. Getting
  // this wrong is the difference between "two quests" and "train Herblore
  // from 1 to 57".
  const ft2 = plan.steps.find((s) => s.quest.id === 'fairytale-ii')!;
  eq('Fairytale II is needed only started', ft2.stage, 'started');
  eq('so it asks for no levels', ft2.gaps, []);

  ok(
    'and Herblore appears nowhere in the plan',
    !plan.levelsNeeded.some((g) => g.skill === 'herblore'),
    JSON.stringify(plan.levelsNeeded)
  );
  ok(
    'nor Thieving or Farming',
    !plan.levelsNeeded.some((g) => g.skill === 'thieving' || g.skill === 'farming')
  );

  // But the levels ARE required to finish it, and the model must still know
  // that — a different goal could need the completed quest.
  const asComplete = planUnlock(
    { ...fairyRings, id: 'ft2-complete', needs: [{ quest: 'fairytale-ii', stage: 'complete' }] },
    quests,
    BRENNAN_DONE,
    BRENNAN_LEVELS,
    33
  ) as Plan;
  const skills = asComplete.levelsNeeded.map((g) => g.skill).sort();
  eq('completing it does need all three', skills, ['farming', 'herblore', 'thieving']);
  const herb = asComplete.levelsNeeded.find((g) => g.skill === 'herblore')!;
  eq('at the right level', herb.need, 57);
  eq('from the right starting point', herb.have, 1);
  eq('and it is boostable', herb.boostable, true);
  const thieving = asComplete.levelsNeeded.find((g) => g.skill === 'thieving')!;
  eq('while Thieving is not boostable', thieving.boostable, false);
}

console.log('\nA quest needed only started still needs its prerequisites finished');
{
  // You cannot begin Fairytale II without Fairytale I complete, even though
  // Fairytale II itself is wanted only started.
  const steps = expand(fairyRings, quests);
  const ft1 = steps.find((s) => s.quest.id === 'fairytale-i')!;
  eq('Fairytale I is required complete', ft1.stage, 'complete');
  const ft2 = steps.find((s) => s.quest.id === 'fairytale-ii')!;
  eq('Fairytale II only started', ft2.stage, 'started');

  // Order matters: a prerequisite must appear before the quest needing it.
  const order = steps.map((s) => s.quest.id);
  ok('prerequisites come first', order.indexOf('nature-spirit') < order.indexOf('fairytale-i'));
  ok('and the chain ends where asked', order.indexOf('fairytale-i') < order.indexOf('fairytale-ii'));
}

console.log('\nDruidic Ritual is not in the chain, and never was');
{
  // The error that started all this. Asserted explicitly so no future edit
  // quietly reintroduces it.
  const ids = expand(fairyRings, quests).map((s) => s.quest.id);
  ok('no druidic ritual', !ids.includes('druidic-ritual'), ids.join(', '));
  ok('no herblore quest of any kind', !ids.some((i) => i.includes('druidic')));
}

console.log('\nBlocked steps say what is blocking them');
{
  // A brand new account: nothing done, every level 1.
  const fresh = new Set<string>();
  const low = new Map<string, number>();
  const plan = planUnlock(fairyRings, quests, fresh, low, 0) as Plan;

  const lostCity = plan.steps.find((s) => s.quest.id === 'lost-city')!;
  eq('Lost City is blocked', lostCity.status, 'blocked');
  eq(
    'by exactly its two skills',
    lostCity.gaps.map((g) => `${g.skill} ${g.need}`).sort(),
    ['crafting 31', 'woodcutting 36']
  );
  ok('neither of which is boostable', lostCity.gaps.every((g) => !g.boostable));

  const ns = plan.steps.find((s) => s.quest.id === 'nature-spirit')!;
  eq('Nature Spirit is blocked on quests, not levels', ns.gaps, []);
  eq('waiting on both prerequisites', ns.waitingOn.sort(), ['priest-in-peril', 'restless-ghost']);

  // Priest in Peril needs nothing at all, so a fresh account can start it.
  const pip = plan.steps.find((s) => s.quest.id === 'priest-in-peril')!;
  eq('Priest in Peril is ready on a fresh account', pip.status, 'ready');
  eq('because it has no prerequisites', pip.quest.requires, []);

  ok('something is always startable', plan.ready.length > 0);
}

console.log('\nThe level summary reports one figure per skill, not one per quest');
{
  const fresh = new Set<string>();
  const low = new Map<string, number>([['crafting', 20]]);
  const plan = planUnlock(
    { ...fairyRings, id: 'x', needs: [{ quest: 'fairytale-ii', stage: 'complete' }] },
    quests,
    fresh,
    low,
    0
  ) as Plan;

  const crafting = plan.levelsNeeded.filter((g) => g.skill === 'crafting');
  eq('crafting appears once', crafting.length, 1);
  eq('at the highest level anything needs', crafting[0].need, 31);
  eq('measured from what you have', crafting[0].have, 20);

  // Sorted hardest first, so the headline number is the real obstacle.
  const needs = plan.levelsNeeded.map((g) => g.need);
  eq('sorted by level, highest first', needs, [...needs].sort((a, b) => b - a));
}

console.log('\nA finished unlock says so');
{
  const done = new Set(['priest-in-peril']);
  const plan = planUnlock(morytania, quests, done, BRENNAN_LEVELS, 33) as Plan;
  eq('Morytania is already unlocked', plan.complete, true);
  eq('nothing left', plan.questsLeft, 0);
  eq('and no levels wanted', plan.levelsNeeded, []);
}

console.log('\nUnlocks rank by how close they are');
{
  const plans = rankUnlocks(UNLOCKS, quests, BRENNAN_DONE, BRENNAN_LEVELS, 33);
  eq('every unlock is planned', plans.length, UNLOCKS.length);
  // Morytania is done, so it sorts last rather than first despite needing
  // zero work — a finished goal is not a goal.
  eq('finished ones sort last', plans[plans.length - 1].unlock.id, 'morytania');
  ok('and the live one comes first', plans[0].unlock.id === 'fairy-rings');
}

console.log('\nThe engine survives bad data rather than hanging');
{
  // A dangling prerequisite is skipped, not thrown on: the page stays up and
  // check:quests is what catches the data error.
  const broken = new Map(quests);
  broken.set('orphan', {
    id: 'orphan',
    name: 'Orphan',
    members: true,
    requires: ['does-not-exist'],
    startSkills: [],
    completeSkills: [],
    source: 'https://oldschool.runescape.wiki/w/x',
  });
  const plan = planUnlock(
    { id: 'o', name: 'O', blurb: '', needs: [{ quest: 'orphan', stage: 'complete' }], source: 'https://oldschool.runescape.wiki/w/x' },
    broken,
    new Set(),
    new Map(),
    0
  ) as Plan;
  eq('the known step survives', plan.steps.length, 1);

  // A cycle must terminate.
  const cyclic = new Map(quests);
  const mk = (id: string, requires: string[]) => ({
    id, name: id, members: true, requires, startSkills: [], completeSkills: [],
    source: 'https://oldschool.runescape.wiki/w/x',
  });
  cyclic.set('a', mk('a', ['b']));
  cyclic.set('b', mk('b', ['a']));
  const cyclePlan = planUnlock(
    { id: 'c', name: 'C', blurb: '', needs: [{ quest: 'a', stage: 'complete' }], source: 'https://oldschool.runescape.wiki/w/x' },
    cyclic,
    new Set(),
    new Map(),
    0
  ) as Plan;
  ok('a cycle terminates instead of hanging', cyclePlan.steps.length >= 1);
}

console.log('\nSmall helpers');
{
  const ft2 = quests.get('fairytale-ii')!;
  eq('started asks for start skills', skillsFor(ft2, 'started'), []);
  eq('complete asks for completion skills', skillsFor(ft2, 'complete').length, 3);
  eq('singular', questCount(1), '1 quest');
  eq('plural', questCount(2), '2 quests');
  eq('zero is plural', questCount(0), '0 quests');
}

console.log('\nEvery shipped quest is sourced to the wiki');
{
  ok('all quests cite a page', QUESTS.every((q) => q.source.includes('oldschool.runescape.wiki')));
  ok('all unlocks cite a page', UNLOCKS.every((u) => u.source.includes('oldschool.runescape.wiki')));
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
