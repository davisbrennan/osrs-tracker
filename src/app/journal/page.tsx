import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { recentFlips } from '@/app/actions/flips';
import { formatGp, marginPerUnit } from '@/lib/osrs/ge';
import { gpExact, plClass } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import FlipForm from './flip-form';
import FlipRow from './flip-row';

export const metadata: Metadata = {
  title: 'Flip journal',
  robots: { index: false, follow: false },
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

export default async function Journal() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/journal');

  const [cashStack, flips] = await Promise.all([cashStackFor(user.id), recentFlips(user.id)]);

  const closed = flips.filter((f) => f.soldAt !== null);
  const open = flips.filter((f) => f.soldAt === null);

  const realised = closed.reduce((sum, f) => sum + (f.profit ?? 0), 0);
  const taxPaid = closed.reduce((sum, f) => sum + (f.taxPaid ?? 0), 0);
  const wins = closed.filter((f) => (f.profit ?? 0) > 0).length;
  const capitalTiedUp = open.reduce((sum, f) => sum + f.buyPrice * f.quantity, 0);

  // Unrealised P&L marks open positions to the current instant-buy price.
  // Null where there is no market price — an item that hasn't traded has an
  // unknown value, and showing zero would read as "worthless".
  const unrealised = open.reduce((sum, f) => {
    if (f.marketHigh === null) return sum;
    return sum + marginPerUnit(f.buyPrice, f.marketHigh, f.itemId) * f.quantity;
  }, 0);
  const unpricedOpen = open.filter((f) => f.marketHigh === null).length;

  return (
    <AppShell current="journal" signedIn cashStack={cashStack}>
      <h1>Flip journal</h1>
      <p className="lede">
        What you actually made, not what the margin column promised. Tax and profit are worked out
        and stored when a flip closes, so a future change to the tax rate can&rsquo;t rewrite your
        history.
      </p>

      {flips.length > 0 && (
        <div className="acct-stats wide">
          <div>
            <dt>Realised</dt>
            <dd>
              <span className={plClass(realised)}>{formatGp(realised)}</span>
            </dd>
          </div>
          <div>
            <dt>Unrealised</dt>
            <dd>
              <span className={plClass(unrealised)}>
                {open.length ? formatGp(unrealised) : '—'}
              </span>
            </dd>
          </div>
          <div>
            <dt>Tax paid</dt>
            <dd>
              <span className="num pl-down">{formatGp(taxPaid)}</span>
            </dd>
          </div>
          <div>
            <dt>Open</dt>
            <dd>
              <span className="num">{open.length}</span>
            </dd>
          </div>
          <div>
            <dt>Tied up</dt>
            <dd>
              <span className="num">{formatGp(capitalTiedUp)}</span>
            </dd>
          </div>
          <div>
            <dt>Win rate</dt>
            <dd>
              <span className="num">
                {closed.length ? `${Math.round((wins / closed.length) * 100)}%` : '—'}
              </span>
            </dd>
          </div>
        </div>
      )}

      {unpricedOpen > 0 && (
        <p className="subtle">
          {unpricedOpen} open {unpricedOpen === 1 ? 'position has' : 'positions have'} no current
          market price, so {unpricedOpen === 1 ? 'it is' : 'they are'} left out of the unrealised
          figure rather than counted as zero.
        </p>
      )}

      <section className="card">
        <h2>Log a flip</h2>
        <FlipForm />
      </section>

      {flips.length === 0 ? (
        <div className="empty">
          <strong>Nothing logged yet</strong>
          <p>
            Record a buy and it tracks your position. Add a sell price — now or later — and it works
            out the tax and what you actually cleared. Start from the{' '}
            <Link href="/flips">flip finder</Link> if you&rsquo;re looking for something to trade.
          </p>
        </div>
      ) : (
        <>
          {open.length > 0 && (
            <section className="chart-block">
              <h2>Open positions</h2>
              <div className="table-wrap">
                <table className="flips">
                  <thead>
                    <tr>
                      <th className="left">Item</th>
                      <th>Qty</th>
                      <th>Bought at</th>
                      <th>Cost</th>
                      <th>Market now</th>
                      <th>If sold now</th>
                      <th className="left">Close</th>
                    </tr>
                  </thead>
                  <tbody>
                    {open.map((f) => (
                      <FlipRow key={f.id} flip={f} mode="open" />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {closed.length > 0 && (
            <section className="chart-block">
              <h2>Closed</h2>
              <div className="table-wrap">
                <table className="flips">
                  <thead>
                    <tr>
                      <th className="left">Item</th>
                      <th>Qty</th>
                      <th>Buy</th>
                      <th>Sell</th>
                      <th>Tax</th>
                      <th>Profit</th>
                      <th>When</th>
                      <th className="left"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {closed.map((f) => (
                      <tr key={f.id}>
                        <th scope="row">
                          <Link href={`/item/${f.itemId}`} className="item-name">
                            {f.name}
                          </Link>
                          {f.note && <span className="subtle"> · {f.note}</span>}
                        </th>
                        <td>
                          <span className="num">{f.quantity.toLocaleString('en-US')}</span>
                        </td>
                        <td>
                          <span className="num">{gpExact(f.buyPrice)}</span>
                        </td>
                        <td>
                          <span className="num">{gpExact(f.sellPrice ?? 0)}</span>
                        </td>
                        <td>
                          <span className="num pl-down">{formatGp(f.taxPaid ?? 0)}</span>
                        </td>
                        <td>
                          <span className={plClass(f.profit ?? 0)}>{formatGp(f.profit ?? 0)}</span>
                        </td>
                        <td>
                          <span className="subtle">{dateFormat.format(f.soldAt!)}</span>
                        </td>
                        <td>
                          <FlipRow flip={f} mode="closed" />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}
    </AppShell>
  );
}
