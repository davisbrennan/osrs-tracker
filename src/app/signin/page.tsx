import type { Metadata } from 'next';
import SignInForm from './form';

export const metadata: Metadata = {
  title: 'Sign in',
  description: 'Sign in to your wedding planning workspace.',
  robots: { index: false, follow: false },
};

/** Only allow same-site relative paths as a redirect target. */
function safeNext(next?: string): string {
  if (!next) return '/dashboard';
  if (!next.startsWith('/') || next.startsWith('//')) return '/dashboard';
  return next;
}

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; b?: string; g?: string; d?: string }>;
}) {
  const { next, b, g, d } = await searchParams;

  // Numbers carried over from the public budget calculator: keep them through
  // the email round trip so onboarding can prefill.
  const carry = new URLSearchParams();
  if (b && /^\d{1,9}$/.test(b)) carry.set('b', b);
  if (g && /^\d{1,4}$/.test(g)) carry.set('g', g);
  if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) carry.set('d', d);
  const target = next ?? (carry.toString() ? `/onboarding?${carry}` : '/dashboard');

  return (
    <main className="plain-page">
      <h1>Sign in</h1>
      <p>Enter your email and we’ll send you a link. No password to remember, nothing to reset.</p>
      <SignInForm callbackURL={safeNext(target)} />
    </main>
  );
}
