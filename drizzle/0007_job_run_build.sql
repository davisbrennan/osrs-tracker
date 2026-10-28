-- Which build recorded each job run.
--
-- The app and the worker run from the SAME image but as separate containers,
-- so they can drift: a deploy that rebuilds and flips the app while leaving
-- the worker on the previous image produces a site that looks fully updated
-- and a background system that is not. Nothing in the app could see that.
--
-- It is not hypothetical. After shipping a fix to how job errors are
-- recorded, the health page kept displaying errors in the OLD format — and
-- there was no way to tell from inside the app whether the worker had picked
-- up the new code at all, or whether the fix simply had not worked.
--
-- The image bakes NEXT_PUBLIC_BUILD_SHA at build time, so whichever build
-- wrote a row can say so, and the page can compare it with its own.
ALTER TABLE osrs_job_runs
  ADD COLUMN IF NOT EXISTS build text;
