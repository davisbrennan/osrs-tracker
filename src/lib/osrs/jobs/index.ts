/**
 * The job registry.
 *
 * One place that knows every background job and how often it should run, so
 * the worker is a scheduler and nothing else, and so a job can be triggered
 * by hand from a script or an admin route without duplicating its wiring.
 */

import { syncItems } from '@/lib/osrs/jobs/sync-items';
import { syncPrices, pruneHistory } from '@/lib/osrs/jobs/sync-prices';
import { syncHiscores } from '@/lib/osrs/jobs/sync-hiscores';
import { checkAlerts } from '@/lib/osrs/jobs/check-alerts';
import { syncWiki } from '@/lib/osrs/jobs/sync-wiki';
import { rollupDaily, pruneDaily } from '@/lib/osrs/jobs/rollup-daily';
import { backfillHistory } from '@/lib/osrs/jobs/backfill-history';
import { pruneJobRuns } from '@/lib/osrs/jobs/record';
import type { JobResult } from '@/lib/osrs/jobs/util';

export type JobName =
  | 'sync-items'
  | 'sync-prices'
  | 'sync-hiscores'
  | 'prune-history'
  | 'sync-wiki'
  | 'rollup-daily'
  | 'backfill-history';

export type JobDefinition = {
  /** How often to run it, in milliseconds. */
  everyMs: number;
  /** Delay before the first run after a deploy, so boots are not a stampede. */
  initialDelayMs: number;
  run: () => Promise<JobResult>;
  description: string;
};

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const JOBS: Record<JobName, JobDefinition> = {
  // The wiki updates /latest continuously but asks consumers not to hammer it.
  // Five minutes is the cadence its own tooling suggests, and it is well
  // inside the useful life of a price.
  'sync-prices': {
    everyMs: 5 * MINUTE,
    initialDelayMs: 10_000,
    description: 'Current prices and hourly volumes for every item, then alerts.',
    run: async () => {
      const prices = await syncPrices();
      // Chained rather than scheduled separately: an alert must never be
      // judged against a price older than the one that just arrived.
      if (prices.skipped) return prices;
      const alerts = await checkAlerts();
      return { ...prices, alerts };
    },
  },

  // The catalogue only changes when Jagex ships an item.
  'sync-items': {
    everyMs: 24 * HOUR,
    initialDelayMs: 2_000,
    description: 'Refresh the item catalogue from /mapping.',
    run: syncItems,
  },

  // Daily is plenty for progress tracking, and each pass takes a budgeted
  // slice of accounts rather than all of them.
  'sync-hiscores': {
    everyMs: 6 * HOUR,
    initialDelayMs: 60_000,
    description: 'Fetch hiscores for accounts due a refresh and store a snapshot.',
    run: () => syncHiscores(),
  },

  // A trickle, not a sweep. Each run takes a small budgeted slice, so the
  // catalogue fills in over days and then there is nothing left to do.
  // Descriptions change about as often as the game's lore does.
  'sync-wiki': {
    everyMs: 30 * MINUTE,
    initialDelayMs: 3 * MINUTE,
    description: 'Fetch item descriptions from the wiki for items that lack one.',
    run: () => syncWiki(),
  },

  // Free: it reads hourly points already collected. Hourly so today's bar
  // is never far out of date, which is what the statistics compare against.
  'rollup-daily': {
    everyMs: HOUR,
    initialDelayMs: 90_000,
    description: 'Roll hourly price points into daily bars.',
    run: () => rollupDaily(),
  },

  // A trickle. Fetches the history we were not running to collect, busiest
  // items first, so the statistics have something to say before the site has
  // been up for a month.
  'backfill-history': {
    everyMs: 20 * MINUTE,
    initialDelayMs: 4 * MINUTE,
    description: 'Fetch past daily prices for items short of history.',
    run: () => backfillHistory(),
  },

  'prune-history': {
    everyMs: 24 * HOUR,
    initialDelayMs: 5 * MINUTE,
    description: 'Drop price history past the retention window.',
    run: async () => ({
      hourly: await pruneHistory(),
      daily: await pruneDaily(),
      jobRuns: await pruneJobRuns(),
    }),
  },
};

export function isJobName(name: string): name is JobName {
  return Object.prototype.hasOwnProperty.call(JOBS, name);
}

export {
  syncItems,
  syncPrices,
  syncHiscores,
  checkAlerts,
  pruneHistory,
  syncWiki,
  rollupDaily,
  pruneDaily,
  backfillHistory,
  pruneJobRuns,
};
