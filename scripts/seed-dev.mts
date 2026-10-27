/**
 * Realistic-looking local data, so the screens can be reviewed without
 * waiting on the live API or reaching Jagex from a sandbox.
 *
 * Prices are in the right order of magnitude for each item but are NOT real
 * quotes — this is for looking at layout and colour, not for trading.
 *
 *   DATABASE_URL=postgres://... npx tsx scripts/seed-dev.mts
 */

import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices, osrsPriceHistory } from '@/database/schema';
import { hourBucket } from '@/lib/osrs/jobs/util';

type Seed = {
  id: number;
  name: string;
  examine: string;
  members: boolean;
  limit: number;
  buy: number;
  spreadPct: number;
  volume: number;
};

const ITEMS: Seed[] = [
  {
    id: 4151,
    name: 'Abyssal whip',
    examine: 'A weapon from the abyss.',
    members: true,
    limit: 70,
    buy: 1_498_000,
    spreadPct: 0.041,
    volume: 412,
  },
  {
    id: 11832,
    name: 'Bandos chestplate',
    examine: 'A sturdy chestplate.',
    members: true,
    limit: 8,
    buy: 16_240_000,
    spreadPct: 0.026,
    volume: 61,
  },
  {
    id: 560,
    name: 'Death rune',
    examine: 'Used for high level missile spells.',
    members: false,
    limit: 25_000,
    buy: 181,
    spreadPct: 0.055,
    volume: 2_840_000,
  },
  {
    id: 565,
    name: 'Blood rune',
    examine: 'Used for high level healing spells.',
    members: true,
    limit: 25_000,
    buy: 243,
    spreadPct: 0.048,
    volume: 1_210_000,
  },
  {
    id: 13190,
    name: 'Old school bond',
    examine: 'A bond for membership.',
    members: false,
    limit: 100,
    buy: 13_900_000,
    spreadPct: 0.022,
    volume: 1_840,
  },
  {
    id: 11802,
    name: 'Armadyl godsword',
    examine: 'A beautiful sword.',
    members: true,
    limit: 8,
    buy: 38_100_000,
    spreadPct: 0.031,
    volume: 24,
  },
  {
    id: 2434,
    name: 'Prayer potion(4)',
    examine: 'Four doses of prayer restoration.',
    members: true,
    limit: 2_000,
    buy: 9_420,
    spreadPct: 0.037,
    volume: 148_000,
  },
  {
    id: 385,
    name: 'Shark',
    examine: 'I hope it is dead.',
    members: true,
    limit: 12_000,
    buy: 812,
    spreadPct: 0.044,
    volume: 96_400,
  },
  {
    id: 1515,
    name: 'Yew logs',
    examine: 'Logs cut from a yew tree.',
    members: false,
    limit: 12_000,
    buy: 268,
    spreadPct: 0.062,
    volume: 320_000,
  },
  {
    id: 453,
    name: 'Coal',
    examine: 'Hmm, a non-renewable energy source.',
    members: false,
    limit: 13_000,
    buy: 142,
    spreadPct: 0.071,
    volume: 580_000,
  },
  {
    id: 11834,
    name: 'Bandos tassets',
    examine: 'Sturdy platelegs.',
    members: true,
    limit: 8,
    buy: 21_700_000,
    spreadPct: 0.019,
    volume: 44,
  },
  {
    id: 6585,
    name: 'Amulet of fury',
    examine: 'A very powerful amulet.',
    members: true,
    limit: 8,
    buy: 7_640_000,
    spreadPct: 0.028,
    volume: 102,
  },
  // Deliberately thin: a fat margin on a book almost nobody trades. This is
  // the row the confidence column exists to warn about, so the screens should
  // be reviewed with one present.
  {
    id: 20997,
    name: 'Twisted bow',
    examine: 'A bow of twisted origin.',
    members: true,
    limit: 8,
    buy: 1_240_000_000,
    spreadPct: 0.034,
    volume: 3,
  },
  // And one that is cheap enough that the tax eats the whole spread.
  {
    id: 1511,
    name: 'Logs',
    examine: 'A number of logs.',
    members: false,
    limit: 12_000,
    buy: 62,
    spreadPct: 0.016,
    volume: 410_000,
  },
];

if (!process.env.DATABASE_URL) {
  console.error('seed-dev: DATABASE_URL is required.');
  process.exit(1);
}

await db.execute(sql`TRUNCATE osrs_price_history, osrs_prices, osrs_items CASCADE`);

const now = new Date();

await db.insert(osrsItems).values(
  ITEMS.map((i) => ({
    id: i.id,
    name: i.name,
    examine: i.examine,
    members: i.members,
    buyLimit: i.limit,
    value: Math.round(i.buy * 0.9),
    highalch: null,
    lowalch: null,
    icon: null,
    updatedAt: now,
  }))
);

await db.insert(osrsPrices).values(
  ITEMS.map((i) => {
    const sell = Math.round(i.buy * (1 + i.spreadPct));
    return {
      itemId: i.id,
      low: i.buy,
      high: sell,
      // A thin book also means an old price, which is the point of it.
      lowTime: new Date(now.getTime() - (i.volume < 100 ? 190 : 4) * 60_000),
      highTime: new Date(now.getTime() - (i.volume < 100 ? 240 : 7) * 60_000),
      hourlyVolume: i.volume,
      fetchedAt: now,
    };
  })
);

// Thirty days of hourly history with a gentle random walk, so the chart has
// something with real shape rather than a straight line.
const HOURS = 30 * 24;
const history: (typeof osrsPriceHistory.$inferInsert)[] = [];
for (const i of ITEMS) {
  let level = i.buy * 0.93;
  const base = hourBucket(now).getTime();
  for (let h = HOURS; h >= 0; h--) {
    // Deterministic wobble: same seed every run, so screenshots are comparable.
    const wave = Math.sin((h / 37) * Math.PI) * 0.035 + Math.sin((h / 11) * Math.PI) * 0.012;
    level = i.buy * (0.955 + wave + ((HOURS - h) / HOURS) * 0.05);
    const low = Math.round(level);
    history.push({
      itemId: i.id,
      ts: new Date(base - h * 3_600_000),
      avgLow: low,
      avgHigh: Math.round(low * (1 + i.spreadPct)),
      highVolume: Math.round(i.volume * 0.52),
      lowVolume: Math.round(i.volume * 0.48),
    });
  }
}

for (let i = 0; i < history.length; i += 1000) {
  await db
    .insert(osrsPriceHistory)
    .values(history.slice(i, i + 1000))
    .onConflictDoNothing();
}

console.log(`seeded ${ITEMS.length} items and ${history.length} history rows`);
await db.$client.end();
