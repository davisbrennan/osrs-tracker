/**
 * The method catalogue.
 *
 * Deliberately a plain data file and not a database table. These are static
 * reference facts, they change only when Jagex changes the game, and keeping
 * them here means they are version-controlled, reviewable in a diff, and
 * editable without a migration or a seed step.
 *
 * WHAT IS STORED AND WHY
 *
 * Each method stores the RECIPE RATIO, which is a game mechanic — one ranarr
 * weed and one vial of water make one unfinished ranarr potion, and that is
 * true regardless of what anything costs. No gp figure is stored anywhere;
 * the engine computes value from live prices. That is the whole point: every
 * published money-making guide's gp/hr is a snapshot taken at the prices of
 * the day it was last recalculated.
 *
 * The one genuine estimate per method is `actionsPerHour`, and every one of
 * them carries the wiki page it came from in `sourceUrl`. If a rate looks
 * wrong for how you actually play, change the number here — it is one field
 * and nothing else depends on it.
 *
 * ON THE SOURCE AND ITS LICENCE
 *
 * The rates are facts read off the wiki's money-making guides, not prose
 * copied from them: no sentence here is the wiki's. Facts are not subject to
 * copyright, so this file does not carry the CC BY-NC-SA obligations that
 * the item descriptions in lib/osrs/wiki.ts do. The source links are there
 * because crediting where a measurement came from is right, and because you
 * will want them when a rate needs rechecking.
 *
 * WHAT IS NOT HERE, AND WHY
 *
 * Plank making and combat methods are missing on purpose. The wiki page for
 * mahogany planks states the sawmill fee but no rate per hour, and combat
 * methods need drop tables to be anything other than a guess. Rather than
 * invent a number and let it quietly set the top of the ranking, they wait
 * until there is a figure worth trusting.
 *
 * ITEM NAMES, NOT IDS
 *
 * Items are referenced by name and resolved against osrs_items, which is
 * populated from the wiki's mapping endpoint and is authoritative. Hardcoded
 * ids would be a long list of numbers nobody could review; a wrong name is
 * caught by `npm run check:methods` and named in the output.
 */

export type MethodRecipeItem = { name: string; quantity: number };

export type MethodDefinition = {
  id: string;
  name: string;
  category: 'processing' | 'gathering';
  skill: string | null;
  level: number | null;
  actionsPerHour: number;
  /** Coins per action that are not an item purchase, such as a tanner's fee. */
  coinCost?: number;
  members: boolean;
  quest?: string | null;
  note?: string | null;
  sourceUrl: string;
  inputs: MethodRecipeItem[];
  outputs: MethodRecipeItem[];
};

const WIKI = 'https://oldschool.runescape.wiki/w/Money_making_guide';

/**
 * Herb + vial of water -> unfinished potion.
 *
 * Rate: ~4,100/hr, stated on the Making ranarr potions guide. The action is
 * identical for every herb, so the rate carries across the set; only the herb
 * and the level requirement differ.
 */
const UNF_RATE = 4100;
const UNF_SOURCE = `${WIKI}/Making_ranarr_potions`;

type UnfSpec = [slug: string, herb: string, unf: string, level: number, members: boolean];

const UNFINISHED: UnfSpec[] = [
  ['guam-unf', 'Guam leaf', 'Guam potion(unf)', 3, false],
  ['marrentill-unf', 'Marrentill', 'Marrentill potion(unf)', 5, false],
  ['tarromin-unf', 'Tarromin', 'Tarromin potion(unf)', 12, false],
  ['harralander-unf', 'Harralander', 'Harralander potion(unf)', 22, false],
  ['ranarr-unf', 'Ranarr weed', 'Ranarr potion(unf)', 30, false],
  ['toadflax-unf', 'Toadflax', 'Toadflax potion(unf)', 34, true],
  ['irit-unf', 'Irit leaf', 'Irit potion(unf)', 45, false],
  ['avantoe-unf', 'Avantoe', 'Avantoe potion(unf)', 50, false],
  ['kwuarm-unf', 'Kwuarm', 'Kwuarm potion(unf)', 55, false],
  ['snapdragon-unf', 'Snapdragon', 'Snapdragon potion(unf)', 63, true],
  ['cadantine-unf', 'Cadantine', 'Cadantine potion(unf)', 66, false],
  ['lantadyme-unf', 'Lantadyme', 'Lantadyme potion(unf)', 69, false],
  ['dwarf-weed-unf', 'Dwarf weed', 'Dwarf weed potion(unf)', 72, false],
];

/**
 * Unfinished potion + secondary -> finished potion.
 *
 * Rate: ~2,500/hr, stated on the Making prayer potions guide. Lower than the
 * unfinished rate because the secondary has to be handled too.
 *
 * THE DOSE MATTERS. Adding a secondary yields a THREE-dose potion, not four
 * — the wiki's Potion article is explicit that "a newly finished vial of
 * potion contains three doses". Four-dose potions come from decanting, which
 * is a separate step with its own cost. Modelling the output as a 4-dose
 * would overstate every one of these by roughly a third.
 */
const FINISHED_RATE = 2500;
const FINISHED_SOURCE = `${WIKI}/Making_prayer_potions`;

type FinSpec = [
  slug: string,
  unf: string,
  secondary: string,
  potion: string,
  level: number,
  members: boolean,
];

const FINISHED: FinSpec[] = [
  ['prayer-potion', 'Ranarr potion(unf)', 'Snape grass', 'Prayer potion(3)', 38, true],
  ['super-attack', 'Irit potion(unf)', 'Eye of newt', 'Super attack(3)', 45, true],
  ['super-energy', 'Avantoe potion(unf)', 'Mort myre fungus', 'Super energy(3)', 52, true],
  ['super-strength', 'Kwuarm potion(unf)', 'Limpwurt root', 'Super strength(3)', 55, true],
  ['super-restore', 'Snapdragon potion(unf)', "Red spiders' eggs", 'Super restore(3)', 63, true],
  ['super-defence', 'Cadantine potion(unf)', 'White berries', 'Super defence(3)', 66, true],
  ['antifire-potion', 'Lantadyme potion(unf)', 'Dragon scale dust', 'Antifire potion(3)', 69, true],
  ['ranging-potion', 'Dwarf weed potion(unf)', 'Wine of zamorak', 'Ranging potion(3)', 72, true],
  ['magic-potion', 'Lantadyme potion(unf)', 'Potato cactus', 'Magic potion(3)', 76, true],
  ['saradomin-brew', 'Toadflax potion(unf)', 'Crushed nest', 'Saradomin brew(3)', 81, true],
];

/**
 * Hide + a tanner's fee -> leather.
 *
 * Rate: ~2,800/hr with stamina potions, ~2,000 without, stated on the
 * Tanning red dragonhide guide. The conservative figure is used, because the
 * higher one assumes you are also paying for stamina potions, which this
 * does not model as an input.
 *
 * The red dragonhide fee of 20gp is confirmed on that page; the others
 * follow the same tanner pricing.
 */
const TAN_RATE = 2000;
const TAN_SOURCE = `${WIKI}/Tanning_red_dragonhide`;

type TanSpec = [slug: string, hide: string, leather: string, fee: number, members: boolean];

const TANNING: TanSpec[] = [
  ['tan-cowhide', 'Cowhide', 'Leather', 1, false],
  ['tan-green', 'Green dragonhide', 'Green dragon leather', 20, true],
  ['tan-blue', 'Blue dragonhide', 'Blue dragon leather', 20, true],
  ['tan-red', 'Red dragonhide', 'Red dragon leather', 20, true],
  ['tan-black', 'Black dragonhide', 'Black dragon leather', 20, true],
];

/**
 * "Prayer potion(3)" -> "prayer potions"; "Saradomin brew(3)" -> "saradomin
 * brews"; "Super attack(3)" -> "super attack potions".
 *
 * Naive appending gave "making magic potion potions", because some of these
 * item names already carry the noun and some do not.
 */
function pluralisePotion(potionName: string): string {
  const base = potionName.replace(/\s*\(\d\)$/, '').toLowerCase();
  if (/(potion|brew|mix|serum)$/.test(base)) return `${base}s`;
  return `${base} potions`;
}

export const METHODS: MethodDefinition[] = [
  ...UNFINISHED.map(([id, herb, unf, level, members]) => ({
    id,
    name: `Making ${herb.toLowerCase()} unfinished potions`,
    category: 'processing' as const,
    skill: 'Herblore',
    level,
    actionsPerHour: UNF_RATE,
    members,
    quest: 'Druidic Ritual',
    note: null,
    sourceUrl: UNF_SOURCE,
    inputs: [
      { name: herb, quantity: 1 },
      { name: 'Vial of water', quantity: 1 },
    ],
    outputs: [{ name: unf, quantity: 1 }],
  })),

  ...FINISHED.map(([id, unf, secondary, potion, level, members]) => ({
    id,
    name: `Making ${pluralisePotion(potion)}`,
    category: 'processing' as const,
    skill: 'Herblore',
    level,
    actionsPerHour: FINISHED_RATE,
    members,
    quest: 'Druidic Ritual',
    note: 'Mixing yields a 3-dose potion; decanting to 4-dose is a separate step.',
    sourceUrl: FINISHED_SOURCE,
    inputs: [
      { name: unf, quantity: 1 },
      { name: secondary, quantity: 1 },
    ],
    outputs: [{ name: potion, quantity: 1 }],
  })),

  ...TANNING.map(([id, hide, leather, fee, members]) => ({
    id,
    name: `Tanning ${hide.toLowerCase()}`,
    category: 'processing' as const,
    skill: null,
    level: null,
    actionsPerHour: TAN_RATE,
    coinCost: fee,
    members,
    quest: null,
    note: 'Rate assumes no stamina potions; with them the wiki measures ~2,800/hr.',
    sourceUrl: TAN_SOURCE,
    inputs: [{ name: hide, quantity: 1 }],
    outputs: [{ name: leather, quantity: 1 }],
  })),
];

/** Every distinct item name the catalogue references. */
export function methodItemNames(): string[] {
  const names = new Set<string>();
  for (const m of METHODS) {
    for (const i of m.inputs) names.add(i.name);
    for (const o of m.outputs) names.add(o.name);
  }
  return [...names].sort();
}
