import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import SignInForm from './form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: `Sign in to ${SITE.name} to track your accounts, log flips and set price alerts.`,
  robots: { index: false, follow: false },
};

/** Where a sign-in lands when nothing else was asked for. */
const DEFAULT_TARGET = '/accounts';

/**
 * Only same-site relative paths are allowed as a redirect target.
 *
 * `next` arrives from the query string, so without this an attacker could
 * send someone a sign-in link that bounces them to another domain carrying
 * the trust of having just logged in here.
 */
function safeNext(next?: string): string {
  if (!next) return DEFAULT_TARGET;
  if (!next.startsWith('/') || next.startsWith('//')) return DEFAULT_TARGET;
  return next;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <main className="plain-page">
      <h1>Sign in to {SITE.name}</h1>
      <p>
        Enter your email and we&rsquo;ll send you a link. No password to remember, nothing to reset.
      </p>
      <SignInForm callbackURL={safeNext(next)} />
      <p className="muted">
        The flip finder and item pages work without an account. You need one to track a RuneScape
        name, save a cash stack, log flips or set price alerts.
      </p>
    </main>
  );
}
