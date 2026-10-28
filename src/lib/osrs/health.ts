/**
 * Is this thing actually working?
 *
 * Every check here answers a question the site cannot answer by looking
 * right. A page that renders an empty state looks the same whether there is
 * genuinely nothing to show or the job that fills it has been throwing since
 * the day it shipped. Money makers is the live example: if the item names in
 * the catalogue do not resolve, /money renders "Nothing you can run" — a
 * sentence that reads like a deliberate, correct answer.
 *
 * Two rules the checks follow.
 *
 * AN UNKNOWN IS NOT A PASS. A check that cannot tell says so. Reporting
 * green because a query returned nothing is how a health page becomes
 * something you stop reading.
 *
 * EVERY FAILURE CARRIES ITS FIX. A red line that does not say what to do
 * next is a worry, not a diagnostic.
 *
 * The grading is separated from the querying on purpose: `gradeX(facts)`
 * functions are pure and tested against the states that matter, especially
 * the one the whole table exists for — a job that has never run versus a
 * job that ran and correctly found nothing to do.
 */

import { JOBS, type JobName } from '@/lib/osrs/jobs';
import { MIN_SAMPLE_DAYS } from '@/lib/osrs/stats';

export type Status = 'ok' | 'warn' | 'fail' | 'unknown';

export type Check = {
  /** Stable key, for tests and for the DOM id. */
  id: string;
  title: string;
  status: Status;
  /** What was found. One line, specific, with the numbers in it. */
  detail: string;
  /** What to do about it. Only set when the status is not ok. */
  fix?: string;
  /** A command to run, shown as code under the fix. */
  command?: string;
};

/** Worst status wins, so the page can lead with one honest summary. */
const SEVERITY: Record<Status, number> = { ok: 0, unknown: 1, warn: 2, fail: 3 };

export function overallStatus(checks: Check[]): Status {
  return checks.reduce<Status>(
    (worst, c) => (SEVERITY[c.status] > SEVERITY[worst] ? c.status : worst),
    'ok'
  );
}

export function countByStatus(checks: Check[]): Record<Status, number> {
  const out: Record<Status, number> = { ok: 0, warn: 0, fail: 0, unknown: 0 };
  for (const c of checks) out[c.status]++;
  return out;
}

/* ------------------------------------------------------------------ */
/* Job runs                                                            */
/* ------------------------------------------------------------------ */

export type JobRun = {
  job: string;
  startedAt: Date;
  finishedAt: Date | null;
  status: 'running' | 'ok' | 'failed' | 'skipped';
  error: string | null;
  durationMs: number | null;
  result: unknown;
  /**
   * Consecutive failures since the last success, and when the rot started.
   *
   * "Last run failed 2m ago" is true of a job that broke two minutes ago and
   * of one that has been broken for a week, and those call for different
   * reactions. This is the difference.
   */
  failingSince?: Date | null;
  consecutiveFailures?: number;
};

/**
 * How late a job may be before it counts as late.
 *
 * Two intervals, not one. A job on a five-minute cadence that is six minutes
 * late is a slow tick, not an outage, and a health page that cries about
 * those is one nobody reads. Missing two turns in a row is a real signal.
 */
export const LATE_MULTIPLIER = 2;

/** And never less than this, so fast jobs are not permanently "late". */
export const LATE_FLOOR_MS = 10 * 60_000;

export function lateAfterMs(everyMs: number): number {
  return Math.max(everyMs * LATE_MULTIPLIER, LATE_FLOOR_MS);
}

export function gradeJob(
  job: JobName,
  last: JobRun | undefined,
  now: Date = new Date(),
  /**
   * How long the run log has been collecting, i.e. the age of its oldest
   * row. Null when the table is empty.
   */
  logAgeMs: number | null = null
): Check {
  const def = JOBS[job];
  const every = humanMs(def.everyMs);
  const base = { id: `job-${job}`, title: job };

  if (!last) {
    // "Never run" is only evidence of a problem if the job has HAD a chance
    // to run. The log starts empty on the release that introduced it, so a
    // job on a 24-hour cadence legitimately has nothing in it for a day —
    // and reporting that as broken made three of the six red lines on the
    // first real deploy false alarms of this page's own making.
    if (logAgeMs !== null && logAgeMs < def.everyMs) {
      return {
        ...base,
        status: 'unknown',
        detail: `No run recorded yet. This job runs every ${every}, and the log has only been collecting for ${humanMs(logAgeMs)}.`,
        fix: `Nothing to do but wait — it has not come round yet. Expect it within ${every} of the worker starting.`,
      };
    }

    // The distinction this whole table exists for. Never having run is not
    // the same as having nothing to do, and only one of them is fine.
    return {
      ...base,
      status: 'fail',
      detail:
        logAgeMs === null
          ? `Has never run. Expected every ${every}.`
          : `Has never run, and the log has been collecting for ${humanMs(logAgeMs)} — longer than its ${every} cadence.`,
      fix: 'The worker is not running this job at all — check that the worker container is up and that it registered its schedules on boot.',
      command: 'docker compose logs worker --tail 50',
    };
  }

  const ageMs = now.getTime() - last.startedAt.getTime();

  if (last.status === 'running') {
    // A row still open long after the job should have finished means the
    // worker died mid-run or the job is hung.
    if (ageMs > lateAfterMs(def.everyMs)) {
      return {
        ...base,
        status: 'fail',
        detail: `Started ${humanMs(ageMs)} ago and never finished. Expected every ${every}.`,
        fix: 'The job hung or the worker was killed mid-run. Restarting the worker clears it.',
        command: 'docker compose restart worker',
      };
    }
    return { ...base, status: 'ok', detail: `Running now, started ${humanMs(ageMs)} ago.` };
  }

  if (last.status === 'failed') {
    const runs = last.consecutiveFailures ?? 1;
    const since = last.failingSince
      ? now.getTime() - last.failingSince.getTime()
      : null;
    // One failure is a blip worth watching; a run of them since a datable
    // moment is a regression, and usually points at whatever shipped then.
    const history =
      runs > 1 && since !== null
        ? ` \u2014 failing for ${humanMs(since)} now, ${runs} runs in a row.`
        : '';

    return {
      ...base,
      status: 'fail',
      detail: `Last run failed ${humanMs(ageMs)} ago: ${last.error ?? 'no message recorded'}${history}`,
      fix:
        runs > 1
          ? 'The job is throwing every time, so nothing it writes is being updated. The message above is the database\u2019s own; the container log has the stack.'
          : 'The job threw once. If the next run succeeds this clears itself; if not, the message above is the database\u2019s own.',
      command: `docker compose logs worker --tail 100 | grep ${job}`,
    };
  }

  if (ageMs > lateAfterMs(def.everyMs)) {
    return {
      ...base,
      status: 'warn',
      detail: `Last ran ${humanMs(ageMs)} ago, but should run every ${every}.`,
      fix: 'The schedule stopped firing. A worker restart re-registers it.',
      command: 'docker compose restart worker',
    };
  }

  const took = last.durationMs !== null ? `, took ${humanMs(last.durationMs)}` : '';
  const did = summariseResult(last.result);
  if (last.status === 'skipped') {
    return {
      ...base,
      status: 'warn',
      detail: `Last tick was skipped ${humanMs(ageMs)} ago — the previous run was still going.`,
      fix: 'One skip is normal under load. Repeated skips mean the job takes longer than its interval.',
    };
  }

  return {
    ...base,
    status: 'ok',
    detail: `Ran ${humanMs(ageMs)} ago${took}. Every ${every}.${did ? ` Wrote ${did}.` : ''}`,
  };
}

/* ------------------------------------------------------------------ */
/* Feature checks                                                      */
/* ------------------------------------------------------------------ */

export function gradeCatalogue(facts: { items: number; priced: number }): Check {
  const base = { id: 'catalogue', title: 'Item catalogue' };
  if (facts.items === 0) {
    return {
      ...base,
      status: 'fail',
      detail: 'No items at all. Every page on the site is empty.',
      fix: 'sync-items has never populated the catalogue. Everything else depends on it, so fix this first.',
      command: 'docker compose logs worker --tail 50 | grep sync-items',
    };
  }
  if (facts.priced === 0) {
    return {
      ...base,
      status: 'fail',
      detail: `${facts.items.toLocaleString('en-US')} items, none of them priced.`,
      fix: 'The catalogue loaded but the price poller has never written. Margins cannot be computed at all.',
      command: 'docker compose logs worker --tail 50 | grep sync-prices',
    };
  }
  const pct = percent(facts.priced, facts.items);
  return {
    ...base,
    status: 'ok',
    detail: `${facts.priced.toLocaleString('en-US')} of ${facts.items.toLocaleString('en-US')} items priced (${pct}%).`,
  };
}

/**
 * The one this page was built for.
 *
 * Method inputs are matched to the item table BY NAME, written by hand. A
 * name that does not resolve drops its method — the safe failure — and the
 * page then renders a sentence that reads like a considered answer.
 */
export function gradeMethods(facts: {
  total: number;
  /** How many METHODS were dropped. */
  failedMethods: number;
  /** The distinct ITEM NAMES that did not resolve. Usually more than the
   *  method count, since one method has several inputs — which is why these
   *  are two fields and not one. Counting names as methods produced
   *  "57 of 28 methods dropped" on the first run of this page. */
  names: string[];
}): Check {
  const base = { id: 'methods', title: 'Money makers' };
  if (facts.total === 0) {
    return {
      ...base,
      status: 'unknown',
      detail: 'No methods in the catalogue to check.',
      fix: 'method-data.ts is empty, which is a code problem rather than a data one.',
    };
  }
  if (facts.failedMethods === 0) {
    return { ...base, status: 'ok', detail: `All ${facts.total} methods resolved and priced.` };
  }

  const shown = facts.names.slice(0, 4).join(', ');
  const more = facts.names.length > 4 ? `, +${facts.names.length - 4} more` : '';
  const all = facts.failedMethods >= facts.total;
  const items = `${facts.names.length} unresolved item name${facts.names.length === 1 ? '' : 's'}`;

  return {
    ...base,
    status: all ? 'fail' : 'warn',
    detail: all
      ? `All ${facts.total} methods are unpriced — /money shows nothing. ${items}: ${shown}${more}`
      : `${facts.failedMethods} of ${facts.total} methods dropped, from ${items}: ${shown}${more}`,
    fix: 'These item names do not match osrs_items. Fix the spellings in src/lib/osrs/method-data.ts.',
    command: 'docker compose exec app npm run check:methods',
  };
}

/**
 * Wiki descriptions fill in over days by design, so "not finished" is normal
 * and only "not started" or "stuck" is a problem.
 */
export function gradeWiki(facts: {
  described: number;
  missing: number;
  attempted: number;
  items: number;
  everRan: boolean;
}): Check {
  const base = { id: 'wiki', title: 'Item descriptions' };

  if (!facts.everRan) {
    return {
      ...base,
      status: 'fail',
      detail: 'The wiki sync has never completed a run.',
      fix: 'No item page will ever show a description. Check the worker log for sync-wiki.',
      command: 'docker compose logs worker --tail 100 | grep sync-wiki',
    };
  }

  // Ran, but nothing to show for it. This is the exact shape of the bug that
  // hid for days: the job "succeeded" every half hour and wrote nothing.
  if (facts.attempted === 0) {
    return {
      ...base,
      status: 'fail',
      detail: 'The sync has run but has never written a single row.',
      fix: 'The job is completing without fetching anything — it is failing silently rather than throwing.',
      command: 'docker compose logs worker --tail 100 | grep sync-wiki',
    };
  }

  if (facts.described === 0) {
    return {
      ...base,
      status: 'warn',
      detail: `${facts.attempted.toLocaleString('en-US')} items looked up, none matched a wiki article.`,
      fix: 'Rows are being written but every lookup comes back missing, which suggests the title matching is wrong rather than the fetch.',
    };
  }

  const pct = percent(facts.attempted, facts.items);
  return {
    ...base,
    status: 'ok',
    detail: `${facts.described.toLocaleString('en-US')} described, ${facts.missing.toLocaleString('en-US')} with no article — ${pct}% of the catalogue looked up so far.`,
  };
}

/**
 * The statistical layer needs MIN_SAMPLE_DAYS of daily bars before it will
 * say anything at all, so the honest measure is how many items it can
 * actually speak about — not how many rows exist.
 */
export function gradeHistory(facts: { itemsWithEnough: number; priced: number; days: number }): Check {
  const base = { id: 'history', title: 'Price history' };

  if (facts.days === 0) {
    return {
      ...base,
      status: 'fail',
      detail: 'No daily bars at all. Unusual and the history context on item pages have nothing to work from.',
      fix: 'Neither the rollup nor the backfill has produced anything.',
      command: 'docker compose logs worker --tail 100 | grep -E "rollup-daily|backfill-history"',
    };
  }

  if (facts.itemsWithEnough === 0) {
    return {
      ...base,
      status: 'warn',
      detail: `${facts.days} day${facts.days === 1 ? '' : 's'} of bars, but no item yet has the ${MIN_SAMPLE_DAYS} days the statistics need.`,
      fix: 'Expected on a new install — the backfill trickles. It only matters if it has not moved in a day or so.',
    };
  }

  const pct = percent(facts.itemsWithEnough, facts.priced);
  return {
    ...base,
    status: 'ok',
    detail: `${facts.itemsWithEnough.toLocaleString('en-US')} items have the ${MIN_SAMPLE_DAYS}+ days the statistics need (${pct}% of priced), across ${facts.days} days of bars.`,
  };
}

/**
 * Alerts are the only feature that reaches out to a person, so a silent
 * failure here is worse than elsewhere: the owner sees nothing and concludes
 * the market has been quiet.
 */
export function gradeAlerts(facts: { active: number; emailConfigured: boolean }): Check {
  const base = { id: 'alerts', title: 'Alerts' };

  if (facts.active > 0 && !facts.emailConfigured) {
    return {
      ...base,
      status: 'fail',
      detail: `${facts.active} active alert${facts.active === 1 ? '' : 's'}, but no email key is set — every one of them will fire into the log and reach nobody.`,
      fix: 'Set RESEND_API_KEY in /srv/osrs/.env and restart. Without it the app logs the email instead of sending it.',
      command: "cd /srv/osrs && grep -c '^RESEND_API_KEY=.\\+' .env",
    };
  }

  if (!facts.emailConfigured) {
    return {
      ...base,
      status: 'warn',
      detail: 'No alerts set yet, and no email key configured.',
      fix: 'Nothing is broken today, but the first alert anyone sets will fire silently. Sign-in links go the same way.',
      command: "cd /srv/osrs && grep -c '^RESEND_API_KEY=.\\+' .env",
    };
  }

  return {
    ...base,
    status: 'ok',
    detail: `${facts.active} active alert${facts.active === 1 ? '' : 's'}, email configured.`,
  };
}

/* ------------------------------------------------------------------ */

/**
 * A percentage that never rounds up to 100.
 *
 * 803 of 804 is 99.87%, and a status page that prints "100%" there is
 * telling a small lie in the one place it is supposed to be literal.
 */
export function percent(part: number, whole: number): number {
  if (whole <= 0) return 0;
  if (part >= whole) return 100;
  return Math.min(99, Math.round((part / whole) * 100));
}

/**
 * The numbers a job reported, compactly.
 *
 * The page's whole argument is that "it ran" and "it did something" are
 * different claims, so an OK row that only proves the first one is doing
 * half its job. sync-prices reporting `prices: 4012` is the evidence;
 * reporting `prices: 0` is a problem wearing a green badge.
 *
 * Only finite numbers, only the first few, and zeroes kept — a zero is the
 * most interesting value here, not the least.
 */
export function summariseResult(result: unknown, max = 3): string | null {
  if (result === null || typeof result !== 'object' || Array.isArray(result)) return null;
  const parts: string[] = [];
  for (const [k, v] of Object.entries(result as Record<string, unknown>)) {
    if (parts.length >= max) break;
    if (typeof v !== 'number' || !Number.isFinite(v)) continue;
    // camelCase and snake_case both read better as words here.
    const label = k.replace(/[_-]/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
    parts.push(`${v.toLocaleString('en-US')} ${label}`);
  }
  return parts.length ? parts.join(', ') : null;
}

/** Durations as a person reads them. */
export function humanMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.round(m / 60);
  if (h < 48) return `${h}h`;
  return `${Math.round(h / 24)}d`;
}
