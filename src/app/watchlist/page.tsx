import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { watchlistFor } from '@/app/actions/watchlist';
import { allTrades } from '@/app/actions/trades';
import { buildPortfolio } from '@/lib/osrs/portfolio';
import { limitStatuses, formatResetIn } from '@/lib/osrs/limits';
import { evaluate, formatGp, geTax } from '@/lib/osrs/ge';
import { gpExact, plClass, ago } from '@/lib/gp';
import { priceAge, exactStamp } from '@/lib/osrs/freshness';
import AppShell from '@/components/app-shell';
import AddItem from './add-item';
import Unwatch from './unwatch';

export const metadata: Metadata = {
  title: 'Watchlist',
  robots: { index: false, follow: false },
};

/**
 * The quote board.
 *
 * The monitor you leave open: one row per item you follow, priced both
 * sides, with the margin after tax, what a full window would make on your
 * stack, and whether you still have limit headroom to act on it.
 *
 * Sorted by margin rather than by when you added things, because the point
 * of a board is that the thing worth doing is at the top.
 */
export default async function Watchlist() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/watchlist');

  const [cashStack, rows, trades] = await Promise.all([
    cashStackFor(user.id),
    watchlistFor(user.id),
    allTrades(user.id),
  ]);

  const book = buildPortfolio(trades, new Map());
  const held = new Map(book.positions.map((p) => [p.itemId, p]));
  const limits = limitStatuses(
    trades,
    new Map(rows.map((r) => [r.id, r.buyLimit])),
    new Date()
  );

  const quotes = rows
    .map((r) => {
      const priced = r.low !== null && r.high !== null;
      const opp = priced
        ? evaluate(
            {
              itemId: r.id,
              name: r.name,
              low: r.low!,
              high: r.high!,
              lowTime: r.lowTime ? Math.floor(r.lowTime.getTime() / 1000) : null,
              highTime: r.highTime ? Math.floor(r.highTime.getTime() / 1000) : null,
              buyLimit: r.buyLimit,
              hourlyVolume: r.hourlyVolume ?? 0,
            },
            cashStack
          )
        : null;
      return {
        row: r,
        opp,
        age: priceAge(r.lowTime, r.highTime, r.fetchedAt),
        position: held.get(r.id) ?? null,
        limit: limits.get(r.id) ?? null,
      };
    })
    .sort((a, b) => (b.opp?.profitPerWindow ?? -Infinity) - (a.opp?.profitPerWindow ?? -Infinity));

  return (
    <AppShell current="watchlist" signedIn cashStack={cashStack}>
      <h1>Watchlist</h1>
      <p className="lede">
        Everything you follow, priced both sides and net of the 2% the Grand Exchange takes on the
        way out. Sorted by what a full four-hour window would clear on your{' '}
        {formatGp(cashStack)} — not by spread, which flatters items you cannot afford to fill.
      </p>

      <AddItem />

      {quotes.length === 0 ? (
        <div className="empty">
          <strong>Nothing on the board</strong>
          <p>
            Add an item above, or hit <strong>Watch</strong> on any item page. The{' '}
            <Link href="/flips">flip finder</Link> is the place to find candidates — this is where
            you keep the handful you actually care about.
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="flips">
            <thead>
              <tr>
                <th className="left">Item</th>
                <th title="What you pay to buy — the instant-sell price">Bid</th>
                <th title="What you get selling — the instant-buy price">Ask</th>
                <th>Spread</th>
                <th title="Per unit, after the 2% sale tax">Margin</th>
                <th>%</th>
                <th title="Margin times whichever is smaller: the buy limit or what you can fund">
                  Per window
                </th>
                <th title="Units bought in the last four hours, and what is left">Limit</th>
                <th>Vol/h</th>
                <th title="Since the slower side of the book last traded">Last trade</th>
                <th className="left">You hold</th>
                <th className="left"></th>
              </tr>
            </thead>
            <tbody>
              {quotes.map(({ row, opp, age, position, limit }) => (
                <tr key={row.id}>
                  <th scope="row">
                    <Link href={`/item/${row.id}`} className="item-name">
                      {row.name}
                    </Link>
                  </th>
                  {opp === null ? (
                    <td colSpan={9} className="left subtle">
                      No price on record — it has not traded on both sides recently.
                    </td>
                  ) : (
                    <>
                      <td>
                        <span className="num">{gpExact(row.low!)}</span>
                      </td>
                      <td>
                        <span className="num">{gpExact(row.high!)}</span>
                      </td>
                      <td>
                        <span className="num subtle">{gpExact(row.high! - row.low!)}</span>
                      </td>
                      <td>
                        <span className={plClass(opp.marginPerUnit)}>
                          {gpExact(opp.marginPerUnit)}
                        </span>
                      </td>
                      <td>
                        <span className={plClass(opp.roiPercent)}>
                          {opp.roiPercent.toFixed(1)}%
                        </span>
                      </td>
                      <td>
                        <span className={plClass(opp.profitPerWindow)}>
                          {formatGp(opp.profitPerWindow)}
                        </span>
                      </td>
                      <td>
                        {limit === null || limit.limit === null ? (
                          <span className="subtle">—</span>
                        ) : (
                          <span className={limit.exhausted ? 'num pl-down' : 'num'}>
                            {limit.remaining?.toLocaleString('en-US')}
                            <span className="subtle">/{limit.limit.toLocaleString('en-US')}</span>
                          </span>
                        )}
                      </td>
                      <td>
                        <span className="num subtle">
                          {(row.hourlyVolume ?? 0).toLocaleString('en-US')}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`num conf conf-${opp.confidence}`}
                          title={exactStamp(
                            age.buyMinutes !== null &&
                              age.sellMinutes !== null &&
                              age.buyMinutes > age.sellMinutes
                              ? row.lowTime
                              : row.highTime
                          )}
                        >
                          {ago(age.olderMinutes)}
                        </span>
                      </td>
                    </>
                  )}
                  <td className="left">
                    {position ? (
                      <span className="num">
                        {position.quantity.toLocaleString('en-US')}
                        <span className="subtle">
                          {' '}
                          @ {gpExact(Math.round(position.avgCost))}
                        </span>
                      </span>
                    ) : (
                      <span className="subtle">—</span>
                    )}
                  </td>
                  <td className="left">
                    <span className="acct-actions">
                      <Unwatch itemId={row.id} />
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {quotes.some((q) => q.limit?.exhausted) && (
        <p className="book-warn">
          <strong>Some rows are out of buy limit.</strong> Those positions cannot be added to until
          the four-hour window rolls
          {(() => {
            const next = quotes
              .filter((q) => q.limit?.resetsInMs != null)
              .sort((a, b) => a.limit!.resetsInMs! - b.limit!.resetsInMs!)[0];
            const t = next ? formatResetIn(next.limit!.resetsInMs) : null;
            return t ? ` — the next in ${t}` : '';
          })()}
          . Counted from fills recorded here, so anything bought in game and not logged is
          invisible to it.
        </p>
      )}

      <p className="subtle">
        Prices refresh every five minutes. Tax is the real rule — 2% of the sale, rounded down,
        nothing under 50gp, capped at {formatGp(5_000_000)} per item — so a{' '}
        {gpExact(geTax(1_000_000))} bite on a 1m sale is already priced into every margin here.
      </p>
    </AppShell>
  );
}
