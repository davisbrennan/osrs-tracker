/**
 * Filtering and sorting the item browser.
 *
 * Split out of the page because it is the part worth testing: a filter that
 * silently excludes the wrong rows is invisible until someone notices an
 * item missing, which they never will.
 *
 * WHY SOME FILTERS ARE NOT SQL
 *
 * Margin, ROI and profit-per-window are derived from the tax rule, which has
 * three special cases — a floor under 50gp, a 5,000,000 cap per item, and a
 * list of exempt items. Expressing that in SQL would mean a second
 * implementation of the rule that drifts from `geTax` the first time Jagex
 * changes anything. So the cheap, indexable filters (name, price, volume,
 * limit, members, freshness) run in SQL and cut the row count, and the
 * derived ones run here over what survives, through the same `evaluate` the
 * flip finder uses.
 *
 * Everything in this file is pure.
 */

import { evaluate, parseGp, type Opportunity } from '@/lib/osrs/ge';

export const SORTS = [
  'volume',
  'name',
  'price-asc',
  'price-desc',
  'margin',
  'roi',
  'window',
  'limit',
] as const;
export type SortKey = (typeof SORTS)[number];

export const SORT_LABELS: Record<SortKey, string> = {
  volume: 'Busiest',
  name: 'A–Z',
  'price-asc': 'Cheapest',
  'price-desc': 'Dearest',
  margin: 'Margin',
  roi: 'Return %',
  window: 'Profit / window',
  limit: 'Buy limit',
};

export type MembersFilter = 'any' | 'members' | 'f2p';

/** Freshness choices, in minutes. Null is "any". */
export const FRESHNESS = [
  { value: '', label: 'Any age', minutes: null },
  { value: '30', label: 'Last 30 min', minutes: 30 },
  { value: '60', label: 'Last hour', minutes: 60 },
  { value: '360', label: 'Last 6 hours', minutes: 360 },
  { value: '1440', label: 'Last day', minutes: 1440 },
] as const;

export type ItemFilters = {
  q: string;
  minPrice: number | null;
  maxPrice: number | null;
  minVolume: number | null;
  members: MembersFilter;
  minLimit: number | null;
  maxLimit: number | null;
  freshWithinMin: number | null;
  minMargin: number | null;
  minRoi: number | null;
  minWindow: number | null;
  affordable: boolean;
  alchable: boolean;
  sort: SortKey;
  page: number;
};

export type RawParams = Record<string, string | string[] | undefined>;

const one = (v: string | string[] | undefined): string =>
  (Array.isArray(v) ? v[0] : (v ?? '')).trim();

/** A gp amount, accepting 1.5m / 250k / 1500000. Rejects negatives. */
function gpParam(raw: string): number | null {
  if (!raw) return null;
  const n = parseGp(raw);
  return n === null || n < 0 ? null : n;
}

/** A plain count. Rejects negatives and nonsense. */
function intParam(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[, _]/g, ''));
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : null;
}

/** A percentage, which may legitimately be negative. */
function pctParam(raw: string): number | null {
  if (!raw) return null;
  const n = Number(raw.replace(/[%\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

export function parseFilters(sp: RawParams): ItemFilters {
  const sortRaw = one(sp.sort) as SortKey;
  const membersRaw = one(sp.members);

  return {
    q: one(sp.q),
    minPrice: gpParam(one(sp.minPrice)),
    maxPrice: gpParam(one(sp.maxPrice)),
    minVolume: intParam(one(sp.minVolume)),
    members: membersRaw === 'members' || membersRaw === 'f2p' ? membersRaw : 'any',
    minLimit: intParam(one(sp.minLimit)),
    maxLimit: intParam(one(sp.maxLimit)),
    freshWithinMin: intParam(one(sp.fresh)),
    minMargin: gpParam(one(sp.minMargin)),
    minRoi: pctParam(one(sp.minRoi)),
    minWindow: gpParam(one(sp.minWindow)),
    affordable: one(sp.affordable) === '1',
    alchable: one(sp.alchable) === '1',
    sort: (SORTS as readonly string[]).includes(sortRaw) ? sortRaw : 'volume',
    page: Math.max(1, intParam(one(sp.page)) ?? 1),
  };
}

/** Which filter keys are set, for the "clear this one" chips. */
export type FilterChip = { key: keyof ItemFilters | 'q'; label: string; param: string };

export function activeChips(f: ItemFilters, formatGp: (n: number) => string): FilterChip[] {
  const chips: FilterChip[] = [];
  const add = (param: string, label: string) =>
    chips.push({ key: param as keyof ItemFilters, label, param });

  if (f.q) add('q', `name: “${f.q}”`);
  if (f.minPrice !== null) add('minPrice', `≥ ${formatGp(f.minPrice)}`);
  if (f.maxPrice !== null) add('maxPrice', `≤ ${formatGp(f.maxPrice)}`);
  if (f.minVolume !== null) add('minVolume', `≥ ${f.minVolume.toLocaleString('en-US')} traded/h`);
  if (f.members === 'members') add('members', 'members only');
  if (f.members === 'f2p') add('members', 'free-to-play only');
  if (f.minLimit !== null) add('minLimit', `limit ≥ ${f.minLimit.toLocaleString('en-US')}`);
  if (f.maxLimit !== null) add('maxLimit', `limit ≤ ${f.maxLimit.toLocaleString('en-US')}`);
  if (f.freshWithinMin !== null) {
    const match = FRESHNESS.find((x) => x.minutes === f.freshWithinMin);
    add('fresh', match ? match.label.toLowerCase() : `traded within ${f.freshWithinMin}m`);
  }
  if (f.minMargin !== null) add('minMargin', `margin ≥ ${formatGp(f.minMargin)}`);
  if (f.minRoi !== null) add('minRoi', `return ≥ ${f.minRoi}%`);
  if (f.minWindow !== null) add('minWindow', `window ≥ ${formatGp(f.minWindow)}`);
  if (f.affordable) add('affordable', 'within my cash');
  if (f.alchable) add('alchable', 'alchable at a profit');

  return chips;
}

export type ItemRow = {
  id: number;
  name: string;
  members: boolean;
  buyLimit: number | null;
  highalch: number | null;
  low: number | null;
  high: number | null;
  lowTime: Date | null;
  highTime: Date | null;
  hourlyVolume: number | null;
};

export type ScoredItem = {
  row: ItemRow;
  opportunity: Opportunity;
  /** Profit from alching one, net of the nature rune. Null when unknowable. */
  alchProfit: number | null;
};

/**
 * Attach the derived economics to each row.
 *
 * Rows without both sides of the book are dropped: a margin needs a buy
 * price and a sell price, and inventing either is how a browser ends up
 * recommending something that cannot be traded.
 */
export function scoreItems(
  rows: ItemRow[],
  cashStack: number,
  natureRunePrice: number | null,
  now = Date.now()
): ScoredItem[] {
  const out: ScoredItem[] = [];
  for (const row of rows) {
    if (row.low === null || row.high === null) continue;
    const opportunity = evaluate(
      {
        itemId: row.id,
        name: row.name,
        low: row.low,
        high: row.high,
        lowTime: row.lowTime ? Math.floor(row.lowTime.getTime() / 1000) : null,
        highTime: row.highTime ? Math.floor(row.highTime.getTime() / 1000) : null,
        buyLimit: row.buyLimit,
        hourlyVolume: row.hourlyVolume ?? 0,
      },
      cashStack,
      now
    );
    const alchProfit =
      row.highalch && row.highalch > 0 && natureRunePrice !== null
        ? row.highalch - natureRunePrice - row.low
        : null;
    out.push({ row, opportunity, alchProfit });
  }
  return out;
}

/** The filters that need the derived economics. */
export function applyDerivedFilters(
  scored: ScoredItem[],
  f: ItemFilters,
  cashStack: number
): ScoredItem[] {
  return scored.filter((s) => {
    if (f.minMargin !== null && s.opportunity.marginPerUnit < f.minMargin) return false;
    if (f.minRoi !== null && s.opportunity.roiPercent < f.minRoi) return false;
    if (f.minWindow !== null && s.opportunity.profitPerWindow < f.minWindow) return false;
    // "Within my cash" means one unit, not a full window — a 50m item is out
    // of reach on a 10m stack however good the margin looks.
    if (f.affordable && s.opportunity.buyPrice > cashStack) return false;
    if (f.alchable && (s.alchProfit === null || s.alchProfit <= 0)) return false;
    return true;
  });
}

export function sortItems(scored: ScoredItem[], sort: SortKey): ScoredItem[] {
  const by = <T>(pick: (s: ScoredItem) => T, dir: 1 | -1 = 1) =>
    [...scored].sort((a, b) => {
      const x = pick(a);
      const y = pick(b);
      if (x === y) return a.row.name.localeCompare(b.row.name);
      return (x < y ? -1 : 1) * dir;
    });

  switch (sort) {
    case 'name':
      return by((s) => s.row.name.toLowerCase());
    case 'price-asc':
      return by((s) => s.opportunity.buyPrice);
    case 'price-desc':
      return by((s) => s.opportunity.buyPrice, -1);
    case 'margin':
      return by((s) => s.opportunity.marginPerUnit, -1);
    case 'roi':
      return by((s) => s.opportunity.roiPercent, -1);
    case 'window':
      return by((s) => s.opportunity.profitPerWindow, -1);
    case 'limit':
      return by((s) => s.row.buyLimit ?? -1, -1);
    case 'volume':
    default:
      return by((s) => s.opportunity.hourlyVolume, -1);
  }
}

/** True when nothing narrows the list — used to keep the default view quiet. */
export function hasActiveFilters(f: ItemFilters): boolean {
  return (
    f.q !== '' ||
    f.minPrice !== null ||
    f.maxPrice !== null ||
    f.minVolume !== null ||
    f.members !== 'any' ||
    f.minLimit !== null ||
    f.maxLimit !== null ||
    f.freshWithinMin !== null ||
    f.minMargin !== null ||
    f.minRoi !== null ||
    f.minWindow !== null ||
    f.affordable ||
    f.alchable
  );
}
