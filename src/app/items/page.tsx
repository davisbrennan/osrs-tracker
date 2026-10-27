import Link from 'next/link';
import type { Metadata } from 'next';
import { eq, and, isNotNull, gte, lte, sql, type SQL } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { formatGp } from '@/lib/osrs/ge';
import { currentUser, cashStackFor } from '@/lib/session';
import { gpClass, gpExact, plClass, ago } from '@/lib/gp';
import { priceAge, exactStamp } from '@/lib/osrs/freshness';
import {
  parseFilters,
  scoreItems,
  applyDerivedFilters,
  sortItems,
  activeChips,
  hasActiveFilters,
  SORTS,
  SORT_LABELS,
  FRESHNESS,
  type RawParams,
} from '@/lib/osrs/item-filters';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  alternates: { canonical: '/items' },
  title: 'Items',
  description:
    'Every tradeable Old School RuneScape item with its current Grand Exchange price, margin after tax, buy limit and hourly trade volume — filterable by price, volume, margin, return and more.',
};

const PAGE_SIZE = 100;

/** Alching consumes one of these per cast. */
const NATURE_RUNE_ID = 561;

export default async function Items({ searchParams }: { searchParams: Promise<RawParams> }) {
  const sp = await searchParams;
  const f = parseFilters(sp);

  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);

  /* ---------------------------------------------------------------- the query
     Only the filters an index can serve go in SQL. The derived ones — margin,
     return, profit per window — are computed from `geTax` afterwards, because
     reimplementing the tax rule in SQL would mean two copies of it. */
  const conditions: SQL[] = [isNotNull(osrsPrices.low), isNotNull(osrsPrices.high)];

  if (f.q) conditions.push(sql`${osrsItems.name} ILIKE ${'%' + f.q + '%'}`);
  if (f.minPrice !== null) conditions.push(gte(osrsPrices.low, f.minPrice));
  if (f.maxPrice !== null) conditions.push(lte(osrsPrices.low, f.maxPrice));
  if (f.minVolume !== null) conditions.push(gte(osrsPrices.hourlyVolume, f.minVolume));
  if (f.members === 'members') conditions.push(eq(osrsItems.members, true));
  if (f.members === 'f2p') conditions.push(eq(osrsItems.members, false));
  if (f.minLimit !== null) conditions.push(gte(osrsItems.buyLimit, f.minLimit));
  if (f.maxLimit !== null) conditions.push(lte(osrsItems.buyLimit, f.maxLimit));
  if (f.freshWithinMin !== null) {
    const cutoff = new Date(Date.now() - f.freshWithinMin * 60_000);
    conditions.push(gte(osrsPrices.lowTime, cutoff));
  }

  const [rows, natureRows] = await Promise.all([
    db
      .select({
        id: osrsItems.id,
        name: osrsItems.name,
        members: osrsItems.members,
        buyLimit: osrsItems.buyLimit,
        highalch: osrsItems.highalch,
        low: osrsPrices.low,
        high: osrsPrices.high,
        lowTime: osrsPrices.lowTime,
        highTime: osrsPrices.highTime,
        hourlyVolume: osrsPrices.hourlyVolume,
      })
      .from(osrsItems)
      .innerJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
      .where(and(...conditions)),
    db
      .select({ high: osrsPrices.high })
      .from(osrsPrices)
      .where(eq(osrsPrices.itemId, NATURE_RUNE_ID))
      .limit(1),
  ]);

  const now = Date.now();
  const naturePrice = natureRows[0]?.high ?? null;
  const scored = scoreItems(rows, cashStack, naturePrice, now);
  const matching = applyDerivedFilters(scored, f, cashStack);
  const sorted = sortItems(matching, f.sort);

  const totalPages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(f.page, totalPages);
  const visible = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const chips = activeChips(f, formatGp);
  const filtered = hasActiveFilters(f);

  /** Rebuild the URL with some params changed; undefined removes one. */
  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      q: f.q || undefined,
      minPrice: sp.minPrice as string | undefined,
      maxPrice: sp.maxPrice as string | undefined,
      minVolume: sp.minVolume as string | undefined,
      members: f.members === 'any' ? undefined : f.members,
      minLimit: sp.minLimit as string | undefined,
      maxLimit: sp.maxLimit as string | undefined,
      fresh: f.freshWithinMin === null ? undefined : String(f.freshWithinMin),
      minMargin: sp.minMargin as string | undefined,
      minRoi: sp.minRoi as string | undefined,
      minWindow: sp.minWindow as string | undefined,
      affordable: f.affordable ? '1' : undefined,
      alchable: f.alchable ? '1' : undefined,
      sort: f.sort === 'volume' ? undefined : f.sort,
      page: page > 1 ? String(page) : undefined,
    };
    for (const [k, v] of Object.entries({ ...base, ...patch })) if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/items?${qs}` : '/items';
  };

  const str = (k: string) => (typeof sp[k] === 'string' ? (sp[k] as string) : '');

  return (
    <AppShell current="items" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>Items</h1>
      <p className="lede">
        Everything with a current Grand Exchange price on both sides, busiest first. Margins are
        after the 2% sale tax, and profit per window is capped by the buy limit and by your{' '}
        {formatGp(cashStack)}.
      </p>

      {/* ------------------------------------------------------------ filters
          One GET form, so every state of this page is a URL you can bookmark,
          share or hit refresh on. The panel is open when something is set, so
          a filtered view never looks like an empty catalogue. */}
      <form className="filters" action="/items" method="get">
        <div className="filter-top">
          <input
            type="search"
            name="q"
            defaultValue={f.q}
            placeholder="Find an item"
            aria-label="Find an item by name"
          />
          <button type="submit">Apply</button>
          {filtered && (
            <Link href="/items" className="filter-clear">
              Clear all
            </Link>
          )}
        </div>

        <details className="filter-more" open={filtered}>
          <summary>
            More filters
            {chips.length > 0 && <span className="filter-count">{chips.length}</span>}
          </summary>

          <div className="filter-grid">
            <fieldset>
              <legend>Price</legend>
              <label>
                <span>From</span>
                <input name="minPrice" defaultValue={str('minPrice')} placeholder="any" />
              </label>
              <label>
                <span>To</span>
                <input name="maxPrice" defaultValue={str('maxPrice')} placeholder="any" />
              </label>
              <p className="filter-hint">1.5m, 250k and 1500000 all work.</p>
            </fieldset>

            <fieldset>
              <legend>Liquidity</legend>
              <label>
                <span>Traded per hour, at least</span>
                <input name="minVolume" defaultValue={str('minVolume')} placeholder="any" />
              </label>
              <label>
                <span>Last traded</span>
                <select name="fresh" defaultValue={str('fresh')}>
                  {FRESHNESS.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>

            <fieldset>
              <legend>Worth trading</legend>
              <label>
                <span>Margin after tax, at least</span>
                <input name="minMargin" defaultValue={str('minMargin')} placeholder="any" />
              </label>
              <label>
                <span>Return %, at least</span>
                <input name="minRoi" defaultValue={str('minRoi')} placeholder="any" />
              </label>
              <label>
                <span>Profit per window, at least</span>
                <input name="minWindow" defaultValue={str('minWindow')} placeholder="any" />
              </label>
            </fieldset>

            <fieldset>
              <legend>The item</legend>
              <label>
                <span>Membership</span>
                <select name="members" defaultValue={f.members}>
                  <option value="any">Any</option>
                  <option value="members">Members only</option>
                  <option value="f2p">Free-to-play only</option>
                </select>
              </label>
              <label>
                <span>Buy limit from</span>
                <input name="minLimit" defaultValue={str('minLimit')} placeholder="any" />
              </label>
              <label>
                <span>Buy limit to</span>
                <input name="maxLimit" defaultValue={str('maxLimit')} placeholder="any" />
              </label>
            </fieldset>

            <fieldset className="filter-checks">
              <legend>Only show</legend>
              <label className="filter-check">
                <input
                  type="checkbox"
                  name="affordable"
                  value="1"
                  defaultChecked={f.affordable}
                />
                <span>
                  What I can afford <span className="subtle">one unit, on {formatGp(cashStack)}</span>
                </span>
              </label>
              <label className="filter-check">
                <input type="checkbox" name="alchable" value="1" defaultChecked={f.alchable} />
                <span>
                  Alchable at a profit{' '}
                  <span className="subtle">high alch beats the buy price, after a nature rune</span>
                </span>
              </label>
            </fieldset>
          </div>

          <div className="filter-actions">
            <button type="submit">Apply filters</button>
            {filtered && <Link href="/items">Clear all</Link>}
          </div>
        </details>
      </form>

      {/* Without a nature rune price there is no alch profit to compute, so
          this filter would quietly match nothing. Say why rather than let it
          look like no item in the game is worth alching. */}
      {f.alchable && naturePrice === null && (
        <p className="book-warn">
          <strong>No current price for nature runes.</strong> Alch profit is what the high alch
          value clears after the rune it costs, so without that price there is nothing to compare
          against and this filter cannot match anything. It fills in on the next price sync.
        </p>
      )}

      {chips.length > 0 && (
        <ul className="chip-row">
          {chips.map((c) => (
            <li key={c.param}>
              <Link href={href({ [c.param]: undefined, page: undefined })}>
                {c.label}
                <span aria-hidden="true"> ×</span>
                <span className="sr-only">, remove this filter</span>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <div className="toolbar">
        <div className="chips">
          {SORTS.map((s) => (
            <Link
              key={s}
              href={href({ sort: s === 'volume' ? undefined : s, page: undefined })}
              aria-current={f.sort === s || undefined}
            >
              {SORT_LABELS[s]}
            </Link>
          ))}
        </div>
        <p className="toolbar-note">
          {sorted.length.toLocaleString('en-US')}
          {filtered ? ` of ${scored.length.toLocaleString('en-US')}` : ''} item
          {sorted.length === 1 ? '' : 's'}
        </p>
      </div>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>Nothing matches</strong>
          <p>
            {filtered ? (
              <>
                No priced item clears every filter at once. Loosening the narrowest one usually
                does it — margin and profit per window are the two that cut hardest, because most
                items do not clear the tax. <Link href="/items">Clear all</Link> to start again.
              </>
            ) : (
              'The catalogue is populated by the daily sync job, and prices every five minutes. On a fresh deployment this fills in within a few minutes.'
            )}
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="flips">
              <thead>
                <tr>
                  <th className="left">Item</th>
                  <th>Buy at</th>
                  <th>Sell at</th>
                  <th title="Per unit, after the 2% sale tax">Margin</th>
                  <th title="Margin as a share of what you tie up">Return</th>
                  <th title="Capped by the buy limit and by your cash">Per window</th>
                  <th>Limit</th>
                  <th>Traded / h</th>
                  <th>Last trade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map(({ row, opportunity: o, alchProfit }) => (
                  <tr key={row.id}>
                    <th scope="row">
                      <Link href={`/item/${row.id}`} className="item-name">
                        {row.name}
                      </Link>
                      {row.members && <span className="members">members</span>}
                      {f.alchable && alchProfit !== null && alchProfit > 0 && (
                        <span className="alch-tag">alch +{formatGp(alchProfit)}</span>
                      )}
                    </th>
                    <td>
                      <span className={gpClass(o.buyPrice)}>{formatGp(o.buyPrice)}</span>
                    </td>
                    <td>
                      <span className={gpClass(o.sellPrice)}>{formatGp(o.sellPrice)}</span>
                    </td>
                    <td>
                      <span className={plClass(o.marginPerUnit)}>{gpExact(o.marginPerUnit)}</span>
                    </td>
                    <td>
                      <span className={plClass(o.roiPercent)}>{o.roiPercent.toFixed(1)}%</span>
                    </td>
                    <td>
                      <span className={plClass(o.profitPerWindow)}>
                        {formatGp(o.profitPerWindow)}
                      </span>
                    </td>
                    <td>
                      <span className="num subtle">
                        {row.buyLimit ? row.buyLimit.toLocaleString('en-US') : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="num subtle">
                        {(row.hourlyVolume ?? 0).toLocaleString('en-US')}
                      </span>
                    </td>
                    <td>
                      {/* The OLDER side, like everywhere else. Ageing off the
                          buy price alone called an item fresh when nobody had
                          sold it for hours — which is exactly when it is not. */}
                      <span
                        className={`num conf conf-${o.confidence}`}
                        title={exactStamp(
                          (row.lowTime?.getTime() ?? 0) < (row.highTime?.getTime() ?? 0)
                            ? row.lowTime
                            : row.highTime
                        )}
                      >
                        {ago(priceAge(row.lowTime, row.highTime, null, now).olderMinutes)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {!user && (
            <p className="subtle">
              <Link href="/signin">An account</Link> sets your cash stack, so profit per window
              reflects what you can actually fund — plus price alerts, a watchlist and a trading
              book.
            </p>
          )}

          {totalPages > 1 && (
            <p className="toolbar">
              {page > 1 && <Link href={href({ page: String(page - 1) })}>Previous</Link>}
              <span className="toolbar-note">
                Page {page} of {totalPages.toLocaleString('en-US')}
              </span>
              {page < totalPages && <Link href={href({ page: String(page + 1) })}>Next</Link>}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
