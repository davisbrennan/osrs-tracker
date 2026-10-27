'use client';

import { useState, useTransition } from 'react';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import { parseGp, formatGp } from '@/lib/osrs/ge';
import { saveCashStack } from '@/app/actions/settings';

/**
 * The cash stack input.
 *
 * It lives in the URL as ?cash=, not only in component state, for two
 * reasons: the flip table is rendered on the server so it needs the value at
 * request time, and a repriced table stays linkable — you can send someone
 * "here is what 50m looks like" and they see the same thing.
 *
 * For signed-in people it is also persisted, so the stack survives a new tab
 * without a query string. Signed-out visitors get the URL only, which is why
 * the finder works at all without an account.
 */
export default function CashStack({ value, signedIn }: { value: number; signedIn: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [raw, setRaw] = useState(() => formatGp(value));
  const [pending, start] = useTransition();

  function apply() {
    const parsed = parseGp(raw);
    // Unparseable input snaps back rather than silently repricing to zero,
    // which would empty the table and look like a bug in the data.
    if (parsed === null || parsed < 0) {
      setRaw(formatGp(value));
      return;
    }

    const next = new URLSearchParams(params.toString());
    next.set('cash', String(parsed));
    // Page 1 again: the row you were looking at is not on page 3 of a
    // differently-priced table.
    next.delete('page');

    start(async () => {
      if (signedIn) await saveCashStack(parsed);
      router.push(`${pathname}?${next.toString()}`);
    });
  }

  return (
    <form
      className="cash-stack"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <label htmlFor="cash-stack">Cash stack</label>
      <input
        id="cash-stack"
        name="cash"
        value={raw}
        inputMode="text"
        autoComplete="off"
        spellCheck={false}
        aria-label="Your cash stack in gp"
        onChange={(e) => setRaw(e.target.value)}
        onBlur={apply}
      />
      <button type="submit" disabled={pending}>
        {pending ? 'Pricing…' : 'Apply'}
      </button>
    </form>
  );
}
