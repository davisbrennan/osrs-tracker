/**
 * Recording job runs.
 *
 * This wraps the worker's call to a job rather than living inside each job,
 * for one reason: a job that throws on its first line — a bad import, a
 * missing environment variable — must still leave a row saying it was tried
 * and failed. A job that records its own runs cannot do that.
 *
 * Nothing here is allowed to break a job. Every database call is wrapped,
 * because the point of this table is to notice failures, and a bookkeeping
 * table that can itself take the price poller down would be a worse problem
 * than the one it solves.
 */

import { sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';
import type { JobResult } from '@/lib/osrs/jobs/util';

export type RunStatus = 'running' | 'ok' | 'failed' | 'skipped';

/** How long runs are kept. Enough to see a pattern, not enough to grow. */
export const RUN_RETENTION_DAYS = 14;

/**
 * Error messages are read in a browser, so they are trimmed to a sentence
 * or two. The full stack is already in the container log, which is where
 * you go once this page has told you where to look.
 */
const MAX_ERROR_CHARS = 400;

export function errorMessage(e: unknown): string {
  const raw =
    e instanceof Error ? e.message : typeof e === 'string' ? e : JSON.stringify(e) || 'unknown';
  const oneLine = raw.replace(/\s+/g, ' ').trim();
  return oneLine.length > MAX_ERROR_CHARS ? `${oneLine.slice(0, MAX_ERROR_CHARS - 1)}…` : oneLine;
}

/**
 * Open a row for a run that is starting. Returns its id, or null if the
 * insert failed — in which case the run proceeds unrecorded rather than not
 * at all.
 */
export async function startRun(job: string): Promise<number | null> {
  try {
    const rows = rowsOf<{ id: number }>(
      await db.execute(sql`
        insert into osrs_job_runs (job, started_at, status)
        values (${job}, now(), 'running')
        returning id
      `)
    );
    const id = rows[0]?.id;
    return typeof id === 'number' ? id : Number(id) || null;
  } catch {
    return null;
  }
}

export async function finishRun(
  id: number | null,
  status: Exclude<RunStatus, 'running'>,
  opts: { result?: JobResult; error?: unknown; durationMs?: number } = {}
): Promise<void> {
  if (id === null) return;
  try {
    // JSON.stringify can throw on a circular result, and a job returning one
    // should not be reported as a failed job.
    let payload: string | null = null;
    if (opts.result !== undefined) {
      try {
        payload = JSON.stringify(opts.result);
      } catch {
        payload = JSON.stringify({ unserialisable: true });
      }
    }

    await db.execute(sql`
      update osrs_job_runs
         set status = ${status},
             finished_at = now(),
             duration_ms = ${opts.durationMs ?? null},
             result = ${payload}::jsonb,
             error = ${opts.error === undefined ? null : errorMessage(opts.error)}
       where id = ${id}
    `);
  } catch {
    // Deliberately silent. See the header.
  }
}

/**
 * Record a whole run around a function.
 *
 * The result is returned untouched and exceptions are re-thrown, so wrapping
 * a job in this changes nothing about how it behaves — only about what is
 * known afterwards.
 */
export async function recordRun(
  job: string,
  run: () => Promise<JobResult>
): Promise<JobResult> {
  const id = await startRun(job);
  const started = Date.now();
  try {
    const result = await run();
    await finishRun(id, 'ok', { result, durationMs: Date.now() - started });
    return result;
  } catch (e) {
    await finishRun(id, 'failed', { error: e, durationMs: Date.now() - started });
    throw e;
  }
}

/** A tick that did not run because the previous one was still going. */
export async function recordSkip(job: string, reason: string): Promise<void> {
  const id = await startRun(job);
  await finishRun(id, 'skipped', { result: { skipped: true, reason }, durationMs: 0 });
}

/** Drop runs past the retention window. Returns how many went. */
export async function pruneJobRuns(): Promise<number> {
  const rows = rowsOf<{ id: number }>(
    await db.execute(sql`
      delete from osrs_job_runs
       where started_at < now() - (${RUN_RETENTION_DAYS} || ' days')::interval
      returning id
    `)
  );
  return rows.length;
}
