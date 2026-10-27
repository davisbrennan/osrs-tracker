-- Cached item descriptions from the OSRS Wiki.
--
-- A table of its own rather than columns on osrs_items, for three reasons:
--
--  1. sync-items upserts a fixed column set from the prices mapping endpoint
--     every day. Wiki text has a different source, a far slower cadence, and
--     no business being touched by that job.
--  2. The licence differs. Everything in osrs_items is game data; everything
--     here is CC BY-NC-SA 3.0 wiki prose that must carry attribution. Keeping
--     it in one table means it can be audited — or dropped — in one place.
--  3. Misses are worth recording. An item whose name matches no article
--     should be remembered as such, so the job stops asking every run.

CREATE TABLE IF NOT EXISTS osrs_item_wiki (
  item_id      integer PRIMARY KEY REFERENCES osrs_items(id) ON DELETE CASCADE,

  -- The article we landed on, after redirects. Null when there is none.
  title        text,
  page_id      integer,

  -- A verbatim prefix of the lead section. Not rewritten: editing it would
  -- make this a derivative work and pull share-alike onto our own text.
  summary      text,

  -- The exact article URL. This is the attribution the licence requires, so
  -- it is stored with the text rather than rebuilt at render time — if the
  -- text is shown, the credit it needs is right next to it.
  url          text,

  -- Set when the wiki has no article for this item's name. Lets the job skip
  -- known misses instead of re-requesting them forever.
  missing      boolean NOT NULL DEFAULT false,

  fetched_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Drives "what should I fetch next": oldest first, misses last.
CREATE INDEX IF NOT EXISTS osrs_item_wiki_stale_idx
  ON osrs_item_wiki (missing, fetched_at);

DROP TRIGGER IF EXISTS set_updated_at ON osrs_item_wiki;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON osrs_item_wiki
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
