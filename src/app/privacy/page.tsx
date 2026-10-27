import Link from 'next/link';
import type { Metadata } from 'next';
import { LEGAL } from '@/lib/legal';
import { SITE } from '@/lib/site';
import { HISTORY_RETENTION_DAYS } from '@/lib/osrs/jobs/sync-prices';

export const metadata: Metadata = {
  title: 'Privacy',
  description: `What ${SITE.name} stores, what it does not, and who else touches it.`,
};

export default function Privacy() {
  return (
    <main className="page-wrap legal">
      <h1>Privacy</h1>
      <p className="updated">Last updated {LEGAL.lastUpdated}</p>

      <p>
        {SITE.name} is a hobby project run by one person. This page says what it stores and what it
        does not, in the order you would want to know it.
      </p>

      <h2>What it stores about you</h2>
      <ul>
        <li>
          <strong>Your email address</strong>, because sign-in works by emailing you a link. There
          is no password.
        </li>
        <li>
          <strong>A display name</strong>, if you set one.
        </li>
        <li>
          <strong>Your cash stack</strong>, the RuneScape names you choose to track, the flips you
          log and the price alerts you create.
        </li>
        <li>
          <strong>A session cookie</strong> so you stay signed in.
        </li>
      </ul>

      <p>
        There is no analytics script, no advertising, no tracking pixel and no third-party
        JavaScript of any kind. Fonts are served from this domain rather than from Google, so
        loading a page does not tell anyone else that you visited.
      </p>

      <h2>What it does not do</h2>
      <ul>
        <li>
          It never asks for your RuneScape password, and it could not use one. Nothing here connects
          to the game, reads your client or automates anything.
        </li>
        <li>It does not sell or share your data. There is nobody to sell it to.</li>
        <li>It does not build a profile of you or track you across other sites.</li>
      </ul>

      <h2>Where the game data comes from</h2>
      <p>
        Two public sources. Neither is told anything about you — tracking a name reads a public page
        about that name, the same as looking it up yourself.
      </p>
      <table>
        <tbody>
          {LEGAL.sources.map((s) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              <td>
                {s.what}
                <br />
                <span className="subtle">{s.note}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p>
        Hiscores are public, so a name you track is readable by anyone whether or not this site
        exists. If you would rather it were not stored here, remove the account and its snapshots go
        with it.
      </p>

      <h2>Cookies</h2>
      <p>
        One, and it is strictly necessary, which is why there is no consent banner. Nothing here
        sets a cookie for advertising or analytics.
      </p>
      <table>
        <thead>
          <tr>
            <th>Cookie</th>
            <th>Purpose</th>
            <th>Life</th>
          </tr>
        </thead>
        <tbody>
          {LEGAL.cookies.map((c) => (
            <tr key={c.name}>
              <th scope="row">{c.name}</th>
              <td>{c.purpose}</td>
              <td>{c.life}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Who else touches it</h2>
      <table>
        <thead>
          <tr>
            <th>Service</th>
            <th>Role</th>
            <th>What they see</th>
          </tr>
        </thead>
        <tbody>
          {LEGAL.subprocessors.map((s) => (
            <tr key={s.name}>
              <th scope="row">{s.name}</th>
              <td>{s.role}</td>
              <td>{s.data}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>How long it is kept</h2>
      <ul>
        <li>Your account and its contents: until you delete it.</li>
        <li>
          Grand Exchange price history: {HISTORY_RETENTION_DAYS} days, then deleted. This is market
          data rather than anything about you.
        </li>
        <li>Encrypted backups: rolling, and a deletion takes up to 30 days to age out of them.</li>
      </ul>

      <h2>Deleting your account</h2>
      <p>
        Email {LEGAL.contactEmail} and it will be deleted, along with your tracked accounts,
        snapshots, flips and alerts. A self-service button is on the list; until it exists, the
        email reaches one person and gets done.
      </p>

      <h2>Contact</h2>
      <p>
        {LEGAL.entity}, {LEGAL.jurisdiction} — {LEGAL.contactEmail}.
      </p>

      <p className="updated">
        <Link href="/">Back to {SITE.name}</Link>
      </p>
    </main>
  );
}
