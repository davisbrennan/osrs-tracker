'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { closeFlip, deleteFlip } from '@/app/actions/flips';
import { formatGp, marginPerUnit } from '@/lib/osrs/ge';
import { gpExact, plClass } from '@/lib/gp';

type Flip = {
  id: string;
  itemId: number;
  name: string;
  quantity: number;
  buyPrice: number;
  marketHigh: number | null;
  note: string | null;
};

/**
 * An open position, or the delete control on a closed one.
 *
 * "If sold now" marks the position to the current instant-buy price with tax
 * already taken off — the number you'd actually receive, not the spread.
 */
export default function FlipRow({ flip, mode }: { flip: Flip; mode: 'open' | 'closed' }) {
  const router = useRouter();
  const [sell, setSell] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function remove() {
    start(async () => {
      const r = await deleteFlip(flip.id);
      if (!r.ok) setError(r.error);
      router.refresh();
    });
  }

  if (mode === 'closed') {
    return confirming ? (
      <span className="acct-actions">
        <button type="button" className="danger" disabled={pending} onClick={remove}>
          Delete
        </button>
        <button type="button" onClick={() => setConfirming(false)}>
          Cancel
        </button>
      </span>
    ) : (
      <span className="acct-actions">
        <button type="button" onClick={() => setConfirming(true)}>
          Remove
        </button>
      </span>
    );
  }

  const cost = flip.buyPrice * flip.quantity;
  const ifSold =
    flip.marketHigh === null
      ? null
      : marginPerUnit(flip.buyPrice, flip.marketHigh, flip.itemId) * flip.quantity;

  return (
    <tr>
      <th scope="row">
        <Link href={`/item/${flip.itemId}`} className="item-name">
          {flip.name}
        </Link>
        {flip.note && <span className="subtle"> · {flip.note}</span>}
      </th>
      <td>
        <span className="num">{flip.quantity.toLocaleString('en-US')}</span>
      </td>
      <td>
        <span className="num">{gpExact(flip.buyPrice)}</span>
      </td>
      <td>
        <span className="num">{formatGp(cost)}</span>
      </td>
      <td>
        <span className="num">{flip.marketHigh === null ? '—' : formatGp(flip.marketHigh)}</span>
      </td>
      <td>
        {ifSold === null ? (
          <span className="subtle">unknown</span>
        ) : (
          <span className={plClass(ifSold)}>{formatGp(ifSold)}</span>
        )}
      </td>
      <td>
        <span className="acct-actions">
          <input
            value={sell}
            onChange={(e) => setSell(e.target.value)}
            placeholder="sold at"
            aria-label={`Sell price for ${flip.name}`}
            className="close-input"
          />
          <button
            type="button"
            disabled={pending || !sell.trim()}
            onClick={() =>
              start(async () => {
                setError(null);
                const r = await closeFlip(flip.id, sell);
                if (r.ok) {
                  setSell('');
                  router.refresh();
                } else {
                  setError(r.error);
                }
              })
            }
          >
            Close
          </button>
          {error && <span className="error">{error}</span>}
        </span>
      </td>
    </tr>
  );
}
