import { sql } from 'drizzle-orm';
import { db } from '@/database';

export type AppSettings = {
  signupsOpen: boolean;
  banner: string | null;
  bannerLevel: string;
  maintenance: boolean;
};

const FALLBACK: AppSettings = {
  signupsOpen: true,
  banner: null,
  bannerLevel: 'info',
  maintenance: false,
};

/**
 * Read once per request where it's needed. Deliberately fails open: if this
 * query breaks, people can still sign in. A settings table that can lock
 * everyone out when it misbehaves is worse than no settings table.
 */
export async function appSettings(): Promise<AppSettings> {
  try {
    const r = await db.execute(sql`
      select signups_open, banner, banner_level, maintenance from app_settings where id = true
    `);
    const row = ((r as { rows?: Record<string, unknown>[] }).rows ??
      (r as unknown as Record<string, unknown>[]))[0];
    if (!row) return FALLBACK;
    return {
      signupsOpen: row.signups_open !== false,
      banner: row.banner ? String(row.banner) : null,
      bannerLevel: String(row.banner_level ?? 'info'),
      maintenance: row.maintenance === true,
    };
  } catch {
    return FALLBACK;
  }
}
