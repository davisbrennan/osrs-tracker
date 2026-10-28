/**
 * One bad row must not cost the others.
 *
 * Run against a real database, because the whole behaviour is a reaction to
 * what Postgres does with a batch statement: a single unacceptable value
 * aborts all thousand rows in it. That cannot be reproduced with a fake.
 *
 * Needs DATABASE_URL.
 */

import { Client } from 'pg';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('test:resilience — DATABASE_URL is not set.');
  process.exit(2);
}

const { db } = await import('@/database');
const { osrsItems, osrsPrices } = await import('@/database/schema');
const { sql, inArray } = await import('drizzle-orm');
const { safeInt } = await import('@/lib/osrs/jobs/util');

let fail = 0;
let checks = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(`  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` WANT ${JSON.stringify(want)}`}`);
};
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};

const IDS = [900001, 900002, 900003];
await db.delete(osrsPrices).where(inArray(osrsPrices.itemId, IDS));
await db.delete(osrsItems).where(inArray(osrsItems.id, IDS));
await db.insert(osrsItems).values(
  IDS.map((id) => ({ id, name: `Resilience fixture ${id}`, members: false, buyLimit: 100 }))
);

const upsert = (values: (typeof osrsPrices.$inferInsert)[]) =>
  db.insert(osrsPrices).values(values).onConflictDoUpdate({
    target: osrsPrices.itemId,
    set: { high: sql`excluded.high`, low: sql`excluded.low`, fetchedAt: sql`excluded.fetched_at` },
  });

const row = (id: number, high: number) => ({
  itemId: id, high, low: 1, hourlyVolume: 10, fetchedAt: new Date(),
});

console.log('\nPostgres really does lose the whole batch for one bad value');
{
  let threw = false;
  try {
    // 3,000,000,000 does not fit int4. The other two rows are perfect.
    await upsert([row(IDS[0], 100), row(IDS[1], 3_000_000_000), row(IDS[2], 300)]);
  } catch {
    threw = true;
  }
  ok('the batch is rejected', threw);

  const got = await db.execute(sql`select count(*)::int as n from osrs_prices where item_id in (${sql.join(IDS.map((i) => sql`${i}`), sql`, `)})`);
  const n = Number((got as unknown as { rows?: { n: number }[] }).rows?.[0]?.n ?? 0);
  eq('and NONE of the three landed', n, 0);
}

console.log('\nRow-by-row retry keeps the good ones');
{
  const batch = [row(IDS[0], 100), row(IDS[1], 3_000_000_000), row(IDS[2], 300)];
  let written = 0;
  let rejected = 0;
  try {
    await upsert(batch);
    written = batch.length;
  } catch {
    for (const r of batch) {
      try { await upsert([r]); written++; } catch { rejected++; }
    }
  }
  eq('two of three written', written, 2);
  eq('one rejected', rejected, 1);

  const got = await db.execute(sql`select item_id, high from osrs_prices where item_id in (${sql.join(IDS.map((i) => sql`${i}`), sql`, `)}) order by item_id`);
  const rows = ((got as unknown as { rows?: { item_id: number; high: number }[] }).rows ?? []);
  eq('the good rows are in the table', rows.map((r) => Number(r.high)), [100, 300]);
  ok('the bad one is absent', !rows.some((r) => Number(r.item_id) === IDS[1]));
}

console.log('\nsafeInt would have prevented it in the first place');
{
  // Belt and braces: the guard turns the bad value into "unknown" so the
  // batch never fails at all, and the item is still updated.
  await db.delete(osrsPrices).where(inArray(osrsPrices.itemId, IDS));
  const batch = [
    row(IDS[0], 100),
    { ...row(IDS[1], 0), high: safeInt(3_000_000_000) },
    row(IDS[2], 300),
  ];
  await upsert(batch as never);
  const got = await db.execute(sql`select item_id, high from osrs_prices where item_id in (${sql.join(IDS.map((i) => sql`${i}`), sql`, `)}) order by item_id`);
  const rows = ((got as unknown as { rows?: { item_id: number; high: number | null }[] }).rows ?? []);
  eq('all three rows land', rows.length, 3);
  eq('the bad price is stored as unknown', rows[1].high, null);
  ok('not clamped to the int4 ceiling', rows[1].high !== 2_147_483_647);
}

console.log('\nA duplicate id in one batch is what 21000 looks like');
{
  let threw = false;
  try {
    await upsert([row(IDS[0], 10), row(IDS[0], 20)]);
  } catch (e) {
    threw = true;
    ok('it is the on-conflict error', String((e as { cause?: { code?: string } })?.cause?.code) === '21000',
      String((e as { cause?: { code?: string } })?.cause?.code));
  }
  ok('two rows for one item abort the statement', threw);

  // Which is why sync-prices keys its rows by item id before inserting.
  const deduped = [...new Map([row(IDS[0], 10), row(IDS[0], 20)].map((r) => [r.itemId, r])).values()];
  eq('deduping leaves one row', deduped.length, 1);
  eq('and it is the last one seen', deduped[0].high, 20);
  await upsert(deduped);
}

await db.delete(osrsPrices).where(inArray(osrsPrices.itemId, IDS));
await db.delete(osrsItems).where(inArray(osrsItems.id, IDS));

console.log(`\n${checks - fail}/${checks} checks passed`);
process.exit(fail ? 1 : 0);
