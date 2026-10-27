'use server';

import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { appSettings } from '@/lib/app-settings';

/**
 * Checked before a magic link is sent.
 *
 * Closing sign-ups must not lock out people who already have an account — they
 * have a wedding in here. So this only refuses email addresses we've never
 * seen.
 */
export async function signupAllowed(
  emailRaw: string
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const email = String(emailRaw ?? '')
    .trim()
    .toLowerCase();
  if (!email) return { ok: false, reason: 'Enter an email address.' };

  const settings = await appSettings();
  if (settings.signupsOpen) return { ok: true };

  const r = await db.execute(sql`select 1 from users where lower(email) = ${email} limit 1`);
  const rows = (r as { rows?: unknown[] }).rows ?? (r as unknown as unknown[]);
  if (rows.length > 0) return { ok: true };

  return {
    ok: false,
    reason:
      'New sign-ups are paused at the moment. If you already have an account, use the address you signed up with.',
  };
}
