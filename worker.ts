/**
 * Background jobs for the OSRS tracker.
 *
 * Runs as its own container so a slow poll never blocks a web request. It is
 * a scheduler and nothing more — every job's logic lives in
 * src/lib/osrs/jobs, which is also what the web app imports, so the worker
 * and the pages can never disagree about what a margin is.
 *
 * Run with tsx rather than node: these jobs share the app's TypeScript
 * modules, and reimplementing the GE maths in plain JS here to avoid a
 * compile step is exactly the kind of duplication that eventually produces
 * two different answers for the same flip.
 */

import { Worker, Queue, type Job } from 'bullmq';
import IORedis from 'ioredis';
import { JOBS, isJobName, type JobName } from '@/lib/osrs/jobs';
import { recordRun, recordSkip, errorMessage } from '@/lib/osrs/jobs/record';

const connection = new IORedis(process.env.REDIS_URL || 'redis://cache:6379', {
  maxRetriesPerRequest: null,
});

const QUEUE = 'osrs';

const queue = new Queue(QUEUE, {
  connection,
  defaultJobOptions: {
    // Keep a short tail for debugging without letting Redis grow forever.
    removeOnComplete: { count: 50 },
    removeOnFail: { count: 100 },
    attempts: 3,
    backoff: { type: 'exponential', delay: 30_000 },
  },
});

/**
 * Overlap guard.
 *
 * A price poll that takes longer than its five-minute interval would
 * otherwise have a second copy start on top of it, and two concurrent
 * upserts over the same 4,000 rows is how you get lock contention on a
 * small VPS. One worker container means an in-process set is enough; if this
 * ever runs on two workers, this needs to become a Redis lock.
 */
const running = new Set<JobName>();

async function runJob(name: JobName) {
  if (running.has(name)) {
    console.warn(`[worker] ${name} is still running — skipping this tick`);
    const reason = 'previous run still in progress';
    // Recorded, not just logged. A job skipping every tick because the
    // previous one never finishes is a hang, and it is indistinguishable
    // from a healthy job unless the skips are written down somewhere.
    await recordSkip(name, reason);
    return { skipped: true, reason };
  }
  running.add(name);
  const startedAt = Date.now();
  try {
    // recordRun re-throws, so BullMQ's retry and the 'failed' handler below
    // behave exactly as they did before this wrapper existed.
    const result = await recordRun(name, () => JOBS[name].run());
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);
    console.log(`[worker] ${name} ok in ${seconds}s`, JSON.stringify(result));
    return result;
  } finally {
    running.delete(name);
  }
}

const worker = new Worker(
  QUEUE,
  async (job: Job) => {
    if (!isJobName(job.name)) {
      console.warn(`[worker] unknown job: ${job.name}`);
      return null;
    }
    return runJob(job.name);
  },
  {
    connection,
    // One at a time. These jobs are I/O-bound against two external APIs that
    // asked to be treated gently, and there is nothing to gain from racing
    // them against each other.
    concurrency: 1,
  }
);

// errorMessage, not err.message: for anything from the database driver
// `message` is the whole failing SQL statement and the actual complaint is
// nested in `cause`. Logging `message` is why the container log was no more
// use than the health page for the first failure this caught.
worker.on('failed', (job, err) =>
  console.error(
    `[worker] failed ${job?.name} (attempt ${job?.attemptsMade}):`,
    errorMessage(err)
  )
);
worker.on('error', (err) => console.error('[worker] error:', errorMessage(err)));

/**
 * Register the schedules.
 *
 * upsertJobScheduler is keyed on the job name, so a redeploy updates the
 * existing schedule in place instead of stacking a second one — the old
 * repeat-options API would quietly leave you polling twice as often after a
 * cadence change. Schedulers no longer in JOBS are removed, so deleting a
 * job here actually stops it rather than leaving an orphan firing in Redis
 * against a handler that no longer exists.
 */
async function registerSchedules() {
  const wanted = Object.keys(JOBS) as JobName[];

  for (const name of wanted) {
    const def = JOBS[name];
    await queue.upsertJobScheduler(
      name,
      { every: def.everyMs, startDate: new Date(Date.now() + def.initialDelayMs) },
      { name, data: {} }
    );
    console.log(
      `[worker] scheduled ${name} every ${Math.round(def.everyMs / 60_000)}m — ${def.description}`
    );
  }

  const existing = await queue.getJobSchedulers(0, 100);
  for (const s of existing) {
    if (s.key && !wanted.includes(s.key as JobName)) {
      await queue.removeJobScheduler(s.key);
      console.log(`[worker] removed stale schedule: ${s.key}`);
    }
  }
}

registerSchedules().catch((err) => {
  console.error('[worker] could not register schedules:', err);
  process.exit(1);
});

console.log('[worker] listening on queue:', QUEUE);

let shuttingDown = false;
const shutdown = async () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[worker] shutting down');
  // Let the in-flight job finish rather than killing a half-written batch.
  await worker.close();
  await queue.close();
  await connection.quit();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
