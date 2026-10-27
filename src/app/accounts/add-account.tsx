'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addAccount } from '@/app/actions/accounts';
import { ACCOUNT_TYPES } from '@/lib/osrs/constants';

export default function AddAccount({ remaining }: { remaining: number }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="row-form"
      action={(formData) =>
        start(async () => {
          setError(null);
          const result = await addAccount(formData);
          if (result.ok) {
            // Clearing the field matters: leaving the name in place after a
            // success makes it look like it didn't take.
            (document.getElementById('rsn') as HTMLInputElement | null)?.setAttribute('value', '');
            router.refresh();
          } else {
            setError(result.error);
          }
        })
      }
    >
      <input
        id="rsn"
        name="rsn"
        maxLength={12}
        required
        autoComplete="off"
        spellCheck={false}
        placeholder="RuneScape name"
        aria-label="RuneScape name"
      />
      <select name="accountType" aria-label="Account type" defaultValue="main">
        {ACCOUNT_TYPES.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label}
          </option>
        ))}
      </select>
      <button type="submit" disabled={pending}>
        {pending ? 'Checking the hiscores…' : 'Track this account'}
      </button>
      <span className="subtle">
        {remaining} slot{remaining === 1 ? '' : 's'} left
      </span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
