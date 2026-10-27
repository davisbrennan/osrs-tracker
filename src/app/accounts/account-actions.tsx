'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { refreshAccount, removeAccount } from '@/app/actions/accounts';

export default function AccountActions({ accountId, rsn }: { accountId: string; rsn: string }) {
  const router = useRouter();
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [pending, start] = useTransition();

  function run(fn: () => Promise<{ ok: boolean; message?: string; error?: string }>) {
    start(async () => {
      const r = await fn();
      setNote({ text: r.ok ? (r.message ?? 'Done') : (r.error ?? 'Failed'), ok: r.ok });
      router.refresh();
    });
  }

  return (
    <div className="acct-actions">
      <button type="button" disabled={pending} onClick={() => run(() => refreshAccount(accountId))}>
        {pending ? '…' : 'Refresh'}
      </button>

      {/* Two-step, because removing an account deletes its whole snapshot
          history and there is no undo. A single click next to "Refresh"
          would be a trap. */}
      {confirming ? (
        <>
          <button
            type="button"
            className="danger"
            disabled={pending}
            onClick={() => run(() => removeAccount(accountId))}
          >
            Delete {rsn} and its history
          </button>
          <button type="button" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" onClick={() => setConfirming(true)}>
          Remove
        </button>
      )}

      {note && (
        <span className={note.ok ? 'ok' : 'error'} role="status">
          {note.text}
        </span>
      )}
    </div>
  );
}
