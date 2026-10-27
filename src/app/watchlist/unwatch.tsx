'use client';

import { useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toggleWatch } from '@/app/actions/watchlist';

/** Drop one row from the board. */
export default function Unwatch({ itemId }: { itemId: number }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      title="Stop watching"
      onClick={() =>
        start(async () => {
          await toggleWatch(itemId);
          router.refresh();
        })
      }
    >
      Remove
    </button>
  );
}
