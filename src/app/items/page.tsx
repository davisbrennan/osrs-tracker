import Link from 'next/link';
import type { Metadata } from 'next';
import { eq, and, isNotNull, desc, asc, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { formatGp } from '@/lib/osrs/ge';
import { currentUser, cashStackFor } from '@/lib/session';
import { gpClass, ago } from '@/lib/gp';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Items',
  description:
    'Every tradeable Old School RuneScape item with its current Grand Exchange price, buy limit and hourly trade volume.',
};

const PAGE_SIZE = 100;

export default async function Items({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; sort?: string }>;
}) {
  const sp = await searchParams;
  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);

  const search = (sp.q ?? '').trim();
  const page = Math.max(1, Number(sp.page) || 1);
  const byName = sp.sort === 'name';

  const conditions = [isNotNull(osrsPrices.low)];
  if (search) conditions.push(sql`${osrsItems.name} ILIKE ${'%' + search + '%'}`);

  const rows = await db
    .select({
      id: osrsItems.id,
      name: osrsItems.name,
      members: osrsItems.members,
      buyLimit: osrsItems.buyLimit,
      low: osrsPrices.low,
      high: osrsPrices.high,
      hourlyVolume: osrsPrices.hourlyVolume,
      lowTime: osrsPrices.lowTime,
    })
    .from(osrsItems)
    .innerJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
    .where(and(...conditions))
    // Volume first by default: the items worth looking at are the ones people
    // are actually trading, not the ones that sort first alphabetically.
    .orderBy(byName ? asc(osrsItems.name) : desc(osrsPrices.hourlyVolume))
    .limit(PAGE_SIZE + 1)
    .offset((page - 1) * PAGE_SIZE);

  const hasMore = rows.length > PAGE_SIZE;
  const visible = rows.slice(0, PAGE_SIZE);
  const now = Date.now();

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries({ q: sp.q, sort: sp.sort, ...patch }))
      if (v) params.set(k, v);
    const qs = params.toString();
    return qs ? `/items?${qs}` : '/items';
  };

  return (
    <AppShell current="items" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>Items</h1>
      <p className="lede">
        Everything with a current Grand Exchange price, busiest first. Open an item for its margin
        after tax and a 30-day price history.
      </p>

      <form className="toolbar" action="/items">
        <input
          type="search"
          name="q"
          defaultValue={search}
          placeholder="Find an item"
          aria-label="Find an item by name"
        />
        <div className="chips">
          <Link
            href={href({ sort: undefined, page: undefined })}
            aria-current={!byName || undefined}
          >
            Busiest
          </Link>
          <Link href={href({ sort: 'name', page: undefined })} aria-current={byName || undefined}>
            A–Z
          </Link>
        </div>
      </form>

      {visible.length === 0 ? (
        <div className="empty">
          <strong>{search ? 'Nothing matches' : 'No items yet'}</strong>
          <p>
            {search
              ? `No priced item is named like “${search}”.`
              : 'The catalogue is populated by the daily sync job, and prices every five minutes. On a fresh deployment this fills in within a few minutes.'}
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
                  <th>Limit</th>
                  <th>Traded / h</th>
                  <th>Last trade</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((i) => (
                  <tr key={i.id}>
                    <th scope="row">
                      <Link href={`/item/${i.id}`} className="item-name">
                        {i.name}
                      </Link>
                      {i.members && <span className="members">members</span>}
                    </th>
                    <td>
                      <span className={gpClass(i.low ?? 0)}>{formatGp(i.low ?? 0)}</span>
                    </td>
                    <td>
                      {i.high === null ? (
                        <span className="subtle">—</span>
                      ) : (
                        <span className={gpClass(i.high)}>{formatGp(i.high)}</span>
                      )}
                    </td>
                    <td>
                      <span className="num subtle">
                        {i.buyLimit ? i.buyLimit.toLocaleString('en-US') : '—'}
                      </span>
                    </td>
                    <td>
                      <span className="num subtle">{i.hourlyVolume.toLocaleString('en-US')}</span>
                    </td>
                    <td>
                      <span className="num subtle">
                        {i.lowTime ? ago((now - i.lowTime.getTime()) / 60_000) : '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {(page > 1 || hasMore) && (
            <p className="toolbar">
              {page > 1 && <Link href={href({ page: String(page - 1) })}>Previous</Link>}
              <span className="toolbar-note">Page {page}</span>
              {hasMore && <Link href={href({ page: String(page + 1) })}>Next</Link>}
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
