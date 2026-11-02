/**
 * Quest requirements, read from the wiki rather than recalled.
 *
 * Every entry below was checked against its own wiki page while this file
 * was written, and each carries the page it came from. That is not
 * ceremony. Writing this from memory produced three confident errors in a
 * single afternoon:
 *
 *   - Druidic Ritual was put in the fairy ring chain. It is not in it, and
 *     it has no Herblore requirement either — the quest is what GRANTS
 *     Herblore.
 *   - Priest in Peril was given The Restless Ghost as a prerequisite. It
 *     has no quest prerequisites at all.
 *   - Fairytale II's 57 Herblore was treated as blocking fairy rings. It
 *     blocks COMPLETING the quest, and fairy rings need it only started.
 *
 * All three were plausible. All three would have sent someone to train a
 * skill they did not need, which is the exact harm this page exists to
 * prevent.
 *
 * The dataset is deliberately small and entirely verified rather than large
 * and partly guessed. Adding a quest is mechanical: read its page, record
 * what the infobox states, cite it. `npm run check:quests` fails on any
 * prerequisite naming a quest that is not defined here.
 *
 * Requirements are facts about the game and carry no copyright; none of the
 * wiki's prose is reproduced.
 */

import type { Quest, Unlock } from '@/lib/osrs/quests';

const WIKI = 'https://oldschool.runescape.wiki/w/';

export const QUESTS: Quest[] = [
  {
    id: 'restless-ghost',
    name: 'The Restless Ghost',
    members: false,
    requires: [],
    startSkills: [],
    completeSkills: [],
    source: `${WIKI}Quests/Requirements`,
  },
  {
    id: 'priest-in-peril',
    name: 'Priest in Peril',
    members: true,
    // No quest prerequisites. The infobox says "None" — this is the one I
    // got wrong from memory.
    requires: [],
    startSkills: [],
    completeSkills: [],
    items: ['A weapon and armour for a level 30 Temple guardian'],
    source: `${WIKI}Priest_in_Peril`,
  },
  {
    id: 'lost-city',
    name: 'Lost City',
    members: true,
    requires: [],
    // The wiki marks both of these "not required to start" — you need them
    // partway through. Exactly the distinction this model exists for.
    startSkills: [],
    completeSkills: [
      { skill: 'crafting', level: 31, boostable: false },
      { skill: 'woodcutting', level: 36, boostable: false },
    ],
    items: ['An axe and a knife', 'Combat gear for a level 101 Tree spirit'],
    source: `${WIKI}The_Lost_City`,
  },
  {
    id: 'nature-spirit',
    name: 'Nature Spirit',
    members: true,
    requires: ['priest-in-peril', 'restless-ghost'],
    startSkills: [],
    completeSkills: [],
    items: ['Silver sickle', 'Ghostspeak amulet', '6 free inventory slots'],
    source: `${WIKI}Nature_Spirit`,
  },
  {
    id: 'fairytale-i',
    name: 'Fairytale I - Growing Pains',
    members: true,
    requires: ['lost-city', 'nature-spirit', 'priest-in-peril', 'restless-ghost'],
    startSkills: [],
    // No hard skill requirements. The page recommends combat 50 and a
    // combined Strength/Farming of 40 for the Tanglefoot fight, which is a
    // recommendation and so is not recorded as a requirement.
    completeSkills: [],
    source: `${WIKI}Fairytale_I_-_Growing_Pains`,
  },
  {
    id: 'fairytale-ii',
    name: 'Fairytale II - Cure a Queen',
    members: true,
    requires: ['fairytale-i', 'lost-city', 'nature-spirit', 'restless-ghost', 'priest-in-peril'],
    // Nothing is needed to BEGIN. The wiki states these levels are required
    // to complete the quest, and fairy rings need it only started.
    startSkills: [],
    completeSkills: [
      { skill: 'thieving', level: 40, boostable: false },
      { skill: 'farming', level: 49, boostable: true },
      { skill: 'herblore', level: 57, boostable: true },
    ],
    source: `${WIKI}Fairy_Tale_II`,
  },
];

export const UNLOCKS: Unlock[] = [
  {
    id: 'fairy-rings',
    name: 'Fairy rings',
    blurb:
      'The teleport network that makes the rest of the map reachable. Needs Fairytale II started, not finished — which is where most of the levels people think they need actually live.',
    needs: [
      { quest: 'fairytale-i', stage: 'complete' },
      // "Progress until you are granted permission to use the rings."
      // Finishing it is not required, and finishing it is what costs 57
      // Herblore.
      { quest: 'fairytale-ii', stage: 'started' },
    ],
    alsoNeeds: [
      'A dramen or lunar staff in your inventory (the dramen staff comes from Lost City)',
    ],
    source: `${WIKI}Fairy_ring`,
  },
  {
    id: 'morytania',
    name: 'Morytania access',
    blurb:
      'Opens the eastern half of the map and the route to Canifis, which most of the mid-game quest chain runs through.',
    needs: [{ quest: 'priest-in-peril', stage: 'complete' }],
    source: `${WIKI}Priest_in_Peril`,
  },
];

export function questMap(): Map<string, Quest> {
  return new Map(QUESTS.map((q) => [q.id, q]));
}

/** Every quest id named as a prerequisite or by an unlock. */
export function referencedQuestIds(): string[] {
  const ids = new Set<string>();
  for (const q of QUESTS) for (const r of q.requires) ids.add(r);
  for (const u of UNLOCKS) for (const n of u.needs) ids.add(n.quest);
  return [...ids];
}
