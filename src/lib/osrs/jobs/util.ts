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
