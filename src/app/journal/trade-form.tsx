'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { addTrade, searchItems, type ItemMatch } from '@/app/actions/trades';
import { formatGp } from '@/lib/osrs/ge';

/**
 * The ticket.
 *
 * One execution at a time by default, because that is the honest unit: the
 * four-hour limit means a large position is several buys, and combining them
 * loses which lot a later sell matches against.
 *
 * But plenty of flips really are one buy and one sell, so "also record the
 * sell" is offered — opt-in, off by default, and it writes a second row
 * rather than a combined one. The convenience is in the form; the data stays
 * one fill per row. Leaving it off and closing the position later (or never)
 * is equally valid.
 */
export default function TradeForm() {
  const router = useRouter();
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [picked, setPicked] = useState<ItemMatch | null>(null);
  const [alsoSell, setAlsoSell] = useState(false);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    setPicked(null);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setMatches(value.trim().length < 2 ? [] : await searchItems(value));
    }, 180);
  }

  /** The price you'd most likely be filling at, as a starting point. */
  const suggested = picked ? (side === 'buy' ? picked.low : picked.high) : null;

  return (
    <form
      ref={formRef}
      className="flip-form"
      action={(formData) =>
        start(async () => {
          const result = await addTrade(formData);
          setNote({ text: result.ok ? result.message : result.error, ok: result.ok });
          if (result.ok) {
            formRef.current?.reset();
            setQuery('');
            setPicked(null);
            setMatches([]);
            setAlsoSell(false);
            router.refresh();
          }
        })
      }
    >
      <input type="hidden" name="itemId" value={picked?.id ?? ''} />
      <input type="hidden" name="side" value={side} />

      <div className="flip-field">
        <label htmlFor="side-toggle">Side</label>
        <div className="side-toggle" id="side-toggle">
          <button
            type="button"
            className={side === 'buy' ? 'on buy' : ''}
            onClick={() => setSide('buy')}
            aria-pressed={side === 'buy'}
          >
            Buy
          </button>
          <button
            type="button"
            className={side === 'sell' ? 'on sell' : ''}
            onClick={() => {
              setSide('sell');
              setAlsoSell(false);
            }}
            aria-pressed={side === 'sell'}
          >
            Sell
          </button>
        </div>
      </div>

      <div className="flip-field wide">
        <label htmlFor="item-search">Item</label>
        <input
          id="item-search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Start typing a name"
          value={picked ? picked.name : query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
        {matches.length > 0 && !picked && (
          <ul className="picker" role="listbox">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setPicked(m);
                    setMatches([]);
                  }}
                >
                  <span>{m.name}</span>
                  <span className="subtle">
                    {m.low === null ? 'no price' : `${formatGp(m.low)} / ${formatGp(m.high ?? 0)}`}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flip-field">
        <label htmlFor="quantity">Quantity</label>
        <input id="quantity" name="quantity" inputMode="numeric" defaultValue="1" required />
      </div>

      <div className="flip-field">
        <label htmlFor="price">Price each</label>
        <input
          id="price"
          name="price"
          key={suggested ?? 'none'}
          defaultValue={suggested ? String(suggested) : ''}
          placeholder="1.5m"
          required
          autoComplete="off"
        />
      </div>

      <div className="flip-field">
        <label htmlFor="executedAt">When</label>
        <input id="executedAt" name="executedAt" type="datetime-local" />
      </div>

      <div className="flip-field wide">
        <label htmlFor="note">Note</label>
        <input id="note" name="note" maxLength={120} placeholder="optional" autoComplete="off" />
      </div>

      {side === 'buy' && (
        <div className="flip-field wide ticket-close">
          <label className="ticket-opt">
            <input
              type="checkbox"
              checked={alsoSell}
              onChange={(e) => setAlsoSell(e.target.checked)}
            />
            <span>
              Also record the sell <span className="subtle">— optional</span>
            </span>
          </label>
          {alsoSell ? (
            <div className="ticket-close-row">
              <label htmlFor="closePrice">Sold at</label>
              <input
                id="closePrice"
                name="closePrice"
                placeholder={picked?.high ? String(picked.high) : '1.6m'}
                autoComplete="off"
                inputMode="numeric"
              />
              <span className="subtle">
                Written as its own fill a second after the buy, with tax taken off. If you already
                hold this item, FIFO closes your <em>oldest</em> lot — so the realised figure may
                not be this pair.
              </span>
            </div>
          ) : (
            <p className="subtle ticket-opt-hint">
              Leave this off to hold the position. You can sell any part of it later from{' '}
              <strong>Positions</strong>, or never — an open position is not a loose end.
            </p>
          )}
        </div>
      )}

      <div className="flip-field">
        <button type="submit" disabled={pending || !picked}>
          {pending ? 'Saving…' : alsoSell ? 'Record buy and sell' : `Record ${side}`}
        </button>
      </div>

      <p className="subtle flip-hint">
        One fill per row — log each buy separately rather than combining them, or the average cost
        will be wrong. Leave &ldquo;when&rdquo; blank for now. Prices accept 1.5m, 250k or 1500000.
      </p>

      {note && (
        <p className={note.ok ? 'ok' : 'error'} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}
