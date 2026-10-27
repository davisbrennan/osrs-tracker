'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { addFlip, searchItems, type ItemMatch } from '@/app/actions/flips';
import { formatGp } from '@/lib/osrs/ge';

/**
 * Logging a flip.
 *
 * The item picker searches server-side rather than shipping a 4,000-item list
 * to the browser, and shows each result's current price — which doubles as
 * confirmation you picked the right "Rune scimitar" out of the several that
 * share most of a name.
 */
export default function FlipForm() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [picked, setPicked] = useState<ItemMatch | null>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onQueryChange(value: string) {
    setQuery(value);
    setPicked(null);
    if (debounce.current) clearTimeout(debounce.current);
    // Debounced, because a query per keystroke is a query per keystroke.
    debounce.current = setTimeout(async () => {
      setMatches(value.trim().length < 2 ? [] : await searchItems(value));
    }, 180);
  }

  return (
    <form
      ref={formRef}
      className="flip-form"
      action={(formData) =>
        start(async () => {
          const result = await addFlip(formData);
          setNote({ text: result.ok ? result.message : result.error, ok: result.ok });
          if (result.ok) {
            formRef.current?.reset();
            setQuery('');
            setPicked(null);
            setMatches([]);
            router.refresh();
          }
        })
      }
    >
      <input type="hidden" name="itemId" value={picked?.id ?? ''} />

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
                    {m.low === null ? 'no price' : `buy ${formatGp(m.low)}`}
                    {m.members ? ' · members' : ''}
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
        <label htmlFor="buyPrice">Bought at</label>
        <input id="buyPrice" name="buyPrice" placeholder="1.5m" required autoComplete="off" />
      </div>

      <div className="flip-field">
        <label htmlFor="sellPrice">Sold at</label>
        <input id="sellPrice" name="sellPrice" placeholder="optional" autoComplete="off" />
      </div>

      <div className="flip-field wide">
        <label htmlFor="note">Note</label>
        <input id="note" name="note" maxLength={120} placeholder="optional" autoComplete="off" />
      </div>

      <div className="flip-field">
        <button type="submit" disabled={pending || !picked}>
          {pending ? 'Saving…' : 'Log it'}
        </button>
      </div>

      <p className="subtle flip-hint">
        Leave &ldquo;sold at&rdquo; blank to record an open position. Prices accept 1.5m, 250k or
        1500000.
      </p>

      {note && (
        <p className={note.ok ? 'ok' : 'error'} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}
