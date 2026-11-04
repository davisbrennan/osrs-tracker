import Link from 'next/link';
import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import { LEGAL } from '@/lib/legal';
import { currentUser, cashStackFor } from '@/lib/session';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  alternates: { canonical: '/contact' },
  title: 'Contact',
  description: `How to reach the person who runs ${SITE.name} — bug reports, wrong numbers, data removal and everything else.`,
};

export default async function Contact() {
  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);

  return (
    <AppShell current="about" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>Contact</h1>
      <p className="lede">
        One person reads this, usually within a day or two. There is no support team and no ticket
        system, which means a real reply rather than a form response.
      </p>

      <p className="contact-email">
        <a href={`mailto:${LEGAL.contactEmail}`}>{LEGAL.contactEmail}</a>
      </p>

      <h2>What is most useful to send</h2>
      <ul>
        <li>
          <strong>A number that looks wrong.</strong> The most valuable thing anyone sends me. The
          item and what you expected is enough — I can find the rest. Several real bugs have come in
          this way, including items disappearing from the catalogue entirely.
        </li>
        <li>
          <strong>Something that should be here and is not.</strong> Most of what the site does
          started as somebody wanting it, me included.
        </li>
        <li>
          <strong>A page that is broken or unreadable</strong> on your browser or phone. Say which,
          because I can only test so many.
        </li>
      </ul>

      <h2>Your data</h2>
      <p>
        If you want your account and everything attached to it deleted, you can do it yourself from{' '}
        <Link href="/settings">settings</Link> — it removes your tracked accounts, logged trades,
        watchlist and alerts along with the account itself. If you would rather I did it, email the
        address above from the address you signed up with and I will confirm when it is done.
      </p>
      <p>
        What the site stores and who else touches it is set out in the{' '}
        <Link href="/privacy">privacy policy</Link>.
      </p>

      <h2>What I cannot help with</h2>
      <p>
        Anything to do with your actual RuneScape account — bans, appeals, recoveries, lost items,
        or trades that went wrong in game. {SITE.name} is an independent fan project with no
        connection to Jagex and no visibility into your account beyond the public hiscores. Those go
        to Jagex support.
      </p>
      <p>
        I will also never ask for your RuneScape password, and nobody emailing you from this site
        ever will. The only email {SITE.name} sends unprompted is a price alert you set up yourself.
      </p>
    </AppShell>
  );
}
