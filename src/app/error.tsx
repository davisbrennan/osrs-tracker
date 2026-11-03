'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * What a visitor sees when a page cannot be built.
 *
 * Before this existed, a page whose data was unreachable rendered Next's
 * own error output: a blank screen with a script tag in it. Three of the
 * four price pages did that with the database stopped, which told the
 * visitor nothing and told me nothing either.
 *
 * It deliberately does not say "something went wrong and we're looking
 * into it", because nobody is looking into it at three in the morning.
 * It says what is probably true — the data is unreachable — and offers
 * the pages that do not need it.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // The digest is what ties this to a line in the container log.
    console.error('[page error]', error.digest ?? '(no digest)', error.message);
  }, [error]);

  return (
    <div className="notice-page">
      <h1>This page can&rsquo;t load right now</h1>
      <p>
        Almost always this means the price data is temporarily unreachable rather than anything
        being wrong with your account. Nothing of yours has changed — tracked accounts, flips and
        alerts are all where you left them.
      </p>
      <p>
        <button type="button" onClick={reset}>
          Try again
        </button>
      </p>
      <p className="subtle">
        Pages that don&rsquo;t need live prices: <Link href="/news">news</Link>,{' '}
        <Link href="/privacy">privacy</Link>, <Link href="/terms">terms</Link>.
        {error.digest && <> Reference: {error.digest}.</>}
      </p>
    </div>
  );
}
