-- What an alert is watching.
--
-- Until now every alert was a price crossing a fixed number, which is the
-- shape every tool offers and the least useful one: a threshold that was
-- sensible in March is noise by June, and choosing one at all requires
-- knowing what the item normally does.
--
-- 'unusual' is the one worth having. It fires when the margin reaches the
-- top of that item's OWN recent range, so it needs no number chosen by hand
-- and stays meaningful as the item drifts.
--
--   price   — the chosen side crosses `threshold` gp (the original behaviour)
--   margin  — margin after tax reaches `threshold` gp
--   unusual — margin reaches the `threshold`th percentile of its own 90 days
--
-- Defaulted to 'price' so every existing alert keeps doing exactly what its
-- owner set it up to do.
ALTER TABLE osrs_alerts
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'price';

DO $$
BEGIN
  ALTER TABLE osrs_alerts
    ADD CONSTRAINT osrs_alerts_kind_check
    CHECK (kind IN ('price', 'margin', 'unusual'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The checker filters on active alerts and, for 'unusual', needs to find
-- just those rows without scanning the rest.
CREATE INDEX IF NOT EXISTS osrs_alerts_kind_idx ON osrs_alerts (kind) WHERE active;
