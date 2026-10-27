import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { allTrades, marksFor } from '@/app/actions/trades';
import {
  buildPortfolio,
  computeStats,
  equityCurve,
  byItem,
  concentration,
} from '@/lib/osrs/portfolio';
import { formatGp } from '@/lib/osrs/ge';
import { plClass } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import TradeForm from './trade-form';
import Blotter from './blotter';
import Positions from './positions';
import EquityCurve from './equity-curve';
import Performance from './performance';
import Closed from './closed';
import BookViews, { parseView } from './book-views';

export const metadata: Metadata = {
  title: 'Book',
  robots: { index: false, follow: false },
};

function pct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v.toFixed(digits)}%`;
}

type Search = { view?: string | string[] };

/**
 * The book, in four views.
 *
 * The summary row and any warnings stay put across all of them — that's the
 * part you want on screen whichever section you're in, the way a broker keeps
 * the account bar pinned. The detail is split, because nine stacked tables is
 * a document you scroll rather than a tool you use.
 *
 * The whole portfolio is still computed on every request regardless of view.
 * That's deliberate: the headline figures need it anyway, and the arithmetic
 * is trivial next to the two queries that feed it. Rendering less, not
 * computing less, is what makes the page readable.
 */
export default async function Journal({ searchParams }: { searchParams: Promise<Search> }) {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/journal');

  const view = parseView((await searchParams).view);

  const [cashStack, trades] = await Promise.all([cashStackFor(user.id), allTrades(user.id)]);
  const marks = await marksFor([...new Set(trades.map((t) => t.itemId))]);

  const portfolio = buildPortfolio(trades, marks);
  const stats = computeStats(portfolio.closes);
  const curve = equityCurve(portfolio.closes);
  const items = byItem(portfolio.closes);
  const conc = concentration(portfolio.positions);

  const openCost = portfolio.positions.reduce((s, p) => s + p.costBasis, 0);
  const openUnrealised = portfolio.positions.reduce((s, p) => s + (p.unrealised ?? 0), 0);
  const unmarkable = portfolio.positions.filter((p) => p.mark === null).length;

  /* Nothing recorded at all: one screen, no sub-navigation to get lost in. */
  if (trades.length === 0) {
    return (
      <AppShell current="journal" signedIn cashStack={cashStack}>
        <h1>Book</h1>
        <p className="lede">
          Executions are what you record. Positions, average cost and realised P&amp;L are worked
          out from them — matched {portfolio.method}, with tax taken at the price it was actually
          charged.
        </p>
        <section className="card">
          <h2>Record a fill</h2>
          <TradeForm />
        </section>
        <div className="empty">
          <strong>Nothing recorded yet</strong>
          <p>
            Log each buy and sell as they actually happen. The four-hour buy limit means a large
            position is built from several lots at different prices — that is exactly what this is
            built to track, and what a one-row flip log gets wrong. Start from the{' '}
            <Link href="/flips">flip finder</Link> if you need something to trade.
          </p>
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell current="journal" signedIn cashStack={cashStack}>
      <h1>Book</h1>

      {/* ------------------------------------------------- always on screen */}
      <div className="kpi-row">
        <div className="kpi">
          <dt>Realised P&amp;L</dt>
          <dd className={plClass(stats.realised)}>{formatGp(stats.realised)}</dd>
          <span className="subtle">{stats.trades} closes</span>
        </div>
        <div className="kpi">
          <dt>Unrealised</dt>
          <dd className={plClass(openUnrealised)}>
            {portfolio.positions.length ? formatGp(openUnrealised) : '—'}
          </dd>
          <span className="subtle">net of exit tax</span>
        </div>
        <div className="kpi">
          <dt>Open cost basis</dt>
          <dd className="num">{formatGp(openCost)}</dd>
          <span className="subtle">{portfolio.positions.length} positions</span>
        </div>
        <div className="kpi">
          <dt>Return on capital</dt>
          <dd className={stats.returnOnCapital === null ? 'num' : plClass(stats.returnOnCapital)}>
            {pct(stats.returnOnCapital, 2)}
          </dd>
          <span className="subtle">on {formatGp(stats.capitalDeployed)} deployed</span>
        </div>
        <div className="kpi">
          <dt>Profit factor</dt>
          <dd className="num">{stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}</dd>
          <span className="subtle">
            {stats.profitFactor === null ? 'no losing closes yet' : 'gross win ÷ gross loss'}
          </span>
        </div>
        <div className="kpi">
          <dt>Max drawdown</dt>
          <dd className={stats.maxDrawdown > 0 ? 'num pl-down' : 'num'}>
            {formatGp(stats.maxDrawdown)}
          </dd>
          <span className="subtle">worst peak to trough</span>
        </div>
      </div>

      {portfolio.unmatched.length > 0 && (
        <p className="book-warn">
          <strong>
            {portfolio.unmatched.length} sell
            {portfolio.unmatched.length === 1 ? '' : 's'} with no matching buy.
          </strong>{' '}
          They&rsquo;re excluded from P&amp;L rather than counted as free profit — add the buy that
          came first and they&rsquo;ll match.{' '}
          {portfolio.unmatched
            .slice(0, 3)
            .map((u) => `${u.quantity} × ${u.itemName}`)
            .join(', ')}
          {portfolio.unmatched.length > 3 ? '…' : ''}
        </p>
      )}

      <BookViews
        current={view}
        counts={{
          positions: portfolio.positions.length,
          performance: portfolio.closes.length,
          activity: trades.length,
        }}
      />

      {/* -------------------------------------------------------- positions */}
      {view === 'positions' && (
        <>
          <Positions positions={portfolio.positions} unmarkable={unmarkable} />

          {portfolio.positions.length === 0 && (
            <div className="empty">
              <strong>Nothing open</strong>
              <p>
                Everything you&rsquo;ve bought has been sold. The results are under{' '}
                <Link href="/journal?view=performance">Performance</Link>, and every fill is under{' '}
                <Link href="/journal?view=activity">Activity</Link>.
              </p>
            </div>
          )}

          {conc.length > 1 && (
            <section className="card">
              <h2>
                Concentration <span className="subtle">share of open capital</span>
              </h2>
              <ul className="conc-list">
                {conc.slice(0, 8).map((c) => (
                  <li key={c.itemName}>
                    <span className="conc-name">{c.itemName}</span>
                    <span className="conc-bar" aria-hidden="true">
                      <span style={{ width: `${Math.min(100, c.pct)}%` }} />
                    </span>
                    <span className="num">{c.pct.toFixed(0)}%</span>
                  </li>
                ))}
              </ul>
              {conc[0].pct > 60 && (
                <p className="subtle">
                  {conc[0].pct.toFixed(0)}% of your open capital is in {conc[0].itemName}. That is
                  the position that decides how the book does.
                </p>
              )}
            </section>
          )}
        </>
      )}

      {/* ----------------------------------------------------------- ticket */}
      {view === 'record' && (
        <section className="card">
          <h2>Record a fill</h2>
          <TradeForm />
        </section>
      )}

      {/* ------------------------------------------------------ performance */}
      {view === 'performance' && (
        <>
          {curve.length > 1 && (
            <section className="chart-block">
              <h2>
                Equity curve <span className="subtle">cumulative realised P&amp;L</span>
              </h2>
              <EquityCurve points={curve} />
            </section>
          )}
          {portfolio.closes.length === 0 ? (
            <div className="empty">
              <strong>Nothing closed yet</strong>
              <p>
                Performance is measured on closes, not on open positions — an unsold position has a
                price, not a result. Sell something from{' '}
                <Link href="/journal">Positions</Link> and it appears here.
              </p>
            </div>
          ) : (
            <Performance stats={stats} items={items} />
          )}
        </>
      )}

      {/* --------------------------------------------------------- activity */}
      {view === 'activity' && (
        <>
          <Closed closes={portfolio.closes} method={portfolio.method} />
          <Blotter
            trades={trades}
            openQty={Object.fromEntries(portfolio.positions.map((p) => [p.itemId, p.quantity]))}
          />
        </>
      )}
    </AppShell>
  );
}
