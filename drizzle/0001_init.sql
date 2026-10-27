-- OSRS tracker — initial schema.
--
-- One migration, not nineteen. The previous project reached 0018 by accretion
-- and eighteen of those built tables that no longer exist, so this is the
-- consolidated DDL as the schema actually stands: Better Auth's four tables,
-- the single-row site settings, and the ten osrs_* tables.
--
-- Two shapes to know before reading:
--
--   * Prices are GLOBAL. One copy of the Grand Exchange serves every visitor,
--     which is why the flip finder costs nothing per user and why osrs_prices
--     has no user_id. Everything keyed on user_id is per-person and small.
--
--   * Signups are open, so anything a stranger can create is capped. The cap
--     on tracked accounts per user is enforced in the action layer, because
--     that limit is a product decision that will move. The constraint that
--     stops the same name being added twice is not, so it lives here.
--
-- Verified by applying this file to an empty database and diffing the result
-- against the schema the nineteen migrations produced. They match.

-- Extensions. citext is load-bearing: users.email is citext so that
-- Foo@example.com and foo@example.com are the same account, which matters for
-- magic-link sign-in where people retype their address. gen_random_uuid() is
-- core in Postgres 13+, but pgcrypto is kept because Better Auth may reach for
-- it.
CREATE EXTENSION IF NOT EXISTS citext;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Touch updated_at on write, so no application path can forget to.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TABLE account (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id text NOT NULL,
    provider_id text NOT NULL,
    issuer text DEFAULT ''::text NOT NULL,
    access_token text,
    refresh_token text,
    id_token text,
    access_token_expires_at timestamp with time zone,
    refresh_token_expires_at timestamp with time zone,
    scope text,
    password text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE app_settings (
    id boolean DEFAULT true NOT NULL,
    signups_open boolean DEFAULT true NOT NULL,
    banner text,
    banner_level text DEFAULT 'info'::text NOT NULL,
    maintenance boolean DEFAULT false NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_by uuid,
    CONSTRAINT app_settings_id_check CHECK (id)
);
CREATE TABLE osrs_accounts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    rsn text NOT NULL,
    rsn_key text NOT NULL,
    account_type text DEFAULT 'main'::text NOT NULL,
    is_primary boolean DEFAULT false NOT NULL,
    missing_since timestamp with time zone,
    last_synced_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT osrs_accounts_account_type_check CHECK ((account_type = ANY (ARRAY['main'::text, 'ironman'::text, 'hardcore'::text, 'ultimate'::text, 'group'::text, 'deadman'::text])))
);
CREATE TABLE osrs_alerts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    item_id integer NOT NULL,
    direction text NOT NULL,
    threshold bigint NOT NULL,
    price_side text DEFAULT 'low'::text NOT NULL,
    last_fired_at timestamp with time zone,
    cooldown_minutes integer DEFAULT 360 NOT NULL,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT osrs_alerts_direction_check CHECK ((direction = ANY (ARRAY['below'::text, 'above'::text]))),
    CONSTRAINT osrs_alerts_price_side_check CHECK ((price_side = ANY (ARRAY['low'::text, 'high'::text])))
);
CREATE TABLE osrs_flips (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    account_id uuid,
    item_id integer NOT NULL,
    quantity integer NOT NULL,
    buy_price bigint NOT NULL,
    sell_price bigint,
    bought_at timestamp with time zone DEFAULT now() NOT NULL,
    sold_at timestamp with time zone,
    tax_paid bigint,
    profit bigint,
    note text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT osrs_flips_buy_price_check CHECK ((buy_price >= 0)),
    CONSTRAINT osrs_flips_check CHECK (((sold_at IS NULL) = (sell_price IS NULL))),
    CONSTRAINT osrs_flips_quantity_check CHECK ((quantity > 0)),
    CONSTRAINT osrs_flips_sell_price_check CHECK (((sell_price IS NULL) OR (sell_price >= 0)))
);
CREATE TABLE osrs_goals (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    account_id uuid NOT NULL,
    skill text NOT NULL,
    target_level integer,
    target_xp bigint,
    note text,
    achieved_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT osrs_goals_check CHECK (((target_level IS NOT NULL) OR (target_xp IS NOT NULL))),
    CONSTRAINT osrs_goals_target_level_check CHECK (((target_level >= 2) AND (target_level <= 99)))
);
CREATE TABLE osrs_items (
    id integer NOT NULL,
    name text NOT NULL,
    examine text,
    members boolean DEFAULT false NOT NULL,
    buy_limit integer,
    value integer,
    highalch integer,
    lowalch integer,
    icon text,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE osrs_price_history (
    item_id integer NOT NULL,
    ts timestamp with time zone NOT NULL,
    avg_high integer,
    avg_low integer,
    high_volume bigint,
    low_volume bigint
);
CREATE TABLE osrs_prices (
    item_id integer NOT NULL,
    high integer,
    high_time timestamp with time zone,
    low integer,
    low_time timestamp with time zone,
    hourly_volume bigint DEFAULT 0 NOT NULL,
    fetched_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE osrs_snapshots (
    id bigint NOT NULL,
    account_id uuid NOT NULL,
    taken_at timestamp with time zone DEFAULT now() NOT NULL,
    skills jsonb NOT NULL,
    total_level integer DEFAULT 0 NOT NULL,
    total_xp bigint DEFAULT 0 NOT NULL,
    combat_level integer DEFAULT 3 NOT NULL,
    activities jsonb
);
CREATE SEQUENCE osrs_snapshots_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;
ALTER SEQUENCE osrs_snapshots_id_seq OWNED BY osrs_snapshots.id;
CREATE TABLE osrs_user_settings (
    user_id uuid NOT NULL,
    cash_stack bigint DEFAULT 1000000 NOT NULL,
    default_account_id uuid,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE osrs_watchlist (
    user_id uuid NOT NULL,
    item_id integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE session (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    user_id uuid NOT NULL,
    token text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    ip_address text,
    user_agent text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE users (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    email citext NOT NULL,
    name text DEFAULT ''::text NOT NULL,
    image text,
    timezone text DEFAULT 'America/Chicago'::text NOT NULL,
    locale text DEFAULT 'en-US'::text NOT NULL,
    is_admin boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    email_verified boolean DEFAULT false NOT NULL
);
CREATE TABLE verification (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    identifier text NOT NULL,
    value text NOT NULL,
    expires_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE ONLY osrs_snapshots ALTER COLUMN id SET DEFAULT nextval('osrs_snapshots_id_seq'::regclass);
ALTER TABLE ONLY account
    ADD CONSTRAINT account_pkey PRIMARY KEY (id);
ALTER TABLE ONLY app_settings
    ADD CONSTRAINT app_settings_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_accounts
    ADD CONSTRAINT osrs_accounts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_accounts
    ADD CONSTRAINT osrs_accounts_user_id_rsn_key_key UNIQUE (user_id, rsn_key);
ALTER TABLE ONLY osrs_alerts
    ADD CONSTRAINT osrs_alerts_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_flips
    ADD CONSTRAINT osrs_flips_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_goals
    ADD CONSTRAINT osrs_goals_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_items
    ADD CONSTRAINT osrs_items_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_price_history
    ADD CONSTRAINT osrs_price_history_pkey PRIMARY KEY (item_id, ts);
ALTER TABLE ONLY osrs_prices
    ADD CONSTRAINT osrs_prices_pkey PRIMARY KEY (item_id);
ALTER TABLE ONLY osrs_snapshots
    ADD CONSTRAINT osrs_snapshots_pkey PRIMARY KEY (id);
ALTER TABLE ONLY osrs_user_settings
    ADD CONSTRAINT osrs_user_settings_pkey PRIMARY KEY (user_id);
ALTER TABLE ONLY osrs_watchlist
    ADD CONSTRAINT osrs_watchlist_pkey PRIMARY KEY (user_id, item_id);
ALTER TABLE ONLY session
    ADD CONSTRAINT session_pkey PRIMARY KEY (id);
ALTER TABLE ONLY session
    ADD CONSTRAINT session_token_key UNIQUE (token);
ALTER TABLE ONLY users
    ADD CONSTRAINT users_email_key UNIQUE (email);
ALTER TABLE ONLY users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);
ALTER TABLE ONLY verification
    ADD CONSTRAINT verification_pkey PRIMARY KEY (id);
CREATE UNIQUE INDEX account_provider_idx ON account USING btree (provider_id, account_id);
CREATE INDEX account_user_idx ON account USING btree (user_id);
CREATE INDEX osrs_accounts_sync_idx ON osrs_accounts USING btree (last_synced_at NULLS FIRST) WHERE (missing_since IS NULL);
CREATE INDEX osrs_accounts_user_idx ON osrs_accounts USING btree (user_id);
CREATE INDEX osrs_alerts_active_idx ON osrs_alerts USING btree (item_id) WHERE active;
CREATE INDEX osrs_flips_open_idx ON osrs_flips USING btree (user_id) WHERE (sold_at IS NULL);
CREATE INDEX osrs_flips_user_idx ON osrs_flips USING btree (user_id, bought_at DESC);
CREATE INDEX osrs_goals_account_idx ON osrs_goals USING btree (account_id) WHERE (achieved_at IS NULL);
CREATE INDEX osrs_items_name_idx ON osrs_items USING btree (lower(name));
CREATE INDEX osrs_price_history_ts_idx ON osrs_price_history USING btree (ts DESC);
CREATE INDEX osrs_snapshots_account_idx ON osrs_snapshots USING btree (account_id, taken_at DESC);
CREATE INDEX session_expires_idx ON session USING btree (expires_at);
CREATE INDEX session_user_idx ON session USING btree (user_id);
CREATE INDEX users_created_idx ON users USING btree (created_at DESC);
CREATE INDEX verification_expires_idx ON verification USING btree (expires_at);
CREATE INDEX verification_identifier_idx ON verification USING btree (identifier);
ALTER TABLE ONLY account
    ADD CONSTRAINT account_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY app_settings
    ADD CONSTRAINT app_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE ONLY osrs_accounts
    ADD CONSTRAINT osrs_accounts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_alerts
    ADD CONSTRAINT osrs_alerts_item_id_fkey FOREIGN KEY (item_id) REFERENCES osrs_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_alerts
    ADD CONSTRAINT osrs_alerts_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_flips
    ADD CONSTRAINT osrs_flips_account_id_fkey FOREIGN KEY (account_id) REFERENCES osrs_accounts(id) ON DELETE SET NULL;
ALTER TABLE ONLY osrs_flips
    ADD CONSTRAINT osrs_flips_item_id_fkey FOREIGN KEY (item_id) REFERENCES osrs_items(id);
ALTER TABLE ONLY osrs_flips
    ADD CONSTRAINT osrs_flips_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_goals
    ADD CONSTRAINT osrs_goals_account_id_fkey FOREIGN KEY (account_id) REFERENCES osrs_accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_price_history
    ADD CONSTRAINT osrs_price_history_item_id_fkey FOREIGN KEY (item_id) REFERENCES osrs_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_prices
    ADD CONSTRAINT osrs_prices_item_id_fkey FOREIGN KEY (item_id) REFERENCES osrs_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_snapshots
    ADD CONSTRAINT osrs_snapshots_account_id_fkey FOREIGN KEY (account_id) REFERENCES osrs_accounts(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_user_settings
    ADD CONSTRAINT osrs_user_settings_default_account_id_fkey FOREIGN KEY (default_account_id) REFERENCES osrs_accounts(id) ON DELETE SET NULL;
ALTER TABLE ONLY osrs_user_settings
    ADD CONSTRAINT osrs_user_settings_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_watchlist
    ADD CONSTRAINT osrs_watchlist_item_id_fkey FOREIGN KEY (item_id) REFERENCES osrs_items(id) ON DELETE CASCADE;
ALTER TABLE ONLY osrs_watchlist
    ADD CONSTRAINT osrs_watchlist_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE ONLY session
    ADD CONSTRAINT session_user_id_fkey FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE;
-- Keep updated_at honest on the tables people edit by hand. osrs_items is
-- deliberately left out: the sync job sets it explicitly as part of its
-- upsert, and that behaviour is covered by tests.
CREATE TRIGGER users_updated BEFORE UPDATE ON users
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER osrs_flips_updated BEFORE UPDATE ON osrs_flips
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
CREATE TRIGGER osrs_user_settings_updated BEFORE UPDATE ON osrs_user_settings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();
