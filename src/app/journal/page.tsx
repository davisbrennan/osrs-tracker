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
import { gpExact, plClass, formatEta } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import TradeForm from './trade-form';
import Blotter from './blotter';
import Positions from './positions';
import EquityCurve from './equity-curve';

export const metadata: Metadata = {
  title: 'Book',
  robots: { index: false, follow: false },
};

function pct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v.toFixed(digits)}%`;
}

export default async function Journal() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/journal');

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

  return (
    <AppShell current="journal" signedIn cashStack={cashStack}>
      <h1>Book</h1>
      <p className="lede">
        Executions are what you record. Positions, average cost and realised P&amp;L are worked out
        from them — matched {portfolio.method}, with tax taken at the price it was actually charged.
      </p>

      {trades.length === 0 ? (
        <>
          <section className="card">
            <h2>Record a fill</h2>
            <TradeForm />
          </section>
          <div className="empty">
            <strong>Nothing recorded yet</strong>
            <p>
              Log each buy and sell separately, the way they actually happen. The four-hour buy
              limit means a large position is built from several lots at different prices — that is
              exactly what this is built to track, and what a one-row flip log gets wrong. Start
              from the <Link href="/flips">flip finder</Link> if you need something to trade.
            </p>
          </div>
        </>
      ) : (
        <>
          {/* ---------------------------------------------- headline row */}
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
              <dd
                className={stats.returnOnCapital === null ? 'num' : plClass(stats.returnOnCapital)}
              >
                {pct(stats.returnOnCapital, 2)}
              </dd>
              <span className="subtle">on {formatGp(stats.capitalDeployed)} deployed</span>
            </div>
            <div className="kpi">
              <dt>Profit factor</dt>
              <dd className="num">
                {stats.profitFactor === null ? '—' : stats.profitFactor.toFixed(2)}
              </dd>
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
            <p className="adm-note adm-warn">
              <strong>
                {portfolio.unmatched.length} sell
                {portfolio.unmatched.length === 1 ? '' : 's'} with no matching buy.
              </strong>{' '}
              They&rsquo;re excluded from P&amp;L rather than counted as free profit — add the buy
              that came first and they&rsquo;ll match.{' '}
              {portfolio.unmatched
                .slice(0, 3)
                .map((u) => `${u.quantity} × ${u.itemName}`)
                .join(', ')}
              {portfolio.unmatched.length > 3 ? '…' : ''}
            </p>
          )}

          {curve.length > 1 && (
            <section className="chart-block">
              <h2>
                Equity curve <span className="subtle">cumulative realised P&amp;L</span>
              </h2>
              <EquityCurve points={curve} />
            </section>
          )}

          <Positions positions={portfolio.positions} unmarkable={unmarkable} />

          <section className="card">
            <h2>Record a fill</h2>
            <TradeForm />
          </section>

          {/* ------------------------------------------------- analytics */}
          <section className="chart-block">
            <h2>Performance</h2>
            <div className="stat-table-wrap">
              <table className="stat-table">
                <tbody>
                  <tr>
                    <th scope="row">Win rate</th>
                    <td className="num">
                      {pct(stats.winRate === null ? null : stats.winRate * 100)}
                    </td>
                    <td className="subtle">
                      {stats.wins} won, {stats.losses} lost
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Average win</th>
                    <td className="num pl-up">
                      {stats.avgWin === null ? '—' : formatGp(stats.avgWin)}
                    </td>
                    <td className="subtle">per winning close</td>
                  </tr>
                  <tr>
                    <th scope="row">Average loss</th>
                    <td className="num pl-down">
                      {stats.avgLoss === null ? '—' : formatGp(stats.avgLoss)}
                    </td>
                    <td className="subtle">per losing close</td>
                  </tr>
                  <tr>
                    <th scope="row">Expectancy</th>
                    <td className={stats.expectancy === null ? 'num' : plClass(stats.expectancy)}>
                      {stats.expectancy === null ? '—' : formatGp(stats.expectancy)}
                    </td>
                    <td className="subtle">
                      what the average close is worth at this win rate and these sizes
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Gross profit / loss</th>
                    <td className="num">
                      <span className="pl-up">{formatGp(stats.grossProfit)}</span>
                      {' / '}
                      <span className="pl-down">{formatGp(stats.grossLoss)}</span>
                    </td>
                    <td className="subtle">before netting</td>
                  </tr>
                  <tr>
                    <th scope="row">Tax paid</th>
                    <td className="num pl-down">{formatGp(stats.totalTax)}</td>
                    <td className="subtle">
                      {stats.realised + stats.totalTax !== 0
                        ? `${((stats.totalTax / (Math.abs(stats.realised) + stats.totalTax)) * 100).toFixed(0)}% of what you cleared before tax`
                        : ''}
                    </td>
                  </tr>
                  <tr>
                    <th scope="row">Median hold</th>
                    <td className="num">
                      {stats.medianHoldMs === null
                        ? '—'
                        : (formatEta(stats.medianHoldMs / 3_600_000) ?? '—')}
                    </td>
                    <td className="subtle">how long capital sits tied up</td>
                  </tr>
                  <tr>
                    <th scope="row">Best close</th>
                    <td className="num pl-up">{stats.best ? formatGp(stats.best.profit) : '—'}</td>
                    <td className="subtle">{stats.best?.itemName ?? ''}</td>
                  </tr>
                  <tr>
                    <th scope="row">Worst close</th>
                    <td className="num pl-down">
                      {stats.worst ? formatGp(stats.worst.profit) : '—'}
                    </td>
                    <td className="subtle">{stats.worst?.itemName ?? ''}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          {items.length > 0 && (
            <section className="chart-block">
              <h2>
                By item <span className="subtle">where the money actually came from</span>
              </h2>
              <div className="table-wrap">
                <table className="flips">
                  <thead>
                    <tr>
                      <th className="left">Item</th>
                      <th>Closes</th>
                      <th>Units</th>
                      <th>Win rate</th>
                      <th>Realised</th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((r) => (
                      <tr key={r.itemId}>
                        <th scope="row">
                          <Link href={`/item/${r.itemId}`} className="item-name">
                            {r.itemName}
                          </Link>
                        </th>
                        <td>
                          <span className="num">{r.trades}</span>
                        </td>
                        <td>
                          <span className="num subtle">{r.volume.toLocaleString('en-US')}</span>
                        </td>
                        <td>
                          <span className="num subtle">
                            {pct(r.winRate === null ? null : r.winRate * 100, 0)}
                          </span>
                        </td>
                        <td>
                          <span className={plClass(r.realised)}>{formatGp(r.realised)}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
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

          {/* ---------------------------------------------------- closes */}
          {portfolio.closes.length > 0 && (
            <section className="chart-block">
              <h2>
                Closed <span className="subtle">{portfolio.method} matched</span>
              </h2>
              <div className="table-wrap">
                <table className="flips">
                  <thead>
                    <tr>
                      <th className="left">Item</th>
                      <th>Qty</th>
                      <th>Bought</th>
                      <th>Sold</th>
                      <th>Cost</th>
                      <th>Tax</th>
                      <th>P&amp;L</th>
                      <th>Held</th>
                    </tr>
                  </thead>
                  <tbody>
                    {portfolio.closes.slice(0, 100).map((c, i) => (
                      <tr key={`${c.itemId}-${c.closedAt.getTime()}-${i}`}>
                        <th scope="row">
                          <Link href={`/item/${c.itemId}`} className="item-name">
                            {c.itemName}
                          </Link>
                        </th>
                        <td>
                          <span className="num">{c.quantity.toLocaleString('en-US')}</span>
                        </td>
                        <td>
                          <span className="num">{gpExact(c.buyPrice)}</span>
                        </td>
                        <td>
                          <span className="num">{gpExact(c.sellPrice)}</span>
                        </td>
                        <td>
                          <span className="num subtle">{formatGp(c.cost)}</span>
                        </td>
                        <td>
                          <span className="num pl-down">{formatGp(c.tax)}</span>
                        </td>
                        <td>
                          <span className={plClass(c.profit)}>{formatGp(c.profit)}</span>
                        </td>
                        <td>
                          <span className="num subtle">
                            {formatEta(c.heldMs / 3_600_000) ?? '—'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <Blotter trades={trades} />
        </>
      )}
    </AppShell>
  );
}
