import { NextResponse } from 'next/server';
import { pool } from '@/database';
import { redis } from '@/lib/redis';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * How long any one dependency may take before it counts as down.
 *
 * A health endpoint that can hang is worse than one that reports a
 * failure: the deploy polls this to decide whether a new container is
 * healthy, and "no answer" is neither. The pool has its own connection
 * timeout now, but this is the backstop — a query that is slow for some
 * other reason must not stop this route answering either.
 */
const DB_TIMEOUT_MS = 3_000;

/*
 * Redis gets a second, not three.
 *
 * It is advisory here — nothing in a request depends on it — so waiting
 * three seconds to confirm what we already know makes every healthy
 * response three seconds slow. Docker's own healthcheck allows five, and
 * spending most of that budget on a dependency that cannot fail the check
 * is how a healthy container gets marked unhealthy under load.
 */
const REDIS_TIMEOUT_MS = 1_000;

async function probe(name: string, timeoutMs: number, fn: () => Promise<unknown>): Promise<string> {
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`${name} timed out`)), timeoutMs)
      ),
    ]);
    return 'up';
  } catch {
    return 'down';
  }
}

export async function GET() {
  const checks: Record<string, string> = {};

  // Together, not one after the other: a down dependency should not add
  // its timeout to the next one's.
  const [db, cache] = await Promise.all([
    probe('db', DB_TIMEOUT_MS, () => pool.query('SELECT 1')),
    probe('redis', REDIS_TIMEOUT_MS, () => redis.ping()),
  ]);
  checks.db = db;
  checks.redis = cache;

  /*
   * Only the database decides whether this container is healthy.
   *
   * The web app imports Redis in exactly one place: this file. Every page
   * renders fine without it — only the worker's queue needs it. So a
   * Redis blip used to return 503, which marks the container unhealthy
   * and makes osrs-deploy abort rather than switch traffic, for a
   * dependency that was not being used.
   *
   * Redis is still reported, because an operator wants to know. It just
   * does not get a vote on readiness. If the app ever starts using it for
   * something a request depends on, this is the line to change.
   */
  const ok = checks.db === 'up';

  return NextResponse.json(
    {
      ok,
      sha: process.env.NEXT_PUBLIC_BUILD_SHA ?? 'dev',
      uptime: Math.round(process.uptime()),
      ...checks,
    },
    { status: ok ? 200 : 503 }
  );
}
