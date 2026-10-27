/**
 * Turning method definitions into something the engine can price.
 *
 * The catalogue references items by name. Names in the dataset were written
 * by hand, and the authority on what an item is actually called is
 * osrs_items, which comes from the wiki's mapping endpoint. So the join
 * happens here, and anything that fails to join is reported rather than
 * silently dropped — a method missing one input would otherwise quietly
 * price as pure profit, which is the worst possible failure for this feature.
 *
 * Matching is case-insensitive and tolerant of the one inconsistency that
 * actually occurs in OSRS item names: whether there is a space before a
 * parenthesised suffix. "Ranarr potion(unf)" and "Ranarr potion (unf)" are
 * the same item to a human and should be here too.
 *
 * Pure. The database lookup happens in the caller.
 */

import type { MethodDefinition } from '@/lib/osrs/method-data';
import type { ResolvedMethod, MethodItem } from '@/lib/osrs/methods';

export type CatalogueRow = { id: number; name: string };

/** Lower-cased, with any space before a parenthesis removed. */
export function normaliseItemName(name: string): string {
  return name.toLowerCase().replace(/\s+\(/g, '(').trim();
}

/**
 * Every spelling of a name worth asking the database for.
 *
 * OSRS item names are inconsistent about a space before a parenthesised
 * suffix, and the dataset was written by hand. Asking for both forms keeps
 * the lookup an indexed equality instead of a LIKE scan over the catalogue.
 */
export function nameVariants(name: string): string[] {
  const trimmed = name.trim();
  const tight = trimmed.replace(/\s+\(/g, '(');
  const spaced = trimmed.replace(/\s*\(/g, ' (');
  return [...new Set([trimmed, tight, spaced])];
}

export function buildNameIndex(rows: CatalogueRow[]): Map<string, CatalogueRow> {
  const index = new Map<string, CatalogueRow>();
  for (const row of rows) {
    const key = normaliseItemName(row.name);
    // First writer wins: the catalogue can hold near-duplicates and the
    // earlier id is the canonical item in every case that matters here.
    if (!index.has(key)) index.set(key, row);
  }
  return index;
}

export type ResolveReport = {
  resolved: ResolvedMethod[];
  /** Methods dropped because an item name matched nothing, with the names. */
  failed: { methodId: string; missing: string[] }[];
};

export function resolveMethods(
  definitions: MethodDefinition[],
  index: Map<string, CatalogueRow>
): ResolveReport {
  const resolved: ResolvedMethod[] = [];
  const failed: { methodId: string; missing: string[] }[] = [];

  for (const def of definitions) {
    const missing: string[] = [];

    const lookup = (name: string, quantity: number): MethodItem | null => {
      const row = index.get(normaliseItemName(name));
      if (!row) {
        missing.push(name);
        return null;
      }
      return { itemId: row.id, name: row.name, quantity };
    };

    const inputs = def.inputs.map((i) => lookup(i.name, i.quantity));
    const outputs = def.outputs.map((o) => lookup(o.name, o.quantity));

    if (missing.length > 0) {
      // Dropped, not partially priced. A method short one input would look
      // more profitable than it is, and would rank at the top for it.
      failed.push({ methodId: def.id, missing });
      continue;
    }

    resolved.push({
      id: def.id,
      name: def.name,
      category: def.category,
      skill: def.skill,
      level: def.level,
      actionsPerHour: def.actionsPerHour,
      coinCost: def.coinCost ?? 0,
      members: def.members,
      quest: def.quest ?? null,
      note: def.note ?? null,
      sourceUrl: def.sourceUrl,
      inputs: inputs as MethodItem[],
      outputs: outputs as MethodItem[],
    });
  }

  return { resolved, failed };
}
