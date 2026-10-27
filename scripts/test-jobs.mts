/**
 * End-to-end tests for the background jobs, against a real Postgres.
 *
 * The external APIs are mocked; the database is not. That split is deliberate
 * — almost everything that can go wrong in these jobs is a database
 * behaviour: a foreign key refusing a row, an upsert that inserts instead of
 * updating, a null becoming a zero, a conflict clause that silently drops
 * data. None of that shows up against an in-memory fake.
 *
 *   DATABASE_URL=postgres://... npm run test:jobs
 */

type Json = unknown;

let fail = 0;
let checks = 0;

function eq(label: string, got: Json, want: Json) {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` WANT ${JSON.stringify(want)}`}`
  );
}

function ok(label: string, cond: boolean, detail = '') {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(name: string) {
  console.log(`\n--- ${name} ---`);
}

// --------------------------------------------------------------- fetch mock

type MockResponse = { status: number; body: unknown };
const routes = new Map<string, () => MockResponse>();
const requested: string[] = [];

function route(fragment: string, fn: () => MockResponse) {
  routes.set(fragment, fn);
}

globalThis.fetch = (async (url: string | URL | Request) => {
  const href = String(url);
  requested.push(href);
  for (const [fragment, fn] of routes) {
    if (href.includes(fragment)) {
      const r = fn();
      return {
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: async () => r.body,
        text: async () => (typeof r.body === 'string' ? r.body : JSON.stringify(r.body)),
      } as Response;
    }
  }
  throw new Error(`test-jobs: no mock registered for ${href}`);
}) as typeof fetch;

// ------------------------------------------------------------------ fixtures

const WHIP = 4151;
const DEATH_RUNE = 560;
const NEVER_TRADED = 99999;
/** In the price feed but deliberately NOT in the catalogue: the FK case. */
const BRAND_NEW_ITEM = 31337;

function mappingBody(whipName = 'Abyssal whip') {
  return [
    {
      id: WHIP,
      name: whipName,
      examine: 'A weapon from the abyss.',
      members: true,
      limit: 70,
      value: 120001,
      highalch: 72000,
      lowalch: 48000,
      icon: 'whip.png',
    },
    { id: DEATH_RUNE, name: 'Death rune', members: false, limit: 10000, value: 180 },
    { id: NEVER_TRADED, name: 'Dodgy prototype', members: true, limit: 1 },
  ];
}

function latestBody() {
  return {
    data: {
      [WHIP]: { high: 1_560_000, highTime: 1_761_400_000, low: 1_500_000, lowTime: 1_761_399_000 },
      [DEATH_RUNE]: { high: 190, highTime: 1_761_400_100, low: 180, lowTime: 1_761_400_050 },
      [NEVER_TRADED]: { high: null, highTime: null, low: null, lowTime: null },
      // Jagex shipped an item today; our catalogue has not caught up.
      [BRAND_NEW_ITEM]: {
        high: 5_000,
        highTime: 1_761_400_200,
        low: 4_800,
        lowTime: 1_761_400_150,
      },
    },
  };
}

function hourlyBody() {
  return {
    data: {
      [WHIP]: {
        avgHighPrice: 1_555_000,
        avgLowPrice: 1_502_000,
        highPriceVolume: 220,
        lowPriceVolume: 180,
      },
      [DEATH_RUNE]: {
        avgHighPrice: 189,
        avgLowPrice: 181,
        highPriceVolume: 40_000,
        lowPriceVolume: 38_000,
      },
      [NEVER_TRADED]: {
        avgHighPrice: null,
        avgLowPrice: null,
        highPriceVolume: 0,
        lowPriceVolume: 0,
      },
      [BRAND_NEW_ITEM]: {
        avgHighPrice: 4_900,
        avgLowPrice: 4_850,
        highPriceVolume: 10,
        lowPriceVolume: 12,
      },
    },
  };
}

/**
 * A hiscores response. Built from the real skill order so a change to
 * SKILLS shifts this fixture the same way it shifts production — the point
 * is to exercise the parser's self-check, not to hardcode past it.
 */
/** The JSON endpoint's shape — named entries, which is the point of it. */
function hiscoresJson(opts: { overallXp: number; bosses?: boolean }) {
  return {
    skills: SKILLS.map((m, i) => ({
      id: i,
      name: m.name,
      rank: 500 + i,
      level: m.key === 'overall' ? (SKILLS.length - 1) * 40 : 40,
      xp: m.key === 'overall' ? opts.overallXp : 37_224,
    })),
    activities: opts.bosses
      ? [
          { id: 6, name: 'Clue Scrolls (all)', rank: 4000, score: 212 },
          { id: 40, name: 'Zulrah', rank: 12000, score: 1043 },
          { id: 50, name: 'Soul Wars Zeal', rank: 700, score: 5000 },
        ]
      : [],
  };
}

function hiscoresBody(opts: { overallXp: number; rows?: number }) {
  const n = opts.rows ?? SKILLS.length;
  const individual = n - 1;
  const level = 40;
  // The overall level has to equal the sum of the rest, or the parser's own
  // self-check fires — which is the behaviour the misalignment test relies
  // on, so the happy-path fixture must not trip it by accident.
  const lines: string[] = [`100000,${individual * level},${opts.overallXp}`];
  for (let i = 0; i < individual; i++) lines.push(`500,${level},37224`);
  return lines.join('\n');
}

// ----------------------------------------------------------------- bootstrap

if (!process.env.DATABASE_URL) {
  console.error('test-jobs: DATABASE_URL is required.');
  process.exit(1);
}
process.env.OSRS_CONTACT = 'test@example.com';
// No Resend key: sendEmail logs instead of sending, which is exactly what a
// test wants, and proves the alert path works without a mailbox.
delete process.env.RESEND_API_KEY;

const { db } = await import('@/database');
const schema = await import('@/database/schema');
const { syncItems } = await import('@/lib/osrs/jobs/sync-items');
const { syncPrices, pruneHistory, HISTORY_RETENTION_DAYS } =
  await import('@/lib/osrs/jobs/sync-prices');
const { syncHiscores } = await import('@/lib/osrs/jobs/sync-hiscores');
const { checkAlerts } = await import('@/lib/osrs/jobs/check-alerts');
const { hourBucket } = await import('@/lib/osrs/jobs/util');
const { SKILLS } = await import('@/lib/osrs/skills');
const { eq: dbEq, sql } = await import('drizzle-orm');

const { osrsItems, osrsPrices, osrsPriceHistory, osrsAccounts, osrsSnapshots, osrsAlerts, users } =
  schema;

// A clean slate each run, in FK order.
await db.execute(sql`
  TRUNCATE osrs_price_history, osrs_prices, osrs_snapshots, osrs_alerts,
           osrs_watchlist, osrs_flips, osrs_goals, osrs_accounts,
           osrs_user_settings, osrs_items RESTART IDENTITY CASCADE
`);
await db.delete(users).where(sql`${users.email} LIKE 'jobtest-%'`);

const [testUser] = await db
  .insert(users)
  .values({ email: 'jobtest-flipper@example.com', name: 'Flipper' })
  .returning({ id: users.id });

// =============================================================== sync-prices
// Tested first, deliberately: before the catalogue exists.

section('sync-prices refuses to run before the catalogue exists');
route('/latest', () => ({ status: 200, body: latestBody() }));
route('/1h', () => ({ status: 200, body: hourlyBody() }));
const premature = await syncPrices();
eq('skipped', premature.skipped, true);
ok('with a reason naming sync-items', String(premature.reason).includes('sync-items'));
eq('and wrote nothing', (await db.select().from(osrsPrices)).length, 0);

// =============================================================== sync-items

section('sync-items');
route('/mapping', () => ({ status: 200, body: mappingBody() }));
const itemsRun = await syncItems();
eq('fetched', itemsRun.fetched, 3);
eq('written', itemsRun.written, 3);
const storedItems = await db.select().from(osrsItems).orderBy(osrsItems.id);
eq('three rows', storedItems.length, 3);
eq('whip buy limit', storedItems.find((i) => i.id === WHIP)?.buyLimit, 70);
eq('rune has no examine', storedItems.find((i) => i.id === DEATH_RUNE)?.examine, null);

section('sync-items is an upsert, not an append');
route('/mapping', () => ({ status: 200, body: mappingBody('Abyssal whip (renamed)') }));
await syncItems();
eq('still three rows', (await db.select().from(osrsItems)).length, 3);
eq(
  'rename applied',
  (await db.select().from(osrsItems).where(dbEq(osrsItems.id, WHIP)))[0]?.name,
  'Abyssal whip (renamed)'
);

section('an empty mapping is reported, not written');
route('/mapping', () => ({ status: 200, body: [] }));
const emptyRun = await syncItems();
eq('written nothing', emptyRun.written, 0);
ok('warns', typeof emptyRun.warning === 'string');
eq('existing rows untouched', (await db.select().from(osrsItems)).length, 3);
route('/mapping', () => ({ status: 200, body: mappingBody() }));
await syncItems();

// ========================================================= sync-prices, real

section('sync-prices');
const t1 = new Date('2026-10-25T14:07:00.000Z');
const priceRun = await syncPrices(t1);
eq('three prices stored', priceRun.prices, 3);
eq('one id had no catalogue row', priceRun.unknownItems, 1);

const prices = await db.select().from(osrsPrices).orderBy(osrsPrices.itemId);
const pWhip = prices.find((p) => p.itemId === WHIP)!;
const pRune = prices.find((p) => p.itemId === DEATH_RUNE)!;
const pNever = prices.find((p) => p.itemId === NEVER_TRADED)!;

ok(
  'the uncatalogued item was skipped, not inserted',
  prices.every((p) => p.itemId !== BRAND_NEW_ITEM),
  'a foreign key violation here would have failed the whole batch'
);
eq('whip low', pWhip.low, 1_500_000);
eq('whip high', pWhip.high, 1_560_000);
eq('whip volume is both sides summed', pWhip.hourlyVolume, 400);
eq('rune volume', pRune.hourlyVolume, 78_000);
eq('never-traded low stays null', pNever.low, null);
eq('never-traded high stays null', pNever.high, null);
ok(
  'a null price is not a zero price',
  pNever.low === null && pNever.high === null,
  'zero would read as an infinite-margin flip'
);
eq(
  'whip lowTime parsed from Unix seconds',
  pWhip.lowTime?.toISOString(),
  new Date(1_761_399_000 * 1000).toISOString()
);
eq('never-traded time stays null', pNever.lowTime, null);

section('history: one row per item per hour, however often we poll');
const h1 = await db.select().from(osrsPriceHistory);
eq('three history rows', h1.length, 3);
eq('bucketed to the hour', h1[0].ts.toISOString(), hourBucket(t1).toISOString());
eq('minutes zeroed', h1[0].ts.getUTCMinutes(), 0);

const samePoll = await syncPrices(new Date('2026-10-25T14:52:00.000Z'));
eq('second poll in the same hour inserts nothing', samePoll.historyInserted, 0);
eq('still three history rows', (await db.select().from(osrsPriceHistory)).length, 3);

const nextHour = await syncPrices(new Date('2026-10-25T15:01:00.000Z'));
eq('the next hour does insert', nextHour.historyInserted, 3);
eq('six history rows', (await db.select().from(osrsPriceHistory)).length, 6);

section('sync-prices updates the live row rather than duplicating it');
eq('still three live price rows', (await db.select().from(osrsPrices)).length, 3);
route('/latest', () => {
  const b = latestBody();
  b.data[WHIP] = {
    high: 1_600_000,
    highTime: 1_761_500_000,
    low: 1_540_000,
    lowTime: 1_761_499_000,
  };
  return { status: 200, body: b };
});
await syncPrices(new Date('2026-10-25T16:01:00.000Z'));
eq(
  'new whip price',
  (await db.select().from(osrsPrices).where(dbEq(osrsPrices.itemId, WHIP)))[0]?.low,
  1_540_000
);
eq('and no extra row', (await db.select().from(osrsPrices)).length, 3);
route('/latest', () => ({ status: 200, body: latestBody() }));

// ============================================================ prune-history

section('prune-history keeps the window and drops the rest');
const old = new Date(Date.now() - (HISTORY_RETENTION_DAYS + 5) * 86_400_000);
old.setUTCMinutes(0, 0, 0);
await db
  .insert(osrsPriceHistory)
  .values({ itemId: WHIP, ts: old, avgHigh: 1, avgLow: 1, highVolume: 1, lowVolume: 1 });
const beforePrune = (await db.select().from(osrsPriceHistory)).length;
const pruned = await pruneHistory();
eq('one old row deleted', pruned.deleted, 1);
eq('recent rows survive', (await db.select().from(osrsPriceHistory)).length, beforePrune - 1);

// =============================================================== alerts

section('alerts');
await db.insert(osrsAlerts).values([
  // low is 1,500,000 — this should fire.
  { userId: testUser.id, itemId: WHIP, direction: 'below', threshold: 1_550_000, priceSide: 'low' },
  // high is 190 — this should not.
  {
    userId: testUser.id,
    itemId: DEATH_RUNE,
    direction: 'above',
    threshold: 100_000,
    priceSide: 'high',
  },
  // Null price: must never fire, or every untraded item mails you.
  {
    userId: testUser.id,
    itemId: NEVER_TRADED,
    direction: 'below',
    threshold: 1_000_000,
    priceSide: 'low',
  },
]);

const firstAlertRun = await checkAlerts(new Date('2026-10-25T16:05:00.000Z'));
eq('three alerts considered', firstAlertRun.checked, 3);
eq('one sent', firstAlertRun.sent, 1);
eq('one skipped for having no price', firstAlertRun.noPrice, 1);
eq('none failed', firstAlertRun.failed, 0);

const fired = await db.select().from(osrsAlerts).where(dbEq(osrsAlerts.itemId, WHIP));
ok('the fired alert was stamped', fired[0].lastFiredAt !== null);
const untouched = await db.select().from(osrsAlerts).where(dbEq(osrsAlerts.itemId, DEATH_RUNE));
eq('the non-triggering alert was not stamped', untouched[0].lastFiredAt, null);

section('alerts respect the cooldown');
const soon = await checkAlerts(new Date('2026-10-25T17:00:00.000Z'));
eq('nothing sent an hour later', soon.sent, 0);
eq('held by cooldown', soon.onCooldown, 1);

const later = await checkAlerts(new Date('2026-10-25T23:00:00.000Z'));
eq('sends again past the cooldown', later.sent, 1);
eq('and nothing is held', later.onCooldown, 0);

section('an inactive alert is ignored');
await db.update(osrsAlerts).set({ active: false }).where(dbEq(osrsAlerts.itemId, WHIP));
const afterDeactivate = await checkAlerts(new Date('2026-10-26T12:00:00.000Z'));
eq('two considered', afterDeactivate.checked, 2);
eq('none sent', afterDeactivate.sent, 0);

// ============================================================= sync-hiscores

section('sync-hiscores');
const [account] = await db
  .insert(osrsAccounts)
  .values({ userId: testUser.id, rsn: 'Zezima', rsnKey: 'zezima' })
  .returning({ id: osrsAccounts.id });

route('index_lite.json', () => ({
  status: 200,
  body: hiscoresJson({ overallXp: 500_000, bosses: true }),
}));
const hs1 = await syncHiscores({ now: new Date('2026-10-25T18:00:00.000Z') });
eq('one account due', hs1.due, 1);
eq('one snapshot written', hs1.synced, 1);
eq('no parse warnings', (hs1.warnings as string[]).length, 0);
ok(
  'activities arrive NAMED, so bosses are safe to label',
  JSON.stringify((await db.select().from(osrsSnapshots))[0].activities).includes('Zulrah')
);

const snaps = await db.select().from(osrsSnapshots);
eq('one snapshot row', snaps.length, 1);
eq('total xp recorded', snaps[0].totalXp, 500_000);
ok('combat level is at least 3', snaps[0].combatLevel >= 3, String(snaps[0].combatLevel));
ok('skills stored as an object', typeof snaps[0].skills === 'object' && snaps[0].skills !== null);
const acct = (await db.select().from(osrsAccounts).where(dbEq(osrsAccounts.id, account.id)))[0];
ok('last synced stamped', acct.lastSyncedAt !== null);

section('an account already synced is not due again');
const notDue = await syncHiscores({ now: new Date('2026-10-25T20:00:00.000Z') });
eq('nothing due two hours later', notDue.due, 0);

section('an idle account does not accumulate identical snapshots');
const sameXp = await syncHiscores({ now: new Date('2026-10-26T20:00:00.000Z') });
eq('one account due again', sameXp.due, 1);
eq('nothing written', sameXp.synced, 0);
eq('counted as unchanged', sameXp.unchanged, 1);
eq('still one snapshot row', (await db.select().from(osrsSnapshots)).length, 1);

section('real progress does write a snapshot');
route('index_lite.json', () => ({ status: 200, body: hiscoresJson({ overallXp: 612_345 }) }));
const grew = await syncHiscores({ now: new Date('2026-10-27T20:00:00.000Z') });
eq('one written', grew.synced, 1);
eq('two snapshot rows', (await db.select().from(osrsSnapshots)).length, 2);

section('a short response is caught by the parser self-check, not stored silently');
// JSON unavailable, so the CSV fallback runs — and the CSV's own
// self-check catches a short response.
routes.delete('index_lite.json');
route('index_lite.json', () => ({ status: 500, body: 'down' }));
route('index_lite.ws', () => ({
  status: 200,
  body: hiscoresBody({ overallXp: 700_000, rows: Math.max(2, SKILLS.length - 3) }),
}));
const shortRun = await syncHiscores({ now: new Date('2026-10-28T20:00:00.000Z') });
ok(
  'a warning was surfaced',
  (shortRun.warnings as string[]).length > 0,
  JSON.stringify(shortRun.warnings)
);

section('a name the hiscores do not know is parked, not retried forever');
routes.delete('index_lite.ws');
route('index_lite.json', () => ({ status: 404, body: 'not found' }));
await db.insert(osrsAccounts).values({
  userId: testUser.id,
  rsn: 'Nonexistent Guy',
  rsnKey: 'nonexistent guy',
});
const missingRun = await syncHiscores({ now: new Date('2026-10-29T20:00:00.000Z') });
ok('at least one reported not found', (missingRun.notFound as number) >= 1);
const parked = await db
  .select()
  .from(osrsAccounts)
  .where(dbEq(osrsAccounts.rsnKey, 'nonexistent guy'));
ok('missing_since set', parked[0].missingSince !== null);
const afterPark = await syncHiscores({ now: new Date('2026-10-30T20:00:00.000Z') });
ok(
  'the parked account is no longer in the queue',
  !(afterPark.due as number) || (afterPark.due as number) < 2,
  `due=${afterPark.due}`
);

section('a retryable failure leaves the account at the front of the queue');
await db.delete(osrsSnapshots);
await db
  .update(osrsAccounts)
  .set({ lastSyncedAt: null, missingSince: null })
  .where(dbEq(osrsAccounts.id, account.id));
route('index_lite.json', () => ({ status: 503, body: 'upstream down' }));
route('index_lite.ws', () => ({ status: 503, body: 'upstream down' }));
const failed = await syncHiscores({ now: new Date('2026-10-31T20:00:00.000Z') });
ok('counted as failed', (failed.failed as number) >= 1);
const stillNull = (
  await db.select().from(osrsAccounts).where(dbEq(osrsAccounts.id, account.id))
)[0];
eq('last_synced_at deliberately left unset', stillNull.lastSyncedAt, null);

section('the budget is respected');
routes.delete('index_lite.ws');
route('index_lite.json', () => ({ status: 200, body: hiscoresJson({ overallXp: 800_000 }) }));
await db.insert(osrsAccounts).values(
  Array.from({ length: 4 }, (_, i) => ({
    userId: testUser.id,
    rsn: `Alt ${i}`,
    rsnKey: `alt ${i}`,
  }))
);
const budgeted = await syncHiscores({ budget: 2, now: new Date('2026-11-01T20:00:00.000Z') });
eq('only two picked up', budgeted.due, 2);

// =================================================================== wrap up

section('the wedding tables are still intact');
eq('users table still readable', (await db.select().from(users)).length >= 1, true);

console.log(`\n${checks} checks — ${fail === 0 ? 'all passed' : `${fail} FAILED`}`);
await db.$client.end();
process.exit(fail ? 1 : 0);
