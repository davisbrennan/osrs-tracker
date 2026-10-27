/**
 * Refresh the item catalogue from the wiki's /mapping endpoint.
 *
 * Runs daily rather than every poll: the catalogue only changes when Jagex
 * adds items. It matters more than it sounds, because every other OSRS table
 * has a foreign key onto osrs_items — prices for an item we have never heard
 * of cannot be stored at all, so a stale catalogue silently drops new items
 * out of the flip finder.
 */

import { sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems } from '@/database/schema';
import { fetchMapping } from '@/lib/osrs/api';
import { chunk, type JobResult } from '@/lib/osrs/jobs/util';

export async function syncItems(): Promise<JobResult> {
  const items = await fetchMapping();
  if (items.length === 0) {
    // An empty array is a successful request with a nonsense answer. Writing
    // it would be harmless (upserts only add), but it means something is
    // wrong upstream and is worth seeing in the log.
    return { fetched: 0, written: 0, warning: 'mapping returned no items' };
  }

  let written = 0;
  for (const batch of chunk(items, 500)) {
    await db
      .insert(osrsItems)
      .values(
        batch.map((i) => ({
          id: i.id,
          name: i.name,
          examine: i.examine,
          members: i.members,
          buyLimit: i.buyLimit,
          value: i.value,
          highalch: i.highalch,
          lowalch: i.lowalch,
          icon: i.icon,
          updatedAt: new Date(),
        }))
      )
      // Jagex renames and rebalances items, so an existing row is updated
      // rather than left alone. The id never changes, which is why it is the
      // natural key.
      .onConflictDoUpdate({
        target: osrsItems.id,
        set: {
          name: sql`excluded.name`,
          examine: sql`excluded.examine`,
          members: sql`excluded.members`,
          buyLimit: sql`excluded.buy_limit`,
          value: sql`excluded.value`,
          highalch: sql`excluded.highalch`,
          lowalch: sql`excluded.lowalch`,
          icon: sql`excluded.icon`,
          updatedAt: sql`excluded.updated_at`,
        },
      });
    written += batch.length;
  }

  return { fetched: items.length, written };
}
