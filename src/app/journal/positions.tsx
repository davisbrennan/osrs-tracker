'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { closePosition } from '@/app/actions/trades';
import { formatGp } from '@/lib/osrs/ge';
import { gpExact, plClass } from '@/lib/gp';
import type { Position } from '@/lib/osrs/portfolio';

/**
 * The open book.
 *
 * Average cost rather than "what I paid", because with the four-hour buy
 * limit a position is nearly always several lots at different prices — the
 * single figure people reach for does not exist.
 */
export default function Positions({
  positions,
  unmarkable,
}: {
  positions: Position[];
  unmarkable: number;
}) {
  const router = useRouter();
  const [closing, setClosing] = useState<number | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (positions.length === 0) return null;

  return (
    <section className="chart-block">
      <h2>
        Open positions <span className="subtle">marked to the instant-buy price, after tax</span>
      </h2>

      <div className="table-wrap">
        <table className="flips">
          <thead>
            <tr>
              <th className="left">Item</th>
              <th>Qty</th>
              <th title="Weighted average of the lots still open">Avg cost</th>
              <th>Cost basis</th>
              <th>Mark</th>
              <th>Market value</th>
              <th title="What closing the whole position right now would clear">Unrealised</th>
              <th>%</th>
              <th className="left">Close</th>
            </tr>
          </thead>
          <tbody>
            {positions.map((p) => (
              <tr key={p.itemId}>
                <th scope="row">
                  <Link href={`/item/${p.itemId}`} className="item-name">
                    {p.itemName}
                  </Link>
                </th>
                <td>
                  <span className="num">{p.quantity.toLocaleString('en-US')}</span>
                </td>
                <td>
                  <span className="num">{gpExact(Math.round(p.avgCost))}</span>
                </td>
                <td>
                  <span className="num">{formatGp(p.costBasis)}</span>
                </td>
                <td>
                  <span className="num">{p.mark === null ? '—' : gpExact(p.mark)}</span>
                </td>
                <td>
                  <span className="num">
                    {p.marketValue === null ? '—' : formatGp(p.marketValue)}
                  </span>
                </td>
                <td>
                  {p.unrealised === null ? (
                    <span className="subtle">unknown</span>
                  ) : (
                    <span className={plClass(p.unrealised)}>{formatGp(p.unrealised)}</span>
                  )}
                </td>
                <td>
                  {p.unrealisedPct === null ? (
                    <span className="subtle">—</span>
                  ) : (
                    <span className={plClass(p.unrealisedPct)}>{p.unrealisedPct.toFixed(1)}%</span>
                  )}
                </td>
                <td>
                  {closing === p.itemId ? (
                    <span className="acct-actions">
                      <input
                        className="close-input"
                        value={qty}
                        onChange={(e) => setQty(e.target.value)}
                        placeholder="qty"
                        aria-label="Quantity to sell"
                      />
                      <input
                        className="close-input"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder="price"
                        aria-label="Sell price"
                      />
                      <button
                        type="button"
                        disabled={pending || !qty.trim() || !price.trim()}
                        onClick={() =>
                          start(async () => {
                            setError(null);
                            const n = Number(qty);
                            if (!Number.isInteger(n) || n <= 0 || n > p.quantity) {
                              setError(`1 to ${p.quantity}`);
                              return;
                            }
                            const r = await closePosition(p.itemId, n, price);
                            if (r.ok) {
                              setClosing(null);
                              setQty('');
                              setPrice('');
                              router.refresh();
                            } else {
                              setError(r.error);
                            }
                          })
                        }
                      >
                        Sell
                      </button>
                      <button type="button" onClick={() => setClosing(null)}>
                        Cancel
                      </button>
                      {error && <span className="error">{error}</span>}
                    </span>
                  ) : (
                    <span className="acct-actions">
                      <button
                        type="button"
                        onClick={() => {
                          setClosing(p.itemId);
                          setQty(String(p.quantity));
                          setPrice(p.mark ? String(p.mark) : '');
                          setError(null);
                        }}
                      >
                        Sell
                      </button>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {unmarkable > 0 && (
        <p className="subtle">
          {unmarkable} position{unmarkable === 1 ? '' : 's'} with no current market price, left out
          of the unrealised total rather than counted as worthless.
        </p>
      )}
    </section>
  );
}
