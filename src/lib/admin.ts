import { headers } from 'next/headers';
import { currentUser } from '@/lib/session';

/**
 * Who can see the admin panel.
 *
 * Admins are named in ADMIN_EMAILS rather than flagged in the database, on
 * purpose: a row in a table can be changed by anything with database access,
 * including a bug in this app. An environment variable can only be changed by
 * someone who can already reach the server, which is the same person who could
 * read the database directly anyway. It also means there's no "make admin"
 * code path to get wrong.
 *
 * Empty or unset means nobody is an admin, not everybody.
 */
export function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export async function requireAdmin() {
  const user = await currentUser();
  if (!user) return null;

  const allowed = adminEmails();
  if (allowed.length === 0) return null;
  if (!allowed.includes(user.email.toLowerCase())) return null;

  return user;
}

/** Formats bytes the way a person reads them. */
export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(units.length - 1, Math.floor(Math.log(n) / Math.log(1024)));
  const v = n / 1024 ** i;
  return `${v >= 10 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

/** Best-effort client IP, for the audit line on settings changes. */
export async function requestIp(): Promise<string | null> {
  const h = await headers();
  const fwd = h.get('x-forwarded-for');
  return fwd ? fwd.split(',')[0].trim() : null;
}
