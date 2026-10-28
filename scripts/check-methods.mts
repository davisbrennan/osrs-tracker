/**
 * Does every item the method catalogue mentions actually exist?
 *
 * The dataset references items by name, written by hand. The authority on
 * what an item is called is osrs_items, which comes from the wiki's mapping
 * endpoint. A name that does not resolve causes its method to be dropped,
 * which is the safe failure — but a silently missing method is still a
 * missing feature, so this says exactly which name is wrong.
 *
 * Needs DATABASE_URL and a populated catalogue. Run it after a deploy:
 *
 *   npm run check:methods
 */

import { Client } from 'pg';

const { METHODS, methodItemNames } = await import('@/lib/osrs/method-data');
const { buildNameIndex, resolveMethods, nameVariants } = await import(
  '@/lib/osrs/method-resolve'
);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('check:methods — DATABASE_URL is not set.');
  process.exit(2);
}

const client = new Client({ connectionString: url });
await client.connect();

const wanted = methodItemNames();
const variants = wanted.flatMap(nameVariants);

// lower(name), to match loadMethodCatalogue. A plain `name = ANY(...)` is
// case sensitive, which made this checker disagree with the resolver it is
// supposed to be checking.
const { rows } = await client.query<{ id: number; name: string }>(
  'SELECT id, name FROM osrs_items WHERE lower(name) = ANY($1::text[])',
  [variants.map((v) => v.toLowerCase())]
);

const catalogueSize = await client.query<{ count: string }>('SELECT count(*) FROM osrs_items');
await client.end();

const total = Number(catalogueSize.rows[0].count);

// The real catalogue is ~4,000 items. Anything far below that is not a
// dataset problem, it is a catalogue that has not been populated — or one
// that the jobs test truncated. Saying so beats printing 57 "missing name"
// errors that all have the same cause.
// Overridable, because a deliberately trimmed catalogue (a test fixture,
// say) is a legitimate thing to check against and should not be mistaken
// for an unpopulated one.
const PLAUSIBLE_CATALOGUE = Number(process.env.CHECK_METHODS_MIN_ITEMS ?? 500);
if (total < PLAUSIBLE_CATALOGUE) {
  console.error(
    `check:methods — osrs_items holds only ${total} item(s), far short of the ~4,000 the real catalogue has.\n` +
      'Nothing can be checked against it. Run the sync-items job first.\n' +
      '(If you just ran `npm run test:jobs` against this database, that truncates the osrs_* tables.)\n' +
      'To check against a deliberately small catalogue, set CHECK_METHODS_MIN_ITEMS=0.'
  );
  process.exit(2);
}

const index = buildNameIndex(rows);
const { resolved, failed } = resolveMethods(METHODS, index);

const unresolvedNames = [...new Set(failed.flatMap((f) => f.missing))].sort();

console.log(
  `check:methods — ${resolved.length}/${METHODS.length} methods resolved against ${total.toLocaleString('en-US')} catalogue items`
);

if (failed.length === 0) {
  console.log('check:methods — every item name resolves');
  process.exit(0);
}

console.error(`\n${unresolvedNames.length} item name(s) did not match anything in osrs_items:\n`);
for (const name of unresolvedNames) {
  console.error(`  ✗ ${JSON.stringify(name)}`);
}

console.error(`\nwhich drops ${failed.length} method(s):\n`);
for (const f of failed) {
  console.error(`  ${f.methodId} — needs ${f.missing.map((m) => JSON.stringify(m)).join(', ')}`);
}

console.error(
  '\nFix the names in src/lib/osrs/method-data.ts. To find the right spelling:\n' +
    "  docker compose exec db psql -U osrs -d osrs -c \"SELECT id, name FROM osrs_items WHERE name ILIKE '%ranarr%';\"\n"
);
process.exit(1);
