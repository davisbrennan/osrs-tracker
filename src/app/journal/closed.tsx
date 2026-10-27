import Link from 'next/link';
import { formatGp } from '@/lib/osrs/ge';
import { gpExact, plClass, formatEta } from '@/lib/gp';
import type { Close } from '@/lib/osrs/portfolio';

/**
 * Every FIFO match.
 *
 * One row per close rather than per sell: a sell that spans two lots becomes
 * two rows, which is the point — it shows which buy each part was matched
 * against, and therefore why the P&L is what it is.
 */
export default function Closed({ closes, method }: { closes: Close[]; method: string }) {
  if (closes.length === 0) return null;

  return (
    <section className="chart-block">
      <h2>
        Closed <span className="subtle">{method} matched</span>
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
            {closes.slice(0, 100).map((c, i) => (
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
                  <span className="num subtle">{formatEta(c.heldMs / 3_600_000) ?? '—'}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {closes.length > 100 && (
        <p className="subtle">Showing the 100 most recent of {closes.length} closes.</p>
      )}
    </section>
  );
}
