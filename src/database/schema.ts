import {
  pgTable,
  uuid,
  text,
  boolean,
  timestamp,
  jsonb,
  integer,
  bigint,
  bigserial,
  date,
  primaryKey,
  index,
} from 'drizzle-orm/pg-core';

// ---------- Better Auth core ----------
// Property names must match Better Auth’s field names; the string argument is
// the actual Postgres column.

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull().default(''),
  email: text('email').notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  timezone: text('timezone').notNull().default('America/Chicago'),
  locale: text('locale').notNull().default('en-US'),
  isAdmin: boolean('is_admin').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp('deleted_at', { withTimezone: true }),
});

export const session = pgTable('session', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  token: text('token').notNull().unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const account = pgTable('account', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: text('account_id').notNull(),
  providerId: text('provider_id').notNull(),
  issuer: text('issuer').notNull().default(''),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  idToken: text('id_token'),
  accessTokenExpiresAt: timestamp('access_token_expires_at', { withTimezone: true }),
  refreshTokenExpiresAt: timestamp('refresh_token_expires_at', { withTimezone: true }),
  scope: text('scope'),
  password: text('password'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const verification = pgTable('verification', {
  id: uuid('id').primaryKey().defaultRandom(),
  identifier: text('identifier').notNull(),
  value: text('value').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ---------- Site settings ----------
// A single row (id is always true), so maintenance mode and the banner are one
// cheap read rather than a table scan.
export const appSettings = pgTable('app_settings', {
  id: boolean('id').primaryKey().default(true),
  signupsOpen: boolean('signups_open').notNull().default(true),
  banner: text('banner'),
  bannerLevel: text('banner_level').notNull().default('info'),
  maintenance: boolean('maintenance').notNull().default(false),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  updatedBy: uuid('updated_by').references(() => users.id, { onDelete: 'set null' }),
});

// ---------- OSRS tracker ----------
// Mirrors drizzle/0001_init.sql.
//
// Shapes worth knowing before reading on: prices are GLOBAL — one copy of the
// Grand Exchange serves every visitor, which is why the flip finder costs
// nothing per user. Everything hanging off userId is per-person and small.

// A person can track several RuneScape accounts — a main and an ironman is the
// usual pair — so this hangs off users rather than being columns on it.
export const osrsAccounts = pgTable('osrs_accounts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  rsn: text('rsn').notNull(),
  // Kept alongside rsn so the display keeps the player's own capitalisation
  // while lookups and the uniqueness constraint stay case-insensitive.
  rsnKey: text('rsn_key').notNull(),
  accountType: text('account_type').notNull().default('main'),
  isPrimary: boolean('is_primary').notNull().default(false),
  // Set when the hiscores say this name does not exist, so the poller backs
  // off instead of collecting a 404 every five minutes.
  missingSince: timestamp('missing_since', { withTimezone: true }),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// One row per hiscores fetch. Skills are jsonb rather than 25 columns because
// Jagex adds skills and a new one should not mean a migration.
export const osrsSnapshots = pgTable('osrs_snapshots', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => osrsAccounts.id, { onDelete: 'cascade' }),
  takenAt: timestamp('taken_at', { withTimezone: true }).notNull().defaultNow(),
  skills: jsonb('skills').notNull(),
  // Denormalised so charts and sorting never unpack the jsonb.
  totalLevel: integer('total_level').notNull().default(0),
  totalXp: bigint('total_xp', { mode: 'number' }).notNull().default(0),
  combatLevel: integer('combat_level').notNull().default(3),
  activities: jsonb('activities'),
});

export const osrsGoals = pgTable('osrs_goals', {
  id: uuid('id').primaryKey().defaultRandom(),
  accountId: uuid('account_id')
    .notNull()
    .references(() => osrsAccounts.id, { onDelete: 'cascade' }),
  skill: text('skill').notNull(),
  targetLevel: integer('target_level'),
  targetXp: bigint('target_xp', { mode: 'number' }),
  note: text('note'),
  achievedAt: timestamp('achieved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// Mirrors the wiki's /mapping endpoint. The id is Jagex's own item id, so it
// is the natural key and is written explicitly rather than generated.
export const osrsItems = pgTable('osrs_items', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  examine: text('examine'),
  members: boolean('members').notNull().default(false),
  // GE buy limit per 4 hours. Null means the wiki publishes none.
  buyLimit: integer('buy_limit'),
  value: integer('value'),
  highalch: integer('highalch'),
  lowalch: integer('lowalch'),
  icon: text('icon'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// Current state only, one row per item, overwritten each poll. History lives
// next door so the flip finder's hot path touches one small table.
export const osrsPrices = pgTable('osrs_prices', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => osrsItems.id, { onDelete: 'cascade' }),
  // "high" is the instant-buy price (what you sell into); "low" is the
  // instant-sell price (what you buy at). The wiki's own naming, kept so
  // there is no translation layer to get backwards.
  high: integer('high'),
  highTime: timestamp('high_time', { withTimezone: true }),
  low: integer('low'),
  lowTime: timestamp('low_time', { withTimezone: true }),
  hourlyVolume: bigint('hourly_volume', { mode: 'number' }).notNull().default(0),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
});

// The composite key is doing real work: the writer truncates ts to the hour,
// so re-running an hourly snapshot conflicts with itself and can be skipped
// rather than duplicating the row.
export const osrsPriceHistory = pgTable(
  'osrs_price_history',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => osrsItems.id, { onDelete: 'cascade' }),
    ts: timestamp('ts', { withTimezone: true }).notNull(),
    avgHigh: integer('avg_high'),
    avgLow: integer('avg_low'),
    highVolume: bigint('high_volume', { mode: 'number' }),
    lowVolume: bigint('low_volume', { mode: 'number' }),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.ts] })]
);

export const osrsFlips = pgTable('osrs_flips', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => osrsAccounts.id, { onDelete: 'set null' }),
  itemId: integer('item_id')
    .notNull()
    .references(() => osrsItems.id),
  quantity: integer('quantity').notNull(),
  buyPrice: bigint('buy_price', { mode: 'number' }).notNull(),
  // Null until the sell side completes, which is what makes a flip "open".
  sellPrice: bigint('sell_price', { mode: 'number' }),
  boughtAt: timestamp('bought_at', { withTimezone: true }).notNull().defaultNow(),
  soldAt: timestamp('sold_at', { withTimezone: true }),
  // Written on close rather than derived on read, so a future change to the
  // tax rate cannot silently rewrite history.
  taxPaid: bigint('tax_paid', { mode: 'number' }),
  profit: bigint('profit', { mode: 'number' }),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const osrsAlerts = pgTable('osrs_alerts', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  itemId: integer('item_id')
    .notNull()
    .references(() => osrsItems.id, { onDelete: 'cascade' }),
  /** price | margin | unusual. See drizzle/0005 for what threshold means. */
  kind: text('kind').notNull().default('price'),
  direction: text('direction').notNull(),
  threshold: bigint('threshold', { mode: 'number' }).notNull(),
  priceSide: text('price_side').notNull().default('low'),
  // Stops a price sitting on the threshold mailing every five minutes.
  lastFiredAt: timestamp('last_fired_at', { withTimezone: true }),
  cooldownMinutes: integer('cooldown_minutes').notNull().default(360),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

export const osrsWatchlist = pgTable(
  'osrs_watchlist',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    itemId: integer('item_id')
      .notNull()
      .references(() => osrsItems.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemId] })]
);

// The cash stack drives the whole flip finder, so it lives with the user
// rather than being retyped on every visit.
export const osrsUserSettings = pgTable('osrs_user_settings', {
  userId: uuid('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  cashStack: bigint('cash_stack', { mode: 'number' }).notNull().default(1000000),
  defaultAccountId: uuid('default_account_id').references(() => osrsAccounts.id, {
    onDelete: 'set null',
  }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// The trade blotter. Executions are the stored facts; positions, average
// cost and realised P&L are derived in src/lib/osrs/portfolio.ts rather
// than stored, so no aggregate can drift from the trades underneath it.
export const osrsTrades = pgTable('osrs_trades', {
  id: uuid('id').primaryKey().defaultRandom(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  accountId: uuid('account_id').references(() => osrsAccounts.id, { onDelete: 'set null' }),
  itemId: integer('item_id')
    .notNull()
    .references(() => osrsItems.id),
  side: text('side').notNull(),
  quantity: integer('quantity').notNull(),
  /** Per unit. */
  price: bigint('price', { mode: 'number' }).notNull(),
  executedAt: timestamp('executed_at', { withTimezone: true }).notNull().defaultNow(),
  /** Null on buys — the Grand Exchange taxes the seller only. */
  taxPaid: bigint('tax_paid', { mode: 'number' }),
  /** manual | import | plugin. A plugin fill should be distinguishable. */
  source: text('source').notNull().default('manual'),
  note: text('note'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One price bar per item per day.
 *
 * Statistics are computed from these and nothing else, because they are the
 * only uniform series available: hourly points going forward, and coarser
 * history backfilled from the wiki, both roll into here. See
 * lib/osrs/stats.ts for why uniformity matters.
 */
export const osrsPriceDaily = pgTable(
  'osrs_price_daily',
  {
    itemId: integer('item_id')
      .notNull()
      .references(() => osrsItems.id, { onDelete: 'cascade' }),
    /** Midnight UTC, stored as a date so a day cannot be recorded twice. */
    day: date('day').notNull(),
    avgHigh: integer('avg_high'),
    avgLow: integer('avg_low'),
    /** Both sides summed. */
    volume: bigint('volume', { mode: 'number' }).notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.day] })]
);

/**
 * Item descriptions cached from the OSRS Wiki.
 *
 * Separate from osrs_items because the source, cadence and LICENCE all
 * differ: this is CC BY-NC-SA 3.0 prose that must be shown with its
 * attribution, while osrs_items is game data from the prices mapping
 * endpoint. See lib/osrs/wiki.ts before displaying any of it.
 */
export const osrsItemWiki = pgTable('osrs_item_wiki', {
  itemId: integer('item_id')
    .primaryKey()
    .references(() => osrsItems.id, { onDelete: 'cascade' }),
  title: text('title'),
  pageId: integer('page_id'),
  /** A verbatim prefix of the article's lead section. Never rewritten. */
  summary: text('summary'),
  /** The article URL. This IS the attribution; it travels with the text. */
  url: text('url'),
  /** True when no article matches this item's name. Stops us re-asking. */
  missing: boolean('missing').notNull().default(false),
  fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Every background job run, recorded as it happens.
 *
 * Written by the worker rather than by the jobs themselves, so a job that
 * throws before its first statement is still recorded as having been
 * attempted. See drizzle/0006_job_runs.sql for why inferring this from the
 * tables the jobs write is not good enough.
 */
export const osrsJobRuns = pgTable(
  'osrs_job_runs',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    job: text('job').notNull(),
    startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    /** running | ok | failed | skipped */
    status: text('status').notNull().default('running'),
    /** The job's own return value, verbatim. */
    result: jsonb('result'),
    /** Message only, never a stack trace. */
    error: text('error'),
    durationMs: integer('duration_ms'),
    /** The image build that recorded this run. See 0007. */
    build: text('build'),
  },
  (t) => [index('osrs_job_runs_job_started_idx').on(t.job, t.startedAt.desc())]
);
