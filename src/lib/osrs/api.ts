/**
 * Talking to the two external APIs.
 *
 * Both are free, unauthenticated, and run by volunteers. The wiki asks that
 * consumers identify themselves so they can get in touch if a client
 * misbehaves rather than silently blocking it — so every request carries a
 * descriptive User-Agent with a contact address. Set OSRS_CONTACT in the
 * environment; the default is deliberately useless so a missing value is
 * noticed in a log rather than quietly anonymising us.
 *
 * Nothing here writes to the database. These functions fetch and parse; the
 * worker decides what to store. That split keeps them testable against
 * fixtures without a database.
 */

import { parseHiscores, rsnToQuery, type Hiscores } from '@/lib/osrs/skills';
import { parseHiscoresJson, type Activity } from '@/lib/osrs/hiscores-json';
import { buildExtractsUrl, parseExtracts, type WikiEntry } from '@/lib/osrs/wiki';

const PRICES_BASE = 'https://prices.runescape.wiki/api/v1/osrs';
// Without an extension; `.json` and `.ws` are appended per endpoint.
const HISCORES_URL = 'https://secure.runescape.com/m=hiscore_oldschool/index_lite';

function userAgent(): string {
  const contact = process.env.OSRS_CONTACT ?? 'contact-not-configured';
  return `rspill-osrs-tracker/0.1 (hobby project; ${contact})`;
}

export class FetchError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly retryable: boolean
  ) {
    super(message);
    this.name = 'FetchError';
  }
}

/**
 * One request, with a timeout and a clear verdict on whether retrying helps.
 *
 * A 404 from the hiscores means the account does not exist, which no amount
 * of retrying will fix; a 429 or a 5xx is worth backing off on. Getting that
 * distinction right is what stops the poller spinning on a typo'd RSN.
 */
async function request(url: string, timeoutMs = 15_000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': userAgent(), Accept: 'application/json' },
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!res.ok) {
      const retryable = res.status === 429 || res.status >= 500;
      throw new FetchError(`${url} returned ${res.status}`, res.status, retryable);
    }
    return res;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    const aborted = err instanceof Error && err.name === 'AbortError';
    throw new FetchError(
      aborted ? `${url} timed out after ${timeoutMs}ms` : `${url} failed: ${String(err)}`,
      null,
      true
    );
  } finally {
    clearTimeout(timer);
  }
}

// ----------------------------------------------------------------- mapping

export type ItemMapping = {
  id: number;
  name: string;
  examine: string | null;
  members: boolean;
  buyLimit: number | null;
  value: number | null;
  highalch: number | null;
  lowalch: number | null;
  icon: string | null;
};

/**
 * The item catalogue. Changes only when Jagex adds items, so the worker
 * refreshes it daily rather than every poll.
 */
export async function fetchMapping(): Promise<ItemMapping[]> {
  const res = await request(`${PRICES_BASE}/mapping`);
  const raw = await res.json();
  if (!Array.isArray(raw)) {
    throw new FetchError('The mapping endpoint did not return an array.', null, false);
  }
  const items: ItemMapping[] = [];
  for (const r of raw) {
    // Same trap as numOrNull: Number(null) is 0, which would turn a malformed
    // row into a real-looking item with id 0.
    const id = numOrNull(r?.id);
    const name = typeof r?.name === 'string' ? r.name.trim() : '';
    if (id === null || !Number.isInteger(id) || !name) continue;
    items.push({
      id,
      name,
      examine: typeof r.examine === 'string' ? r.examine : null,
      members: r.members === true,
      buyLimit: Number.isFinite(Number(r.limit)) ? Number(r.limit) : null,
      value: Number.isFinite(Number(r.value)) ? Number(r.value) : null,
      highalch: Number.isFinite(Number(r.highalch)) ? Number(r.highalch) : null,
      lowalch: Number.isFinite(Number(r.lowalch)) ? Number(r.lowalch) : null,
      icon: typeof r.icon === 'string' ? r.icon : null,
    });
  }
  return items;
}

// ------------------------------------------------------------------ prices

export type LatestPrice = {
  itemId: number;
  high: number | null;
  highTime: number | null;
  low: number | null;
  lowTime: number | null;
};

/**
 * Current prices for everything.
 *
 * The shape is { data: { "<itemId>": { high, highTime, low, lowTime } } }.
 * Items that have never traded appear with nulls, which is meaningful and is
 * preserved rather than coerced to zero — a null price is "unknown", a zero
 * would be a lie.
 */
export async function fetchLatest(): Promise<LatestPrice[]> {
  const res = await request(`${PRICES_BASE}/latest`);
  const body = await res.json();
  const data = body?.data;
  if (!data || typeof data !== 'object') {
    throw new FetchError('The latest endpoint had no data object.', null, false);
  }
  const out: LatestPrice[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const itemId = numOrNull(key);
    if (itemId === null || !Number.isInteger(itemId)) continue;
    const v = value as Record<string, unknown>;
    out.push({
      itemId,
      high: numOrNull(v.high),
      highTime: numOrNull(v.highTime),
      low: numOrNull(v.low),
      lowTime: numOrNull(v.lowTime),
    });
  }
  return out;
}

export type VolumeRow = {
  itemId: number;
  avgHigh: number | null;
  avgLow: number | null;
  highVolume: number;
  lowVolume: number;
};

/**
 * Hourly averages and, crucially, volumes.
 *
 * Volume is what separates a real margin from a trap, so this is fetched
 * alongside /latest rather than treated as optional.
 */
export async function fetchHourly(): Promise<VolumeRow[]> {
  const res = await request(`${PRICES_BASE}/1h`);
  const body = await res.json();
  const data = body?.data;
  if (!data || typeof data !== 'object') {
    throw new FetchError('The 1h endpoint had no data object.', null, false);
  }
  const out: VolumeRow[] = [];
  for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
    const itemId = numOrNull(key);
    if (itemId === null || !Number.isInteger(itemId)) continue;
    const v = value as Record<string, unknown>;
    out.push({
      itemId,
      avgHigh: numOrNull(v.avgHighPrice),
      avgLow: numOrNull(v.avgLowPrice),
      highVolume: numOrNull(v.highPriceVolume) ?? 0,
      lowVolume: numOrNull(v.lowPriceVolume) ?? 0,
    });
  }
  return out;
}

export type TimeseriesPoint = {
  timestamp: number;
  avgHigh: number | null;
  avgLow: number | null;
  highVolume: number;
  lowVolume: number;
};

export type Timestep = '5m' | '1h' | '6h' | '24h';

/** History for one item, for drawing a chart. */
export async function fetchTimeseries(
  itemId: number,
  timestep: Timestep = '1h'
): Promise<TimeseriesPoint[]> {
  const res = await request(`${PRICES_BASE}/timeseries?timestep=${timestep}&id=${itemId}`);
  const body = await res.json();
  const data = body?.data;
  if (!Array.isArray(data)) {
    throw new FetchError('The timeseries endpoint did not return an array.', null, false);
  }
  return data
    .map((p: Record<string, unknown>) => ({
      timestamp: numOrNull(p.timestamp) ?? 0,
      avgHigh: numOrNull(p.avgHighPrice),
      avgLow: numOrNull(p.avgLowPrice),
      highVolume: numOrNull(p.highPriceVolume) ?? 0,
      lowVolume: numOrNull(p.lowPriceVolume) ?? 0,
    }))
    .filter((p) => p.timestamp > 0);
}

// ---------------------------------------------------------------- hiscores

export type HiscoreData = {
  skills: Hiscores['skills'];
  /** Named rows — bosses, clues and minigames. Empty from the CSV fallback. */
  activities: Activity[];
  warnings: string[];
  /** Which endpoint answered. Worth logging while the JSON one is new. */
  source: 'json' | 'csv';
};

export type HiscoreResult =
  { found: true; hiscores: HiscoreData } | { found: false; reason: 'not-on-hiscores' };

/**
 * Look up an account.
 *
 * A 404 means the name is not on the hiscores — which for a low-level account
 * is normal rather than an error, since Jagex only ranks players above a
 * threshold. That is reported as a result, not thrown, because the caller
 * should tell the player "not ranked yet" rather than "something broke".
 */
export async function fetchHiscores(rsn: string): Promise<HiscoreResult> {
  const player = rsnToQuery(rsn);

  // JSON first. Its rows are keyed by name, so a new skill or boss adds a
  // row instead of shifting every value after it — which is the failure the
  // positional CSV has and cannot detect reliably.
  try {
    const res = await request(`${HISCORES_URL}.json?player=${player}`);
    const parsed = parseHiscoresJson(await res.json());
    return {
      found: true,
      hiscores: {
        skills: parsed.skills,
        activities: parsed.activities,
        warnings: parsed.warnings,
        source: 'json',
      },
    };
  } catch (err) {
    if (err instanceof FetchError && err.status === 404) {
      return { found: false, reason: 'not-on-hiscores' };
    }
    // Anything else — the endpoint is gone, the shape changed, a timeout —
    // falls through to the CSV, which is older and less safe but has been
    // stable for a decade.
    console.warn(
      `[osrs] hiscores JSON failed for ${rsn}, falling back to CSV:`,
      err instanceof Error ? err.message : String(err)
    );
  }

  try {
    const res = await request(`${HISCORES_URL}.ws?player=${player}`);
    const csv = await res.text();
    const parsed = parseHiscores(csv);
    return {
      found: true,
      hiscores: {
        skills: parsed.skills,
        activities: [],
        warnings: [
          ...parsed.warnings,
          'Read from the positional CSV because the JSON endpoint failed. Bosses and clues are unavailable from this path.',
        ],
        source: 'csv',
      },
    };
  } catch (err) {
    if (err instanceof FetchError && err.status === 404) {
      return { found: false, reason: 'not-on-hiscores' };
    }
    throw err;
  }
}

/**
 * A number, or null when the API genuinely has no value.
 *
 * Written the long way on purpose: Number(null) is 0 and Number('') is 0, so
 * the obvious Number.isFinite(Number(v)) check silently turns "this item has
 * never traded" into "this item is worth 0 gp". That then reads as an
 * infinite-margin opportunity in the flip finder — a plausible-looking number
 * that would lose real money.
 */
function numOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/* ------------------------------------------------------------------------
   The wiki's MediaWiki API, for item descriptions.

   A different host and a different licence from the prices API — see the
   header of lib/osrs/wiki.ts before using anything this returns.
   ------------------------------------------------------------------------ */

/**
 * Lead-section summaries for a batch of article titles.
 *
 * Titles the wiki has no article for come back as null rather than missing
 * from the map, so the caller can tell "no article" apart from "not asked".
 */
export async function fetchWikiSummaries(
  titles: string[]
): Promise<Map<string, WikiEntry | null>> {
  if (titles.length === 0) return new Map();
  const res = await request(buildExtractsUrl(titles));
  const payload: unknown = await res.json();
  return parseExtracts(payload, titles);
}
