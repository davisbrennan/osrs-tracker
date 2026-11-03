-- Widen every wiki-sourced gp column from integer to bigint.
--
-- Postgres `integer` is int4, which tops out at 2,147,483,647 — the same
-- number as the OSRS max cash stack, which is why it looked like a safe
-- choice. It is not. The Grand Exchange reports prices for items that trade
-- above a single cash stack (3rd age pickaxe, 3rd age druidic robes, the
-- high-end spoon items), and the wiki's API passes those through.
--
-- What happened to them: safeInt() in jobs/util.ts nulls out any value the
-- column cannot take, which protects the other four thousand items from one
-- bad row. But /items and /flips both require low AND high to be non-null,
-- so a nulled price does not show as "unpriced" — the item vanishes from the
-- catalogue entirely. Exactly the items worth the most attention.
--
-- The user-entered columns (osrs_trades.price, osrs_alerts.threshold,
-- users' cash_stack) were already bigint, so RSpill could record a flip it
-- could not quote a price for.
--
-- int8 is 8 bytes rather than 4. On osrs_price_history that is the only
-- table where it is worth a thought: ~450k rows x 2 columns x 4 extra bytes
-- is about 3.6 MB, against a 51 MB table. Not a consideration.
--
-- Each ALTER rewrites its table and takes an ACCESS EXCLUSIVE lock for the
-- duration. At these sizes that is seconds, and the five-minute poll simply
-- waits. Wrapped in the implicit transaction so a failure part-way leaves
-- every column as it was.

ALTER TABLE osrs_prices
  ALTER COLUMN high TYPE bigint,
  ALTER COLUMN low  TYPE bigint;

ALTER TABLE osrs_price_history
  ALTER COLUMN avg_high TYPE bigint,
  ALTER COLUMN avg_low  TYPE bigint;

ALTER TABLE osrs_price_daily
  ALTER COLUMN avg_high TYPE bigint,
  ALTER COLUMN avg_low  TYPE bigint;

-- Shop value and alch values come from the same mapping payload and are
-- subject to the same ceiling. They are not prices anyone trades at, but a
-- null here makes the item page's alch arithmetic disappear for no visible
-- reason, and the cost of widening them is nothing.
ALTER TABLE osrs_items
  ALTER COLUMN value    TYPE bigint,
  ALTER COLUMN highalch TYPE bigint,
  ALTER COLUMN lowalch  TYPE bigint;
