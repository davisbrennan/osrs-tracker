-- News, from two places, in one feed.
--
-- Your own posts and Jagex's update announcements share a table because
-- they share a reader: somebody opening the overview wants to know what
-- changed, and whether it changed in the game or on this site is a detail
-- they can see from a label rather than a reason to make them look in two
-- places.
--
-- `source` is what keeps them apart where it matters: site posts are
-- written here and are editable, Jagex items are fetched and are not.
CREATE TABLE IF NOT EXISTS osrs_news (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- 'site' = written by an admin here. 'jagex' = pulled from the official
  -- feed, headline and link only.
  source       text NOT NULL DEFAULT 'site',
  title        text NOT NULL,
  -- Site posts only. Jagex items carry a link instead: republishing their
  -- article text would be taking their content rather than pointing at it.
  body         text,
  url          text,
  published_at timestamptz NOT NULL DEFAULT now(),
  -- The feed's own id for an item, so re-fetching the same headline
  -- updates it rather than posting it again. Null for site posts.
  external_id  text,
  author_id    uuid REFERENCES users(id) ON DELETE SET NULL,
  -- Drafts stay out of the feed until published.
  published    boolean NOT NULL DEFAULT true,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  ALTER TABLE osrs_news
    ADD CONSTRAINT osrs_news_source_check CHECK (source IN ('site', 'jagex'));
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- The dedupe key for the feed sync. Partial, because site posts have no
-- external id and several nulls must not collide.
CREATE UNIQUE INDEX IF NOT EXISTS osrs_news_external_idx
  ON osrs_news (source, external_id)
  WHERE external_id IS NOT NULL;

-- Every read is "the newest published items", in one order.
CREATE INDEX IF NOT EXISTS osrs_news_published_idx
  ON osrs_news (published_at DESC)
  WHERE published;
