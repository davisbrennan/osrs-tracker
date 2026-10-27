'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { deleteAlert, toggleAlert } from '@/app/actions/alerts';

/** Pause or delete. Pausing keeps the setup, which is usually what's wanted. */
export default function AlertRowActions({ id, active }: { id: string; active: boolean }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  return (
    <span className="acct-actions">
      {confirming ? (
        <>
          <button
            type="button"
            className="danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await deleteAlert(id);
                setConfirming(false);
                router.refresh();
              })
            }
          >
            Delete
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await toggleAlert(id);
                router.refresh();
              })
            }
          >
            {active ? 'Pause' : 'Resume'}
          </button>
          <button type="button" onClick={() => setConfirming(true)}>
            Remove
          </button>
        </>
      )}
    </span>
  );
}
