-- One bar per item per day.
--
-- Statistics need a uniform granularity. osrs_price_history holds hourly
-- points going forward, but history fetched from the wiki's timeseries
-- endpoint arrives at a coarser step — and mixing the two would silently
-- weight recent days more heavily than older ones, which produces confident,
-- plausible, wrong percentiles.
--
-- So both sources roll into daily bars, and every statistic is computed from
-- these rows alone. They are also small: ~4,000 items x 90 days is well
-- inside what a single index can serve.

CREATE TABLE IF NOT EXISTS osrs_price_daily (
  item_id   integer NOT NULL REFERENCES osrs_items(id) ON DELETE CASCADE,
  -- Midnight UTC. A date, not a timestamp, so a bar cannot be recorded twice
  -- under two spellings of the same day.
  day       date    NOT NULL,
  avg_high  integer,
  avg_low   integer,
  -- Both sides summed, which is what "traded that day" means to a person.
  volume    bigint  NOT NULL DEFAULT 0,
  PRIMARY KEY (item_id, day)
);

-- The statistics query is always "this item, these last N days".
CREATE INDEX IF NOT EXISTS osrs_price_daily_item_day_idx
  ON osrs_price_daily (item_id, day DESC);

-- Drives the backfill's "which items are short of history" question.
CREATE INDEX IF NOT EXISTS osrs_price_daily_day_idx
  ON osrs_price_daily (day);
