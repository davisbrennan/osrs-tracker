'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleWatch } from '@/app/actions/watchlist';

/**
 * Follow an item.
 *
 * Optimistic on the label but not on the truth: the server returns the state
 * it actually wrote, and that is what the button ends up showing. A toggle
 * that lies about having saved is worse than one that takes a moment.
 */
export default function WatchButton({
  itemId,
  initial,
  signedIn,
}: {
  itemId: number;
  initial: boolean;
  signedIn: boolean;
}) {
  const router = useRouter();
  const [watching, setWatching] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!signedIn) return null;

  return (
    <>
      <button
        type="button"
        className={`watch-btn${watching ? ' on' : ''}`}
        aria-pressed={watching}
        disabled={pending}
        onClick={() =>
          start(async () => {
            setError(null);
            const r = await toggleWatch(itemId);
            if (r.ok) {
              setWatching(r.watching);
              router.refresh();
            } else {
              setError(r.error);
            }
          })
        }
      >
        <span aria-hidden="true">{watching ? '★' : '☆'}</span>
        {watching ? 'Watching' : 'Watch'}
      </button>
      {error && <span className="error">{error}</span>}
    </>
  );
}
