import Link from 'next/link';
import type { Metadata } from 'next';
import { GUIDES, guideWords } from '@/lib/guides';
import { SITE } from '@/lib/site';
import { currentUser, cashStackFor } from '@/lib/session';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  alternates: { canonical: '/guides' },
  title: 'Guides',
  description:
    'How the Grand Exchange tax actually works, how to read a margin, what buy limits do to your profit, and what price to offer. Written for Old School RuneScape flippers.',
};

export default async function Guides() {
  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);

  return (
    <AppShell current="guides" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>Guides</h1>
      <p className="lede">
        The arithmetic behind the numbers on the rest of {SITE.name}, written out properly. Mostly
        things I had to work out while building the tax and margin code, and which are easier to
        find here than scattered across a forum thread.
      </p>

      <ul className="guide-list">
        {GUIDES.map((g) => (
          <li key={g.slug}>
            <Link href={`/guides/${g.slug}`} className="guide-card">
              <h2>{g.title}</h2>
              <p>{g.summary}</p>
              <span className="guide-meta">
                {g.minutes} min read · {guideWords(g).toLocaleString('en-US')} words
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </AppShell>
  );
}
