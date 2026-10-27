'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchItems, type ItemMatch } from '@/app/actions/trades';
import { createAlert } from '@/app/actions/alerts';
import { MIN_COOLDOWN_MINUTES } from '@/lib/osrs/constants';
import { formatGp, marginPerUnit } from '@/lib/osrs/ge';

type Kind = 'price' | 'margin' | 'unusual';

/**
 * Setting an alert.
 *
 * The form changes shape with the kind, because the three ask for genuinely
 * different things. A single "threshold" box with a label that swaps between
 * gp and a percentage is the sort of economy that produces alerts nobody
 * meant to set.
 */
export default function AlertForm({ presetItem }: { presetItem?: ItemMatch }) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>('unusual');
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [picked, setPicked] = useState<ItemMatch | null>(presetItem ?? null);
  const [threshold, setThreshold] = useState('90');
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

  function pickKind(next: Kind) {
    setKind(next);
    // The threshold means something different per kind, so carrying the old
    // value across would set a 90gp price alert on switching away from a
    // 90th-percentile one.
    setThreshold(next === 'unusual' ? '90' : '');
  }

  const liveMargin =
    picked?.low != null && picked?.high != null
      ? marginPerUnit(picked.low, picked.high, picked.id)
      : null;

  return (
    <form
      ref={formRef}
      className="flip-form"
      action={(formData) =>
        start(async () => {
          const result = await createAlert(formData);
          setNote({ text: result.ok ? result.message : result.error, ok: result.ok });
          if (result.ok) {
            formRef.current?.reset();
            setQuery('');
            setPicked(presetItem ?? null);
            setMatches([]);
            setKind('unusual');
            setThreshold('90');
            router.refresh();
          }
        })
      }
    >
      <input type="hidden" name="itemId" value={picked?.id ?? ''} />
      <input type="hidden" name="kind" value={kind} />

      <div className="flip-field wide">
        <label htmlFor="alert-kind">Tell me when</label>
        <div className="side-toggle" id="alert-kind">
          <button
            type="button"
            className={kind === 'unusual' ? 'on buy' : ''}
            onClick={() => pickKind('unusual')}
            aria-pressed={kind === 'unusual'}
          >
            The margin goes unusual
          </button>
          <button
            type="button"
            className={kind === 'margin' ? 'on buy' : ''}
            onClick={() => pickKind('margin')}
            aria-pressed={kind === 'margin'}
          >
            The margin hits a number
          </button>
          <button
            type="button"
            className={kind === 'price' ? 'on buy' : ''}
            onClick={() => pickKind('price')}
            aria-pressed={kind === 'price'}
          >
            The price hits a number
          </button>
        </div>
      </div>

      <div className="flip-field wide">
        <label htmlFor="alert-item">Item</label>
        <input
          id="alert-item"
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

      {kind === 'unusual' ? (
        <div className="flip-field">
          <label htmlFor="threshold">Percentile</label>
          <input
            id="threshold"
            name="threshold"
            inputMode="numeric"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            required
          />
        </div>
      ) : (
        <>
          <div className="flip-field">
            <label htmlFor="direction">Direction</label>
            <select id="direction" name="direction" defaultValue={kind === 'margin' ? 'above' : 'below'}>
              <option value="below">Falls to or below</option>
              <option value="above">Rises to or above</option>
            </select>
          </div>
          <div className="flip-field">
            <label htmlFor="threshold">{kind === 'margin' ? 'Margin' : 'Price'}</label>
            <input
              id="threshold"
              name="threshold"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              placeholder="1.5m"
              required
              autoComplete="off"
            />
          </div>
          {kind === 'price' && (
            <div className="flip-field">
              <label htmlFor="priceSide">Which price</label>
              <select id="priceSide" name="priceSide" defaultValue="low">
                <option value="low">Buy at (instant-sell)</option>
                <option value="high">Sell at (instant-buy)</option>
              </select>
            </div>
          )}
        </>
      )}

      <div className="flip-field">
        <label htmlFor="cooldownMinutes">Then wait</label>
        <select id="cooldownMinutes" name="cooldownMinutes" defaultValue="360">
          <option value={String(MIN_COOLDOWN_MINUTES)}>30 minutes</option>
          <option value="120">2 hours</option>
          <option value="360">6 hours</option>
          <option value="1440">A day</option>
        </select>
      </div>

      <div className="flip-field">
        <button type="submit" disabled={pending || !picked}>
          {pending ? 'Saving…' : 'Set alert'}
        </button>
      </div>

      <p className="subtle flip-hint">
        {kind === 'unusual' ? (
          <>
            Fires when the margin is wider than that share of the item&rsquo;s own last 90 days —
            no number to pick, and it stays meaningful as the item drifts. It needs 20 days of
            history before it can say anything, and it will not fire on a margin that does not
            survive the tax, however historically wide it is.
          </>
        ) : kind === 'margin' ? (
          <>
            Fires on the margin <strong>after</strong> the 2% sale tax, which is the only margin
            worth watching.
            {liveMargin !== null && <> {picked?.name} is at {formatGp(liveMargin)} right now.</>}
          </>
        ) : (
          <>
            A fixed price. Simple, but a threshold that made sense in March is noise by June —
            the other two kinds move with the item.
          </>
        )}
      </p>

      {note && (
        <p className={note.ok ? 'ok' : 'error'} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}
