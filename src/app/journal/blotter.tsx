'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteTrade, closePosition } from '@/app/actions/trades';
import { gpExact, plClass } from '@/lib/gp';
import { formatGp } from '@/lib/osrs/ge';
import type { Trade } from '@/lib/osrs/portfolio';

const when = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * Every execution, newest first.
 *
 * The audit trail. Everything else on this page is derived from these rows,
 * so when a number looks wrong this is where you find out why.
 *
 * A buy row offers to sell, which is the obvious thing to want from it — but
 * only while that item still has something open. Offering it on a buy that's
 * already been sold out would record a sell with no buy behind it, and the
 * engine would rightly refuse to call that profit.
 *
 * The sell goes through the same FIFO path as everywhere else: it closes the
 * OLDEST open lot, not necessarily the row that was clicked. Which is why the
 * button says what it will do.
 */
export default function Blotter({
  trades,
  openQty = {},
}: {
  trades: Trade[];
  /** itemId → quantity still open, so a buy row knows whether selling is possible. */
  openQty?: Record<number, number>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState<string | null>(null);
  const [selling, setSelling] = useState<string | null>(null);
  const [qty, setQty] = useState('');
  const [price, setPrice] = useState('');
  const [sellError, setSellError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  const [pending, start] = useTransition();

  const q = filter.trim().toLowerCase();
  const visible = q ? trades.filter((t) => t.itemName.toLowerCase().includes(q)) : trades;

  return (
    <section className="chart-block">
      <h2>
        Blotter <span className="subtle">every fill, newest first</span>
      </h2>

      <form className="toolbar" onSubmit={(e) => e.preventDefault()}>
        <input
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by item"
          aria-label="Filter the blotter by item"
        />
        <p className="toolbar-note">
          {visible.length.toLocaleString('en-US')} of {trades.length.toLocaleString('en-US')} fills
        </p>
      </form>

      <div className="table-wrap">
        <table className="flips">
          <thead>
            <tr>
              <th className="left">When</th>
              <th className="left">Side</th>
              <th className="left">Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Value</th>
              <th>Tax</th>
              <th className="left"></th>
            </tr>
          </thead>
          <tbody>
            {visible.slice(0, 300).map((t) => (
              <tr key={t.id}>
                <th scope="row" className="subtle">
                  {when.format(t.executedAt)}
                </th>
                <td className="left">
                  <span className={t.side === 'buy' ? 'side-buy' : 'side-sell'}>
                    {t.side === 'buy' ? 'BUY' : 'SELL'}
                  </span>
                </td>
                <td className="left">
                  <Link href={`/item/${t.itemId}`} className="item-name">
                    {t.itemName}
                  </Link>
                  {t.note && <span className="subtle"> · {t.note}</span>}
                </td>
                <td>
                  <span className="num">{t.quantity.toLocaleString('en-US')}</span>
                </td>
                <td>
                  <span className="num">{gpExact(t.price)}</span>
                </td>
                <td>
                  <span className="num">{formatGp(t.price * t.quantity)}</span>
                </td>
                <td>
                  <span className="num pl-down">
                    {t.taxPaid === null ? '—' : formatGp(t.taxPaid)}
                  </span>
                </td>
                <td>
                  <span className="acct-actions">
                    {confirming === t.id ? (
                      <>
                        <button
                          type="button"
                          className="danger"
                          disabled={pending}
                          onClick={() =>
                            start(async () => {
                              await deleteTrade(t.id);
                              setConfirming(null);
                              router.refresh();
                            })
                          }
                        >
                          Delete
                        </button>
                        <button type="button" onClick={() => setConfirming(null)}>
                          Cancel
                        </button>
                      </>
                    ) : selling === t.id ? (
                      <>
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
                              setSellError(null);
                              const open = openQty[t.itemId] ?? 0;
                              const n = Number(qty);
                              if (!Number.isInteger(n) || n <= 0 || n > open) {
                                setSellError(`1 to ${open}`);
                                return;
                              }
                              const r = await closePosition(t.itemId, n, price);
                              if (r.ok) {
                                setSelling(null);
                                setQty('');
                                setPrice('');
                                router.refresh();
                              } else {
                                setSellError(r.error);
                              }
                            })
                          }
                        >
                          Sell
                        </button>
                        <button type="button" onClick={() => setSelling(null)}>
                          Cancel
                        </button>
                        {sellError && <span className="error">{sellError}</span>}
                      </>
                    ) : (
                      <>
                        {t.side === 'buy' && (openQty[t.itemId] ?? 0) > 0 && (
                          <button
                            type="button"
                            title="Sells the oldest open lot of this item first"
                            onClick={() => {
                              setSelling(t.id);
                              setQty(String(Math.min(t.quantity, openQty[t.itemId] ?? 0)));
                              setPrice('');
                              setSellError(null);
                            }}
                          >
                            Sell
                          </button>
                        )}
                        <button type="button" onClick={() => setConfirming(t.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {visible.length > 300 && (
        <p className="subtle">Showing the most recent 300 of {visible.length}.</p>
      )}

      <p className="subtle">
        Removing a fill re-matches everything after it, because positions and P&amp;L are derived
        rather than stored. <strong>Sell</strong> appears on a buy while that item still has
        something open — it closes the oldest lot first, {'FIFO'}, like every other sell. Holding a
        position indefinitely is a position, not an unfinished entry.
      </p>
    </section>
  );
}
