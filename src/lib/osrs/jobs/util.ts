/**
 * Shared plumbing for the sync jobs.
 */

/**
 * Split a list for batched inserts.
 *
 * Postgres allows 65,535 bound parameters in one statement, so a naive
 * "insert all 4,000 price rows at once" works for a 7-column table and then
 * breaks the day someone adds columns. Chunking by row count keeps a wide
 * margin and keeps each statement small enough to not stall other queries.
 */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  if (size < 1) throw new Error('chunk size must be at least 1');
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * The wiki reports times as Unix seconds; Postgres wants a Date.
 *
 * Null stays null. A zero timestamp is treated as null too, because the API
 * uses 0 for "never" on some rows and 1970 would sort as the stalest possible
 * price rather than as unknown.
 */
export function secondsToDate(seconds: number | null | undefined): Date | null {
  if (seconds === null || seconds === undefined) return null;
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000);
}

/** The top of the hour containing `now`, in UTC. The history table's key. */
export function hourBucket(now: Date = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCMinutes(0, 0, 0);
  return d;
}

/** Politeness delay between sequential requests to an external API. */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export type JobResult = Record<string, unknown>;

/**
 * Postgres int4 bounds. No price column uses int4 any more (see migration
 * 0011), but the constants stay: item ids, quantities and volumes are still
 * int4, and the numbers are worth having named.
 */
export const INT4_MIN = -2_147_483_648;
export const INT4_MAX = 2_147_483_647;

/**
 * The ceiling that actually binds the gp columns.
 *
 * They are int8 now, whose range is ±9.2 x 10^18 — far past what JavaScript
 * can hold exactly. Drizzle reads them with `mode: 'number'`, so anything
 * above Number.MAX_SAFE_INTEGER would come back with the last digits
 * quietly wrong. A price we cannot round-trip is not a price we should
 * store, so the safe-integer boundary is the real limit, not int8's.
 *
 * In practice this is ~4 million times the max cash stack. Nothing the
 * Grand Exchange can report comes near it; the guard is here for corrupt
 * upstream data, which is what it was always catching.
 */
export const GP_MAX = Number.MAX_SAFE_INTEGER;
export const GP_MIN = -Number.MAX_SAFE_INTEGER;

/**
 * A value a gp column will actually accept, or null.
 *
 * Null rather than clamped, deliberately. Clamping 3,000,000,000 to
 * 2,147,483,647 would publish a wrong price that looks entirely plausible
 * and would be flipped against; null means "unknown", which the whole app
 * already handles — ge.ts refuses to rate an item with a missing side.
 *
 * The reason this exists at all: these rows are inserted in batches of a
 * thousand, so ONE out-of-range value takes down the price poll for every
 * item on the site. Four thousand good prices should not be lost to one bad
 * one, and the count comes back in the job result so it is visible rather
 * than silent.
 *
 * It was bounded at int4 until v25, which was correct for the column type
 * and wrong for the game: the Grand Exchange quotes a handful of items above
 * a single max cash stack, so the guard was nulling real prices and those
 * items disappeared from the catalogue rather than showing as unpriced.
 */
export function safeInt(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  if (!Number.isFinite(v)) return null;
  const n = Math.trunc(v);
  return n < GP_MIN || n > GP_MAX ? null : n;
}

/**
 * Postgres timestamptz tops out well before JavaScript's Date does, and the
 * wiki reports times as Unix seconds that occasionally arrive absurd. An
 * out-of-range timestamp aborts the statement exactly like an out-of-range
 * integer does.
 */
const MAX_REASONABLE_MS = Date.UTC(2200, 0, 1);

export function safeDate(d: Date | null): Date | null {
  if (d === null) return null;
  const ms = d.getTime();
  if (!Number.isFinite(ms) || ms <= 0 || ms > MAX_REASONABLE_MS) return null;
  return d;
}
