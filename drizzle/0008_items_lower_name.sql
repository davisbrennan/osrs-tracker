-- Case-insensitive item lookup by name.
--
-- The method catalogue references items by hand-written name, and the
-- resolver lower-cases both sides before comparing — except the lower-casing
-- happened only in the index BUILT FROM THE QUERY RESULTS, while the query
-- itself used a plain `name IN (…)`, which Postgres evaluates case
-- sensitively. So a name that differed only in capitalisation returned zero
-- rows and the normalisation never got a chance to help.
--
-- 'Wine of zamorak' in the dataset versus 'Wine of Zamorak' in the catalogue
-- was exactly that: one method silently dropped, /money quietly a little
-- wrong, and nothing anywhere said why.
--
-- The query is now `lower(name) IN (…)`. This index keeps that an index
-- lookup rather than a scan of the whole catalogue, which is what the
-- original plain equality was for.
CREATE INDEX IF NOT EXISTS osrs_items_lower_name_idx
  ON osrs_items (lower(name));
