import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SITE } from '@/lib/site';
import { formatGp } from '@/lib/osrs/ge';
import { currentUser, userSettings, MAX_TRACKED_ACCOUNTS } from '@/lib/session';
import AppShell from '@/components/app-shell';
import NameForm from './name-form';

export const metadata: Metadata = {
  title: 'Settings',
  robots: { index: false, follow: false },
};

export default async function Settings() {
  const user = await currentUser();
  if (!user) redirect('/signin');

  const settings = await userSettings(user.id);
  const cashStack = settings?.cashStack ?? 0;

  return (
    <AppShell current="settings" signedIn cashStack={cashStack}>
      <h1>Settings</h1>
      <p className="lede">
        Your cash stack is in the masthead on every page, because it reprices everything. The rest
        lives here.
      </p>

      <section className="card">
        <h2>Display name</h2>
        <NameForm name={user.name ?? ''} />
      </section>

      <section className="card">
        <h2>Account</h2>
        <dl className="kv">
          <dt>Email</dt>
          <dd>{user.email}</dd>
          <dt>Sign-in</dt>
          <dd>Magic link — there is no password to forget or leak.</dd>
          <dt>Saved cash stack</dt>
          <dd>
            <span className="num">{formatGp(cashStack)}</span>
          </dd>
          <dt>Tracked accounts</dt>
          <dd>Up to {MAX_TRACKED_ACCOUNTS} RuneScape names.</dd>
        </dl>
      </section>

      <section className="card">
        <h2>Coming next</h2>
        <p className="muted">
          Tracking your RSN, skill goals, the flip log and price alerts are built on the data side
          and waiting on their screens. The hiscores poller and the alert mailer already run.
        </p>
      </section>

      <p className="subtle">
        Questions or a problem: {SITE.contact}. Deleting your account removes your tracked accounts,
        snapshots, flips and alerts along with it.
      </p>
    </AppShell>
  );
}
