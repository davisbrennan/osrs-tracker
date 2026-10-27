'use client';

import { useState, useTransition, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { searchItems, type ItemMatch } from '@/app/actions/trades';
import { toggleWatch } from '@/app/actions/watchlist';
import { formatGp } from '@/lib/osrs/ge';

/**
 * Add to the board without leaving it.
 *
 * Without this, building a watchlist means visiting an item page per item,
 * which is the kind of friction that stops a feature getting used at all.
 */
export default function AddItem() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<ItemMatch[]>([]);
  const [note, setNote] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(value: string) {
    setQuery(value);
    if (debounce.current) clearTimeout(debounce.current);
    debounce.current = setTimeout(async () => {
      setMatches(value.trim().length < 2 ? [] : await searchItems(value));
    }, 180);
  }

  return (
    <form className="toolbar watch-add" onSubmit={(e) => e.preventDefault()}>
      <div className="watch-add-field">
        <label className="sr-only" htmlFor="watch-search">
          Find an item to watch
        </label>
        <input
          id="watch-search"
          type="search"
          autoComplete="off"
          spellCheck={false}
          placeholder="Add an item to the board"
          value={query}
          onChange={(e) => onChange(e.target.value)}
        />
        {matches.length > 0 && (
          <ul className="picker" role="listbox">
            {matches.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const r = await toggleWatch(m.id);
                      setQuery('');
                      setMatches([]);
                      setNote(
                        r.ok
                          ? r.watching
                            ? `Watching ${m.name}.`
                            : `Stopped watching ${m.name}.`
                          : r.error
                      );
                      router.refresh();
                    })
                  }
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
      {note && (
        <p className="toolbar-note" role="status">
          {note}
        </p>
      )}
    </form>
  );
}
