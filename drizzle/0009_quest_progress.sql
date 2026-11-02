-- Which quests an account has finished.
--
-- Per ACCOUNT rather than per user, because a user can track several RSNs
-- and an ironman's quest log has nothing to do with their main's. The
-- unlock planner joins this to the skill levels already stored in
-- osrs_snapshots, so a plan is always about one character.
--
-- Set by hand. The official hiscores do not report which quests are done,
-- and the wiki's WikiSync API — which does — explicitly asks third parties
-- not to use it, so this app does not. Ticking a box is the honest
-- alternative to quietly leaning on something we were asked to leave alone.
CREATE TABLE IF NOT EXISTS osrs_quest_progress (
  account_id  uuid NOT NULL REFERENCES osrs_accounts(id) ON DELETE CASCADE,
  -- The quest's id from src/lib/osrs/quest-data.ts, not its display name:
  -- names get re-styled by Jagex and the wiki, ids do not.
  quest_id    text NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (account_id, quest_id)
);

-- Every read is "what has this account done", so the primary key already
-- serves it; no second index needed.
