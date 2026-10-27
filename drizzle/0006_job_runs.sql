-- A record of every background job run.
--
-- Until now the worker logged to stdout and nowhere else, which means the
-- only way to learn whether a job was working was to read container logs.
-- That is fine for debugging a problem you already know about, and useless
-- for noticing one.
--
-- The failure this exists to catch is specific. Most of these jobs take a
-- budgeted slice and then have nothing left to do, so "ran and found nothing"
-- and "has been throwing on every tick since it shipped" produce the SAME
-- observable state: a table that is not growing. sync-wiki sat broken for
-- days in exactly that way — it had never successfully fetched anything, and
-- the empty table looked like patience.
--
-- Recording the run itself, separately from its effects, is what tells those
-- two apart.
CREATE TABLE IF NOT EXISTS osrs_job_runs (
  id          bigserial PRIMARY KEY,
  job         text NOT NULL,
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  -- 'running' is what a row looks like before its job returns. A row left in
  -- this state is itself a signal: the worker died mid-job, or the job hung.
  status      text NOT NULL DEFAULT 'running',
  -- The job's own return value, verbatim. These are small objects like
  -- {"fetched":4012,"updated":3887} and they are the difference between
  -- "it ran" and "it did something".
  result      jsonb,
  -- Message only, never a stack trace: this is read in a browser by someone
  -- who wants to know what broke, and stack traces in a web page are noise.
  error       text,
  duration_ms integer
);

DO $$
BEGIN
  ALTER TABLE osrs_job_runs
    ADD CONSTRAINT osrs_job_runs_status_check
    CHECK (status IN ('running', 'ok', 'failed', 'skipped'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Every read of this table is "the most recent run of job X", so the index
-- is (job, started_at desc) rather than one on each column.
CREATE INDEX IF NOT EXISTS osrs_job_runs_job_started_idx
  ON osrs_job_runs (job, started_at DESC);

-- Trimming is by age, and this makes that a range scan rather than a seq scan
-- over a table that gains roughly 500 rows a day.
CREATE INDEX IF NOT EXISTS osrs_job_runs_started_idx
  ON osrs_job_runs (started_at);
