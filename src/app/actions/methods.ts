'use server';

import { eq, inArray, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { METHODS, methodItemNames } from '@/lib/osrs/method-data';
import { buildNameIndex, resolveMethods, nameVariants } from '@/lib/osrs/method-resolve';
import type { ResolvedMethod, PricedItem } from '@/lib/osrs/methods';

export type MethodCatalogue = {
  methods: ResolvedMethod[];
  priced: Map<number, PricedItem>;
  /** Methods that could not be resolved, so the page can say so plainly. */
  failed: { methodId: string; missing: string[] }[];
};

/**
 * The method catalogue, joined to the item table and today's prices.
 *
 * Looked up by name rather than by hardcoded ids. The SQL asks for every
 * spelling variant the dataset might mean — the only inconsistency that
 * actually occurs in OSRS item names is whether there is a space before a
 * parenthesised suffix — so the match is an indexed equality rather than a
 * LIKE scan over four thousand rows.
 */
export async function loadMethodCatalogue(): Promise<MethodCatalogue> {
  // Lower-cased, because the comparison below is on lower(name). The
  // resolver always intended to match case-insensitively — buildNameIndex
  // lower-cases its keys — but the query that feeds it used plain equality,
  // so a name differing only in capitalisation returned no row and the
  // normalisation never ran. See drizzle/0008.
  const wanted = methodItemNames()
    .flatMap(nameVariants)
    .map((n) => n.toLowerCase());

  const rows = await db
    .select({
      id: osrsItems.id,
      name: osrsItems.name,
      buyLimit: osrsItems.buyLimit,
      low: osrsPrices.low,
      high: osrsPrices.high,
    })
    .from(osrsItems)
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
    .where(inArray(sql`lower(${osrsItems.name})`, wanted));

  const index = buildNameIndex(rows);
  const { resolved, failed } = resolveMethods(METHODS, index);

  const priced = new Map<number, PricedItem>();
  for (const r of rows) {
    priced.set(r.id, {
      itemId: r.id,
      buy: r.low,
      sell: r.high,
      buyLimit: r.buyLimit,
    });
  }

  return { methods: resolved, priced, failed };
}
