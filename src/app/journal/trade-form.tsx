'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import {
  addTrade,
  searchItems,
  itemContext,
  type ItemMatch,
  type ItemContext,
} from '@/app/actions/trades';
import { formatGp, geTax, parseGp } from '@/lib/osrs/ge';
import { formatResetIn } from '@/lib/osrs/limits';

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
  // What the order would do, recomputed as you type. The arithmetic is the
  // same pure geTax the server uses, so the preview cannot disagree with
  // what gets written.
  const [qty, setQty] = useState('1');
  const [priceText, setPriceText] = useState('');
  const [closeText, setCloseText] = useState('');
  const [context, setContext] = useState<ItemContext | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    setPicked(null);
    setContext(null);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setMatches(value.trim().length < 2 ? [] : await searchItems(value));
    }, 180);
  }

  /** The price you'd most likely be filling at, as a starting point. */
  const suggested = picked ? (side === 'buy' ? picked.low : picked.high) : null;

  /* ------------------------------------------------------------------ preview
     What this order does, before it is committed. Every figure comes from the
     same pure functions the server action calls, so the preview and the stored
     row cannot disagree — the alternative is a second implementation of the
     tax rule that drifts. */
  const q = Number(qty);
  const unit = parseGp(priceText);
  const closeUnit = closeText.trim() ? parseGp(closeText) : null;
  const liveQty = Number.isInteger(q) && q > 0 ? q : null;
  const preview =
    picked && liveQty !== null && unit !== null && unit >= 0
      ? (() => {
          const gross = unit * liveQty;
          const tax = side === 'sell' ? geTax(unit, picked.id) * liveQty : 0;
          const net = gross - tax;
          // Against the lots currently open — which is what FIFO will match.
          const basis =
            side === 'sell' && context?.avgCost != null
              ? Math.round(context.avgCost) * liveQty
              : null;
          const roundTrip =
            side === 'buy' && closeUnit !== null && closeUnit >= 0
              ? closeUnit * liveQty - geTax(closeUnit, picked.id) * liveQty - gross
              : null;
          return { gross, tax, net, pnl: basis === null ? null : net - basis, roundTrip };
        })()
      : null;

  /* Buying more than the four-hour window allows is the commonest way a
     planned fill silently does not happen. Say so before it is recorded. */
  const overLimit =
    side === 'buy' &&
    liveQty !== null &&
    context?.limitRemaining != null &&
    liveQty > context.limitRemaining;

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
            setQty('1');
            setPriceText('');
            setCloseText('');
            setContext(null);
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
            onClick={() => {
              setSide('buy');
              if (picked?.low) setPriceText(String(picked.low));
            }}
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
              if (picked?.high) setPriceText(String(picked.high));
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
                    setPriceText(String((side === 'buy' ? m.low : m.high) ?? ''));
                    start(async () => setContext(await itemContext(m.id)));
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
        <input
          id="quantity"
          name="quantity"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          required
        />
      </div>

      <div className="flip-field">
        <label htmlFor="price">Price each</label>
        <input
          id="price"
          name="price"
          value={priceText}
          onChange={(e) => setPriceText(e.target.value)}
          placeholder={suggested ? String(suggested) : '1.5m'}
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
                value={closeText}
                onChange={(e) => setCloseText(e.target.value)}
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

      {picked && (
        <div className="flip-field wide ticket-preview">
          {preview ? (
            <dl className="prev-row">
              <div>
                <dt>{side === 'buy' ? 'Total cost' : 'Gross'}</dt>
                <dd>
                  <span className="num">{formatGp(preview.gross)}</span>
                </dd>
              </div>
              {side === 'sell' && (
                <>
                  <div>
                    <dt>GE tax</dt>
                    <dd>
                      <span className="num pl-down">−{formatGp(preview.tax)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>You receive</dt>
                    <dd>
                      <span className="num">{formatGp(preview.net)}</span>
                    </dd>
                  </div>
                </>
              )}
              {preview.pnl !== null && (
                <div>
                  <dt>P&amp;L vs your {context?.avgCost ? formatGp(Math.round(context.avgCost)) : ''} cost</dt>
                  <dd>
                    <span className={preview.pnl >= 0 ? 'num pl-up' : 'num pl-down'}>
                      {formatGp(preview.pnl)}
                    </span>
                  </dd>
                </div>
              )}
              {preview.roundTrip !== null && (
                <div>
                  <dt>Round trip, after tax</dt>
                  <dd>
                    <span className={preview.roundTrip >= 0 ? 'num pl-up' : 'num pl-down'}>
                      {formatGp(preview.roundTrip)}
                    </span>
                  </dd>
                </div>
              )}
            </dl>
          ) : (
            <p className="subtle">Enter a quantity and a price to price the order.</p>
          )}

          {context && (
            <p className={overLimit ? 'error prev-limit' : 'subtle prev-limit'}>
              {context.buyLimit === null
                ? 'No buy limit published for this item.'
                : overLimit
                  ? `Over the four-hour limit — ${context.limitRemaining?.toLocaleString('en-US')} of ${context.buyLimit.toLocaleString('en-US')} left${
                      formatResetIn(context.resetsInMs)
                        ? `, resetting in ${formatResetIn(context.resetsInMs)}`
                        : ''
                    }. You can still record it; the game may not have let you buy it all at once.`
                  : `${context.limitRemaining?.toLocaleString('en-US')} of ${context.buyLimit.toLocaleString('en-US')} left in the four-hour window${
                      formatResetIn(context.resetsInMs)
                        ? `, resetting in ${formatResetIn(context.resetsInMs)}`
                        : ''
                    }.`}
              {context.quantity > 0 &&
                ` You hold ${context.quantity.toLocaleString('en-US')} at ${formatGp(Math.round(context.avgCost ?? 0))} average.`}
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
