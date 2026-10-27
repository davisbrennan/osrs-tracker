import Link from 'next/link';
import type { Metadata } from 'next';
import { LEGAL } from '@/lib/legal';
import { SITE } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Terms',
  description: `The terms of using ${SITE.name}.`,
};

export default function Terms() {
  return (
    <main className="page-wrap legal">
      <h1>Terms</h1>
      <p className="updated">Last updated {LEGAL.lastUpdated}</p>

      <p>
        {SITE.name} is a free hobby project. These terms are short because the arrangement is
        simple: you can use it, it comes with no promises, and the numbers are a tool rather than
        advice.
      </p>

      <h2>The numbers are estimates</h2>
      <p>
        Prices come from the OSRS Wiki&rsquo;s API and describe trades that have already happened.
        They are not quotes, and the Grand Exchange does not guarantee you a fill at any of them. A
        margin shown here can vanish between you reading it and your offer completing, and thin
        books are exactly where that happens — which is why every row carries a confidence rating.
        Decisions about your own gp are yours.
      </p>
      <p>
        The tax rules, buy limits and experience curves are implemented from public documentation
        and checked against more than one source, but Jagex changes the game and this site can be
        wrong or out of date. If a number here disagrees with the game, the game is right.
      </p>

      <h2>No affiliation with Jagex</h2>
      <p>
        This is an unofficial fan tool. It is not affiliated with, endorsed by or connected to Jagex
        Ltd. &ldquo;Old School RuneScape&rdquo; and &ldquo;RuneScape&rdquo; are trademarks of Jagex.
        It reads public price data and public hiscores and nothing else — it does not connect to the
        game, interact with your client, or automate play, and using it does not put your game
        account at risk.
      </p>

      <h2>Your account</h2>
      <ul>
        <li>Keep access to your email address, since that is how you sign in.</li>
        <li>
          Do not use the site to attack it or anything it talks to: no scraping it at volume, no
          automated hammering of the hiscores through it, no trying to reach other people&rsquo;s
          data.
        </li>
        <li>
          Tracking limits exist so that one person cannot turn a free public service into a problem.
          Do not work around them.
        </li>
        <li>
          Accounts that do any of the above get removed, usually without a conversation first.
        </li>
      </ul>

      <h2>Availability</h2>
      <p>
        One server, one person, no uptime commitment. It may go down, lose recent data between
        backups, or stop existing. Nothing here should be the only copy of something you care about.
      </p>

      <h2>Liability</h2>
      <p>
        The site is provided as-is, without warranty of any kind. To the extent the law allows, it
        is not liable for losses arising from using it — including gp lost on a trade. It is free,
        and it is a hobby.
      </p>

      <h2>Changes</h2>
      <p>
        These terms may change. The date at the top says when they last did. Continuing to use the
        site means the current version applies.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL.entity}, {LEGAL.jurisdiction} — {LEGAL.contactEmail}. Governed by the laws of{' '}
        {LEGAL.jurisdiction}.
      </p>

      <p className="updated">
        <Link href="/">Back to {SITE.name}</Link>
      </p>
    </main>
  );
}
