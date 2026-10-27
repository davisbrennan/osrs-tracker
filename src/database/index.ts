import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';

declare global {
  // eslint-disable-next-line no-var
  var __pgPool: Pool | undefined;
}

export const pool =
  global.__pgPool ??
  new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30_000,
  });

if (process.env.NODE_ENV !== 'production') global.__pgPool = pool;

export const db = drizzle(pool);

/**
 * Rows out of a `db.execute()` result.
 *
 * `db.execute` returns a pg `Result`, which is NOT an array and NOT iterable.
 * That makes the two obvious ways of reading it both wrong, and wrong in
 * different ways:
 *
 *   const [row] = await db.execute(...)      // throws: not iterable
 *   Array.from(await db.execute(...))        // returns [] — SILENTLY
 *
 * The second is the dangerous one. A query that finds plenty of rows reports
 * none, every caller concludes there is no work to do, and nothing ever
 * errors. Two background jobs shipped with exactly that bug and reported
 * success while doing nothing at all.
 *
 * Driver versions differ on whether the result is already an array, so this
 * accepts either shape rather than assuming the one in front of it.
 */
export function rowsOf<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result === null || typeof result !== 'object') return [];
  const rows = (result as { rows?: unknown }).rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}
