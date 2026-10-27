import Link from 'next/link';
import type { Metadata } from 'next';
import { eq, isNotNull, and, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { evaluate, formatGp, type Opportunity } from '@/lib/osrs/ge';
import { currentUser, cashStackFor } from '@/lib/session';
import AppShell from '@/components/app-shell';
import FlipTable, { type SortKey } from './flip-table';

export const metadata: Metadata = {
  title: 'Flip finder',
  description:
    'Live Grand Exchange margins after tax, capped by buy limits and what your cash stack can actually fund.',
};

/** Rows per page. Enough to scan, not enough to make the page heavy. */
const PAGE_SIZE = 50;

/**
 * Volume floor for the default view.
 *
 * Without one the top of the table fills with items that trade twice a day
 * and show enormous theoretical margins — technically true, useless in
 * practice, and the single most common way these tools mislead people. The
 * "Everything" chip turns it off for anyone who wants to go digging.
 */
const LIQUID_VOLUME = 100;

type Search = {
  cash?: string;
  sort?: string;
  dir?: string;
  q?: string;
  view?: string;
  members?: string;
  page?: string;
};

function compare(a: Opportunity, b: Opportunity, key: SortKey): number {
  switch (key) {
    case 'name':
      return a.name.localeCompare(b.name);
    case 'buy':
      return a.buyPrice - b.buyPrice;
    case 'margin':
      return a.marginPerUnit - b.marginPerUnit;
    case 'roi':
      return a.roiPercent - b.roiPercent;
    case 'limit':
      return a.buyLimit - b.buyLimit;
    case 'capital':
      return a.unitsPerWindow - b.unitsPerWindow;
    case 'volume':
      return a.hourlyVolume - b.hourlyVolume;
    case 'profit':
    default:
      return a.profitPerWindow - b.profitPerWindow;
  }
}

export default async function FlipFinder({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await currentUser();

  // The URL wins over the saved value, so a shared link shows the sender's
  // numbers rather than silently repricing to the reader's own stack.
  const fromUrl = sp.cash ? Number(sp.cash) : NaN;
  const cashStack =
    Number.isFinite(fromUrl) && fromUrl >= 0 ? fromUrl : await cashStackFor(user?.id ?? null);

  const sort = (sp.sort ?? 'profit') as SortKey;
  const dir = sp.dir === 'asc' ? 'asc' : 'desc';
  const search = (sp.q ?? '').trim();
  const everything = sp.view === 'all';
  const membersOnly = sp.members === 'yes';
  const page = Math.max(1, Number(sp.page) || 1);

  const conditions = [isNotNull(osrsPrices.low), isNotNull(osrsPrices.high)];
  if (!everything) conditions.push(sql`${osrsPrices.hourlyVolume} >= ${LIQUID_VOLUME}`);
  if (membersOnly) conditions.push(eq(osrsItems.members, true));
  if (search) conditions.push(sql`${osrsItems.name} ILIKE ${'%' + search + '%'}`);

  const rows = await db
    .select({
      itemId: osrsItems.id,
      name: osrsItems.name,
      members: osrsItems.members,
      buyLimit: osrsItems.buyLimit,
      low: osrsPrices.low,
      high: osrsPrices.high,
      lowTime: osrsPrices.lowTime,
      highTime: osrsPrices.highTime,
      hourlyVolume: osrsPrices.hourlyVolume,
    })
    .from(osrsPrices)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsPrices.itemId))
    .where(and(...conditions));

  // Evaluated in the application rather than in SQL because profit depends on
  // the cash stack, and every row has to be scored before any can be ranked.
  // A few thousand rows is a couple of milliseconds; pushing it into SQL would
  // mean two copies of the tax rules, which is the one thing worth avoiding.
  const now = Date.now();
  const scored = rows.map((r) =>
    evaluate(
      {
        itemId: r.itemId,
        name: r.name,
        low: r.low ?? 0,
        high: r.high ?? 0,
        lowTime: r.lowTime ? Math.floor(r.lowTime.getTime() / 1000) : null,
        highTime: r.highTime ? Math.floor(r.highTime.getTime() / 1000) : null,
        buyLimit: r.buyLimit,
        hourlyVolume: r.hourlyVolume,
      },
      cashStack,
      now
    )
  );

  const profitable = scored.filter((o) => o.marginPerUnit > 0);
  profitable.sort((a, b) => (dir === 'asc' ? compare(a, b, sort) : compare(b, a, sort)));

  const totalPages = Math.max(1, Math.ceil(profitable.length / PAGE_SIZE));
  const current = Math.min(page, totalPages);
  const visible = profitable.slice((current - 1) * PAGE_SIZE, current * PAGE_SIZE);

  const affordable = profitable.filter((o) => o.unitsPerWindow > 0).length;
  const query = { cash: sp.cash, q: sp.q, view: sp.view, members: sp.members };
  const chipHref = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...query, ...patch })) if (v) params.set(k, v);
    return `/flips?${params.toString()}`;
  };

  return (
    <AppShell current="flips" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>Flip finder</h1>
      <p className="lede">
        Margins are after the 2% sale tax, and profit is capped by whichever bites first — the
        item&rsquo;s four-hour buy limit or what {formatGp(cashStack)} can fund.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <strong>No price data yet</strong>
          <p>
            The poller fetches the item catalogue and then prices every five minutes. If this is a
            fresh deployment, give it a minute. If it persists, the worker is not running.
          </p>
        </div>
      ) : (
        <>
          <form className="toolbar" action="/flips">
            {sp.cash && <input type="hidden" name="cash" value={sp.cash} />}
            <input
              type="search"
              name="q"
              defaultValue={search}
              placeholder="Find an item"
              aria-label="Find an item by name"
            />
            <div className="chips">
              <Link href={chipHref({ view: undefined })} aria-current={!everything || undefined}>
                Liquid
              </Link>
              <Link href={chipHref({ view: 'all' })} aria-current={everything || undefined}>
                Everything
              </Link>
              <Link
                href={chipHref({ members: membersOnly ? undefined : 'yes' })}
                aria-current={membersOnly || undefined}
              >
                Members
              </Link>
            </div>
            <p className="toolbar-note">
              {profitable.length.toLocaleString('en-US')} with a positive margin,{' '}
              <strong>{affordable.toLocaleString('en-US')}</strong> you can actually fund
            </p>
          </form>

          {visible.length === 0 ? (
            <div className="empty">
              <strong>Nothing matches</strong>
              <p>
                {search
                  ? `No item named like “${search}” has a positive margin right now.`
                  : 'No item has a positive margin at this filter. Try Everything, which drops the volume floor.'}
              </p>
            </div>
          ) : (
            <>
              <FlipTable rows={visible} sort={sort} dir={dir} query={query} />

              {totalPages > 1 && (
                <p className="toolbar">
                  {current > 1 && (
                    <Link href={chipHref({ sort, dir, page: String(current - 1) })}>Previous</Link>
                  )}
                  <span className="toolbar-note">
                    Page {current} of {totalPages}
                  </span>
                  {current < totalPages && (
                    <Link href={chipHref({ sort, dir, page: String(current + 1) })}>Next</Link>
                  )}
                </p>
              )}
            </>
          )}

          {!user && (
            // The pitch sits BELOW the table on purpose. The table is the
            // product; asking before showing is how you lose the visitor who
            // came from a search result.
            <section className="pitch">
              <h2>What an account adds</h2>
              <ul>
                <li>
                  <strong>Your cash stack is remembered</strong>Every margin on every page reprices
                  to it, instead of resetting to a default each visit.
                </li>
                <li>
                  <strong>A flip journal that knows the tax</strong>Log what you buy, and it tracks
                  realised profit, open positions and what they&rsquo;d fetch right now. Most people
                  do this in a spreadsheet that can&rsquo;t see live prices.
                </li>
                <li>
                  <strong>Your account&rsquo;s progress</strong>Every skill, boss, clue and minigame
                  from the hiscores, with goal estimates worked out from{' '}
                  <em>your own measured XP rate</em> rather than a guide&rsquo;s optimal number.
                </li>
                <li>
                  <strong>Price alerts by email</strong>Told when something crosses a threshold you
                  set, with the margin and breakeven already worked out.
                </li>
              </ul>
              <p>
                <Link href="/signin" className="btn-primary">
                  Create an account
                </Link>
                <span className="subtle">
                  Email only — no password, nothing to reset. Everything on this page keeps working
                  without one.
                </span>
              </p>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
