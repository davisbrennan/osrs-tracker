import Link from 'next/link';
import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import { LEGAL } from '@/lib/legal';
import { currentUser, cashStackFor } from '@/lib/session';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  alternates: { canonical: '/about' },
  title: 'About',
  description: `Who builds ${SITE.name}, where the numbers come from, and why it works the way it does.`,
};

export default async function About() {
  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);

  return (
    <AppShell current="about" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>About {SITE.name}</h1>
      <p className="lede">
        A Grand Exchange flipping tracker and progress tracker for Old School RuneScape, built and
        run by one person as a hobby project.
      </p>

      <h2>Why it exists</h2>
      <p>
        I came back to Old School RuneScape after a long time away and started flipping on the
        Grand Exchange to rebuild a stack. The tools I found all had the same shape: a table of
        margins sorted by size, with the biggest numbers at the top. I lost money following them.
      </p>
      <p>
        The margins were real. What the tables left out was everything that decides whether you can
        actually capture one — whether the item trades often enough for your offer to fill, whether
        the two prices being compared were even from the same hour, whether your cash stack could
        afford a single unit, and what the 2% sale tax does to the gap once you get there. A
        500,000gp margin on something that trades eight times a day is not an opportunity. It is a
        way to have your gp tied up in the thing you understood least.
      </p>
      <p>
        So this started as a spreadsheet for my own trading and turned into a site. Everything on it
        exists because the absence of it cost me something.
      </p>

      <h2>What it does differently</h2>
      <ul>
        <li>
          <strong>Profit is capped by reality.</strong> Every margin is multiplied by the units you
          could actually buy — limited by the item&rsquo;s four-hour buy limit and by your own cash
          stack — rather than presented per unit and left to you.
        </li>
        <li>
          <strong>Tax is built in, not bolted on.</strong> The 2% is floored, free under 50gp and
          capped at 5m per item, which makes the arithmetic non-obvious in both directions. Every
          figure here is after tax, and the breakeven sell price is shown alongside.
        </li>
        <li>
          <strong>Every margin carries a confidence.</strong> Trade volume and price age ride
          alongside the number, and thin or stale books are labelled as such instead of being sorted
          to the top.
        </li>
        <li>
          <strong>It says what it cannot know.</strong> The Grand Exchange does not publish order
          book depth to anybody outside Jagex, so no public tool can tell you whether an offer will
          fill. This one says so rather than implying otherwise.
        </li>
      </ul>

      <h2>Where the numbers come from</h2>
      <p>
        Prices and trade volumes come from the{' '}
        <a href="https://prices.runescape.wiki/" target="_blank" rel="noopener noreferrer nofollow">
          OSRS Wiki real-time price API
        </a>
        , polled every five minutes, with hourly snapshots kept for ninety days so you can see
        whether a margin has actually held. Account progress comes from Jagex&rsquo;s public
        hiscores. Both are public sources that anyone could read themselves; nothing here connects
        to the game client or automates anything.
      </p>
      <p>
        The tax rules, buy limits and experience curves are implemented from public documentation
        and checked against more than one source. They can still be wrong or go out of date — if a
        number here disagrees with the game, the game is right, and I&rsquo;d like to hear about it.
      </p>

      <h2>Who runs it</h2>
      <p>
        One person, in {LEGAL.jurisdiction}. It is not a company and there is no team. It runs on a
        single server I pay for, and it is free to use — the ads on the public pages cover the
        hosting.
      </p>
      <p>
        If something is broken, wrong, or missing, <Link href="/contact">get in touch</Link>. Bug
        reports about a number being wrong are the most useful thing anyone sends me.
      </p>

      <h2>Not affiliated with Jagex</h2>
      <p>
        {SITE.name} is an independent fan project. It is not created by, affiliated with, or
        endorsed by Jagex Ltd. Old School RuneScape is a trademark of Jagex Ltd.
      </p>
    </AppShell>
  );
}
