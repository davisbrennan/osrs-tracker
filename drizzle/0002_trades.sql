-- The trade blotter.
--
-- Replaces osrs_flips, where one row was a buy AND its matching sell. That
-- shape cannot represent what the Grand Exchange actually forces on anyone
-- trading at size: the four-hour buy limit means a large position is built
-- from several lots at different prices, and sold down in pieces. A one-row
-- flip silently gets the cost basis wrong the moment you average down.
--
-- So this stores EXECUTIONS, the way a real book does. Positions, average
-- cost and realised P&L are derived from them in src/lib/osrs/portfolio.ts
-- rather than stored, which means no aggregate can drift out of step with
-- the trades underneath it.
--
-- It is also the shape a RuneLite plugin would POST into later: a fill is a
-- fill, whether typed in by hand or read from the GE interface.

CREATE TABLE IF NOT EXISTS osrs_trades (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id  uuid REFERENCES osrs_accounts(id) ON DELETE SET NULL,
  item_id     integer NOT NULL REFERENCES osrs_items(id),
  side        text NOT NULL CHECK (side IN ('buy','sell')),
  quantity    integer NOT NULL CHECK (quantity > 0),
  -- Per unit. bigint because a stack's total can exceed a 32-bit integer
  -- even though a single price cannot.
  price       bigint NOT NULL CHECK (price >= 0),
  executed_at timestamptz NOT NULL DEFAULT now(),
  -- Recorded at execution rather than derived on read, so a future change
  -- to the GE's tax rate cannot silently rewrite what you actually paid.
  -- Null on buys: the Grand Exchange taxes the seller only.
  tax_paid    bigint CHECK (tax_paid IS NULL OR tax_paid >= 0),
  -- Where the row came from. A plugin-sourced fill should be distinguishable
  -- from a hand-typed one without guessing.
  source      text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','import','plugin')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  -- A buy has no tax. Enforced here rather than trusted to the app, because
  -- a taxed buy would quietly overstate every cost basis it touches.
  CHECK (side = 'sell' OR tax_paid IS NULL)
);

-- The blotter is read newest-first per user, and the portfolio builder reads
-- a user's whole history ordered by time.
CREATE INDEX IF NOT EXISTS osrs_trades_user_idx
  ON osrs_trades (user_id, executed_at DESC);
CREATE INDEX IF NOT EXISTS osrs_trades_user_item_idx
  ON osrs_trades (user_id, item_id, executed_at);

CREATE TRIGGER osrs_trades_updated BEFORE UPDATE ON osrs_trades
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ------------------------------------------------------------------ carry
-- Existing flips become one or two executions each. A closed flip was always
-- a buy and a sell that happened to share a row; this just separates them.
--
-- Done before the drop so no data is lost, and written to be re-runnable:
-- the WHERE NOT EXISTS guard means applying this twice cannot duplicate.

INSERT INTO osrs_trades (user_id, account_id, item_id, side, quantity, price, executed_at, tax_paid, source, note)
SELECT f.user_id, f.account_id, f.item_id, 'buy', f.quantity, f.buy_price, f.bought_at, NULL, 'import', f.note
FROM osrs_flips f
WHERE NOT EXISTS (
  SELECT 1 FROM osrs_trades tr
  WHERE tr.user_id = f.user_id AND tr.item_id = f.item_id
    AND tr.side = 'buy' AND tr.executed_at = f.bought_at AND tr.quantity = f.quantity
);

INSERT INTO osrs_trades (user_id, account_id, item_id, side, quantity, price, executed_at, tax_paid, source, note)
SELECT f.user_id, f.account_id, f.item_id, 'sell', f.quantity, f.sell_price, f.sold_at, f.tax_paid, 'import', f.note
FROM osrs_flips f
WHERE f.sold_at IS NOT NULL AND f.sell_price IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM osrs_trades tr
    WHERE tr.user_id = f.user_id AND tr.item_id = f.item_id
      AND tr.side = 'sell' AND tr.executed_at = f.sold_at AND tr.quantity = f.quantity
  );

-- osrs_flips is deliberately LEFT IN PLACE. Dropping it in the same
-- migration that copies out of it means a bug in the copy is unrecoverable,
-- and the table is tiny. A later migration removes it once the blotter has
-- been running on real data.
