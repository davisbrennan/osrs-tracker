/**
 * The queries behind the health page.
 *
 * Kept apart from the grading in health.ts so the grading can be tested
 * against states that are a nuisance to reproduce in a database — a job that
 * has never run, a wiki sync that writes nothing, a catalogue where every
 * name is wrong.
 *
 * Every gather is individually wrapped. One failing query must not take the
 * page down, because the page's whole job is to be readable when something
 * is broken. A check that cannot gather its facts reports `unknown`, which
 * is honest, rather than `ok`, which would be a lie.
 */

import { sql } from 'drizzle-orm';
import { db, rowsOf } from '@/database';
import { JOBS, type JobName } from '@/lib/osrs/jobs';
import { loadMethodCatalogue } from '@/app/actions/methods';
import { METHODS } from '@/lib/osrs/method-data';
import { closestName } from '@/lib/osrs/method-resolve';
import { osrsItems } from '@/database/schema';
import { MIN_SAMPLE_DAYS } from '@/lib/osrs/stats';
import {
  gradeJob,
  gradeCatalogue,
  gradeMethods,
  gradeWiki,
  gradeHistory,
  gradeAlerts,
  gradeBuild,
  type Check,
  type JobRun,
} from '@/lib/osrs/health';
import { buildSha } from '@/lib/osrs/jobs/record';

/** Turns whatever the driver hands back into a Date, or null. */
function asDate(v: unknown): Date | null {
  if (v instanceof Date) return v;
  if (typeof v === 'string' || typeof v === 'number') {
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function asNumber(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

/** The most recent run of each job, keyed by name. */
/** Age of the oldest recorded run, i.e. how long the log has been collecting. */
export async function runLogAgeMs(): Promise<number | null> {
  try {
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`select min(started_at) as oldest from osrs_job_runs`)
    );
    const oldest = asDate(rows[0]?.oldest);
    return oldest ? Date.now() - oldest.getTime() : null;
  } catch {
    return null;
  }
}

export async function latestRuns(): Promise<Map<string, JobRun>> {
  const out = new Map<string, JobRun>();
  try {
    // DISTINCT ON is the cheap way to say "newest row per job" in Postgres,
    // and it uses the (job, started_at desc) index directly.
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        select distinct on (job)
               job, started_at, finished_at, status, error, duration_ms, result, build
          from osrs_job_runs
         order by job, started_at desc
      `)
    );
    for (const r of rows) {
      const startedAt = asDate(r.started_at);
      if (!startedAt || typeof r.job !== 'string') continue;
      out.set(r.job, {
        job: r.job,
        startedAt,
        finishedAt: asDate(r.finished_at),
        status: (r.status as JobRun['status']) ?? 'ok',
        error: typeof r.error === 'string' ? r.error : null,
        durationMs: r.duration_ms === null ? null : asNumber(r.duration_ms),
        result: r.result ?? null,
        build: typeof r.build === 'string' ? r.build : null,
      });
    }

    // How long each job has been failing: every run since its last success.
    // Separate query rather than a window function because it has to cope
    // with a job that has NEVER succeeded, where "since the last ok" has no
    // row to anchor to.
    const streaks = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        select job,
               count(*) filter (where status = 'failed')::int as fails,
               min(started_at) filter (where status = 'failed') as since
          from osrs_job_runs r
         where started_at > coalesce(
                 (select max(started_at) from osrs_job_runs ok
                   where ok.job = r.job and ok.status = 'ok'),
                 '-infinity'::timestamptz)
         group by job
      `)
    );
    for (const row of streaks) {
      if (typeof row.job !== 'string') continue;
      const entry = out.get(row.job);
      if (!entry) continue;
      entry.consecutiveFailures = asNumber(row.fails);
      entry.failingSince = asDate(row.since);
    }
  } catch {
    // Most likely the table does not exist yet, i.e. the migration has not
    // been applied. Every job then grades as "never run", which is the right
    // answer to show: nothing is known about them.
  }
  return out;
}

const unknownCheck = (id: string, title: string, why: string): Check => ({
  id,
  title,
  status: 'unknown',
  detail: `Could not be checked: ${why}`,
  fix: 'This is a problem reading the data, not necessarily a problem with the feature itself.',
});

async function catalogueCheck(): Promise<Check> {
  try {
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        select (select count(*) from osrs_items)::int as items,
               (select count(*) from osrs_prices
                 where low is not null and high is not null)::int as priced
      `)
    );
    const r = rows[0] ?? {};
    return gradeCatalogue({ items: asNumber(r.items), priced: asNumber(r.priced) });
  } catch (e) {
    return unknownCheck('catalogue', 'Item catalogue', String(e).slice(0, 120));
  }
}

async function methodsCheck(): Promise<Check> {
  try {
    // The same call /money makes, so this cannot disagree with the page it
    // is reporting on.
    const catalogue = await loadMethodCatalogue();
    // Two different counts: methods dropped, and the distinct item names
    // behind them. One method has several inputs, so these are never equal.
    const names = [...new Set(catalogue.failed.flatMap((f) => f.missing))];

    // Only when something actually failed, and only the first few: this
    // reads every item name in the catalogue, which is not work to do on a
    // page that is usually all green.
    const suggestions: Record<string, string> = {};
    if (names.length > 0) {
      try {
        const all = await db.select({ name: osrsItems.name }).from(osrsItems);
        const candidates = all.map((r) => r.name);
        for (const n of names.slice(0, 4)) {
          const did = closestName(n, candidates);
          if (did) suggestions[n] = did;
        }
      } catch {
        // A suggestion is a nicety; the finding itself still stands.
      }
    }

    return gradeMethods({
      total: METHODS.length,
      failedMethods: catalogue.failed.length,
      names,
      suggestions,
    });
  } catch (e) {
    return unknownCheck('methods', 'Money makers', String(e).slice(0, 120));
  }
}

async function wikiCheck(runs: Map<string, JobRun>): Promise<Check> {
  try {
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        select (select count(*) from osrs_item_wiki where not missing and summary is not null)::int as described,
               (select count(*) from osrs_item_wiki where missing)::int as missing,
               (select count(*) from osrs_item_wiki)::int as attempted,
               (select count(*) from osrs_items)::int as items
      `)
    );
    const r = rows[0] ?? {};
    const last = runs.get('sync-wiki');
    return gradeWiki({
      described: asNumber(r.described),
      missing: asNumber(r.missing),
      attempted: asNumber(r.attempted),
      items: asNumber(r.items),
      everRan: last !== undefined && last.status === 'ok',
    });
  } catch (e) {
    return unknownCheck('wiki', 'Item descriptions', String(e).slice(0, 120));
  }
}

async function historyCheck(): Promise<Check> {
  try {
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`
        select (select count(*) from (
                  select item_id from osrs_price_daily
                   group by item_id having count(*) >= ${MIN_SAMPLE_DAYS}
                ) t)::int as items_with_enough,
               (select count(distinct day) from osrs_price_daily)::int as days,
               (select count(*) from osrs_prices
                 where low is not null and high is not null)::int as priced
      `)
    );
    const r = rows[0] ?? {};
    return gradeHistory({
      itemsWithEnough: asNumber(r.items_with_enough),
      days: asNumber(r.days),
      priced: asNumber(r.priced),
    });
  } catch (e) {
    return unknownCheck('history', 'Price history', String(e).slice(0, 120));
  }
}

async function alertsCheck(): Promise<Check> {
  try {
    const rows = rowsOf<Record<string, unknown>>(
      await db.execute(sql`select count(*)::int as active from osrs_alerts where active`)
    );
    return gradeAlerts({
      active: asNumber(rows[0]?.active),
      // Read here rather than imported from lib/email, which does not expose
      // it — and a boolean is all this needs. The key itself never leaves
      // the server.
      emailConfigured: Boolean(process.env.RESEND_API_KEY),
    });
  } catch (e) {
    return unknownCheck('alerts', 'Alerts', String(e).slice(0, 120));
  }
}

export type HealthReport = {
  jobs: Check[];
  features: Check[];
  /** True when the job-run table has no rows at all. */
  noRunsRecorded: boolean;
};

export async function healthReport(now: Date = new Date()): Promise<HealthReport> {
  const [runs, logAgeMs] = await Promise.all([latestRuns(), runLogAgeMs()]);

  // Gathered in parallel: this page is read when something is wrong, and
  // six sequential round trips is a page that feels broken too.
  const [catalogue, methods, wiki, history, alerts] = await Promise.all([
    catalogueCheck(),
    methodsCheck(),
    wikiCheck(runs),
    historyCheck(),
    alertsCheck(),
  ]);

  // Whichever build most recently wrote a run is the one the worker is on.
  const newest = [...runs.values()].sort(
    (a, b) => b.startedAt.getTime() - a.startedAt.getTime()
  )[0];
  const build = gradeBuild({ app: buildSha(), worker: newest?.build ?? null });

  const jobs = (Object.keys(JOBS) as JobName[]).map((name) =>
    gradeJob(name, runs.get(name), now, logAgeMs)
  );

  return {
    jobs,
    features: [catalogue, methods, wiki, history, alerts, build],
    noRunsRecorded: runs.size === 0,
  };
}
