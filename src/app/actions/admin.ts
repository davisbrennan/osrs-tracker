'use server';

import { revalidatePath } from 'next/cache';
import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { requireAdmin } from '@/lib/admin';

const LEVELS = ['info', 'warn'];

export async function saveAppSettings(formData: FormData) {
  const admin = await requireAdmin();
  if (!admin) return { error: 'Not allowed.' };

  const banner =
    String(formData.get('banner') ?? '')
      .trim()
      .slice(0, 300) || null;
  const level = String(formData.get('bannerLevel') ?? 'info');
  const signupsOpen = formData.get('signupsOpen') === 'on';
  const maintenance = formData.get('maintenance') === 'on';

  await db.execute(sql`
    UPDATE app_settings
    SET signups_open = ${signupsOpen},
        banner = ${banner},
        banner_level = ${LEVELS.includes(level) ? level : 'info'},
        maintenance = ${maintenance},
        updated_at = now(),
        updated_by = ${admin.id}::uuid
    WHERE id = true
  `);

  revalidatePath('/admin/settings');
  revalidatePath('/dashboard');
  return { ok: 'Saved.' as const };
}
