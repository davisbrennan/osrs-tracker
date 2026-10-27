import Link from 'next/link';
import { formatGp } from '@/lib/osrs/ge';
import { plClass, formatEta } from '@/lib/gp';
import type { Stats, ItemBreakdown } from '@/lib/osrs/portfolio';

function pct(v: number | null, digits = 1): string {
  return v === null ? '—' : `${v.toFixed(digits)}%`;
}

/**
 * How the book is doing, and where it came from.
 *
 * Every figure here is derived from the closes, so it can't disagree with the
 * blotter. The third column says what each one means rather than leaving the
 * name to carry it — expectancy and profit factor are jargon until they're
 * explained once.
 */
export default function Performance({
  stats,
  items,
}: {
  stats: Stats;
  items: ItemBreakdown[];
}) {
  return (
    <>
      <section className="chart-block">
        <h2>
          Performance <span className="subtle">across {stats.trades} closes</span>
        </h2>
        <div className="stat-table-wrap">
          <table className="stat-table">
            <tbody>
              <tr>
                <th scope="row">Win rate</th>
                <td className="num">{pct(stats.winRate === null ? null : stats.winRate * 100)}</td>
                <td className="subtle">
                  {stats.wins} won, {stats.losses} lost
                </td>
              </tr>
              <tr>
                <th scope="row">Average win</th>
                <td className="num pl-up">{stats.avgWin === null ? '—' : formatGp(stats.avgWin)}</td>
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
                <td className="num pl-down">{stats.worst ? formatGp(stats.worst.profit) : '—'}</td>
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
    </>
  );
}
