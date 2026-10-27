import { statfs } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db } from '@/database';

/**
 * Numbers for the admin overview.
 *
 * Everything here is an aggregate. There is deliberately no way to read an
 * individual person's tracked accounts, flip log or alerts from the admin
 * panel — running the service does not require reading what anyone is
 * trading, and not building the screen is a stronger guarantee than choosing
 * not to look at it.
 *
 * The data-freshness figures matter more than the user counts here: if the
 * price poller has quietly stopped, every margin on the site is wrong, and
 * this page is where that shows up.
 */

export type Counts = {
  users: number;
  usersWeek: number;
  accounts: number;
  snapshots: number;
  items: number;
  pricedItems: number;
  flips: number;
  openFlips: number;
  activeAlerts: number;
  /** Minutes since the price poller last wrote. The health number. */
  priceAgeMinutes: number | null;
  /** Minutes since any account's hiscores were fetched. */
  hiscoreAgeMinutes: number | null;
  historyRows: number;
};

export async function counts(): Promise<Counts> {
  const r = await db.execute(sql`
    select
      (select count(*) from users where deleted_at is null)::int as users,
      (select count(*) from users where deleted_at is null and created_at > now() - interval '7 days')::int as users_week,
      (select count(*) from osrs_accounts)::int as accounts,
      (select count(*) from osrs_snapshots)::int as snapshots,
      (select count(*) from osrs_items)::int as items,
      (select count(*) from osrs_prices where low is not null and high is not null)::int as priced_items,
      (select count(*) from osrs_flips)::int as flips,
      (select count(*) from osrs_flips where sold_at is null)::int as open_flips,
      (select count(*) from osrs_alerts where active)::int as active_alerts,
      (select count(*) from osrs_price_history)::int as history_rows,
      (select extract(epoch from (now() - max(fetched_at))) / 60 from osrs_prices)::float as price_age,
      (select extract(epoch from (now() - max(last_synced_at))) / 60 from osrs_accounts)::float as hiscore_age
  `);
  const row =
    ((r as { rows?: Record<string, unknown>[] }).rows ??
      (r as unknown as Record<string, unknown>[]))[0] ?? {};

  const minutes = (v: unknown): number | null => {
    if (v === null || v === undefined) return null;
    const n = Number(v);
    return Number.isFinite(n) ? Math.round(n) : null;
  };

  return {
    users: Number(row.users ?? 0),
    usersWeek: Number(row.users_week ?? 0),
    accounts: Number(row.accounts ?? 0),
    snapshots: Number(row.snapshots ?? 0),
    items: Number(row.items ?? 0),
    pricedItems: Number(row.priced_items ?? 0),
    flips: Number(row.flips ?? 0),
    openFlips: Number(row.open_flips ?? 0),
    activeAlerts: Number(row.active_alerts ?? 0),
    historyRows: Number(row.history_rows ?? 0),
    priceAgeMinutes: minutes(row.price_age),
    hiscoreAgeMinutes: minutes(row.hiscore_age),
  };
}

export type Storage = {
  dbBytes: number;
  historyBytes: number;
  diskTotal: number | null;
  diskFree: number | null;
};

export async function storage(): Promise<Storage> {
  const r = await db.execute(sql`
    select
      pg_database_size(current_database())::bigint as db_bytes,
      pg_total_relation_size('osrs_price_history')::bigint as history_bytes
  `);
  const row =
    ((r as { rows?: Record<string, unknown>[] }).rows ??
      (r as unknown as Record<string, unknown>[]))[0] ?? {};

  // Price history is the only table that grows without bound, so it is worth
  // watching separately from the database as a whole — it is what the
  // retention window exists to hold down.
  let diskTotal: number | null = null;
  let diskFree: number | null = null;
  try {
    const fs = await statfs('/');
    diskTotal = Number(fs.blocks) * Number(fs.bsize);
    diskFree = Number(fs.bavail) * Number(fs.bsize);
  } catch {
    /* not available in this environment */
  }

  return {
    dbBytes: Number(row.db_bytes ?? 0),
    historyBytes: Number(row.history_bytes ?? 0),
    diskTotal,
    diskFree,
  };
}

export type AdminUser = {
  id: string;
  email: string;
  name: string | null;
  isAdmin: boolean;
  createdAt: Date;
  trackedAccounts: number;
  flips: number;
};

export async function recentUsers(limit = 100): Promise<AdminUser[]> {
  const r = await db.execute(sql`
    select
      u.id, u.email, u.name, u.is_admin, u.created_at,
      (select count(*) from osrs_accounts a where a.user_id = u.id)::int as tracked_accounts,
      (select count(*) from osrs_flips f where f.user_id = u.id)::int as flips
    from users u
    where u.deleted_at is null
    order by u.created_at desc
    limit ${limit}
  `);
  const rows =
    (r as { rows?: Record<string, unknown>[] }).rows ?? (r as unknown as Record<string, unknown>[]);
  return rows.map((row) => ({
    id: String(row.id),
    email: String(row.email),
    name: row.name ? String(row.name) : null,
    isAdmin: row.is_admin === true,
    createdAt: new Date(String(row.created_at)),
    trackedAccounts: Number(row.tracked_accounts ?? 0),
    flips: Number(row.flips ?? 0),
  }));
}
