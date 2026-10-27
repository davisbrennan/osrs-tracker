#!/usr/bin/env node
// Applies drizzle/*.sql in filename order, once each, inside a transaction.
// Deliberately dependency-light: migrations run before the app boots.
import { readdir, readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'drizzle');
const client = new pg.Client({ connectionString: process.env.DATABASE_URL });

await client.connect();

await client.query(`
  CREATE TABLE IF NOT EXISTS _migrations (
    name       text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`);

const { rows } = await client.query('SELECT name FROM _migrations');
const applied = new Set(rows.map((r) => r.name));

const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
let count = 0;

for (const file of files) {
  if (applied.has(file)) {
    console.log(`skip  ${file}`);
    continue;
  }
  const sql = await readFile(join(dir, file), 'utf8');
  console.log(`apply ${file}`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('INSERT INTO _migrations (name) VALUES ($1)', [file]);
    await client.query('COMMIT');
    count++;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`\nFAILED on ${file}:\n${err.message}\n`);
    await client.end();
    process.exit(1);
  }
}

console.log(count === 0 ? 'database already up to date' : `applied ${count} migration(s)`);
await client.end();
