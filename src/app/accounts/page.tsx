import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, desc, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAccounts } from '@/database/schema';
import { currentUser, cashStackFor, MAX_TRACKED_ACCOUNTS } from '@/lib/session';
import { formatXp } from '@/lib/osrs/xp';
import { ago } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import AddAccount from './add-account';
import AccountActions from './account-actions';

export const metadata: Metadata = {
  title: 'Accounts',
  robots: { index: false, follow: false },
};

const TYPE_LABEL: Record<string, string> = {
  main: 'Main',
  ironman: 'Ironman',
  hardcore: 'Hardcore',
  ultimate: 'Ultimate',
  group: 'Group',
  deadman: 'Deadman',
};

export default async function Accounts() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/accounts');

  const cashStack = await cashStackFor(user.id);

  const accounts = await db
    .select()
    .from(osrsAccounts)
    .where(eq(osrsAccounts.userId, user.id))
    .orderBy(desc(osrsAccounts.isPrimary), osrsAccounts.createdAt);

  // The newest snapshot per account in one query rather than one per account.
  // DISTINCT ON is Postgres-specific and exactly the right tool here; written
  // as raw SQL because Drizzle has no clean expression for it.
  const latest = new Map<string, { totalLevel: number; totalXp: number; combatLevel: number }>();
  if (accounts.length > 0) {
    const res = await db.execute(sql`
      SELECT DISTINCT ON (account_id)
        account_id, total_level, total_xp, combat_level
      FROM osrs_snapshots
      WHERE account_id IN (${sql.join(
        accounts.map((a) => sql`${a.id}::uuid`),
        sql`, `
      )})
      ORDER BY account_id, taken_at DESC
    `);
    const snapRows =
      (res as { rows?: Record<string, unknown>[] }).rows ??
      (res as unknown as Record<string, unknown>[]);
    for (const r of snapRows) {
      latest.set(String(r.account_id), {
        totalLevel: Number(r.total_level ?? 0),
        totalXp: Number(r.total_xp ?? 0),
        combatLevel: Number(r.combat_level ?? 3),
      });
    }
  }

  const rows = accounts.map((a) => ({ ...a, snapshot: latest.get(a.id) ?? null }));

  const atCap = rows.length >= MAX_TRACKED_ACCOUNTS;

  return (
    <AppShell current="accounts" signedIn cashStack={cashStack}>
      <h1>Accounts</h1>
      <p className="lede">
        Skills, levels and experience read from the public hiscores. There is no game login and
        nothing here touches your account — it reads the same page anyone could look up.
      </p>

      {rows.length === 0 ? (
        <div className="empty">
          <strong>No accounts tracked yet</strong>
          <p>
            Add a RuneScape name and it pulls every skill, works out your combat level, and starts
            recording progress so goal estimates come from your own measured rate rather than a
            generic table.
          </p>
        </div>
      ) : (
        <div className="acct-list">
          {rows.map((a) => (
            <article key={a.id} className="acct">
              <div className="acct-head">
                <h2>
                  <Link href={`/accounts/${a.id}`} className="item-name">
                    {a.rsn}
                  </Link>
                </h2>
                <span className="acct-type">{TYPE_LABEL[a.accountType] ?? a.accountType}</span>
                {a.isPrimary && <span className="acct-primary">default</span>}
              </div>

              {a.missingSince ? (
                <p className="acct-warn">
                  The hiscores stopped listing this name on{' '}
                  {a.missingSince.toLocaleDateString('en-GB')}. Refreshing will try again.
                </p>
              ) : !a.snapshot ? (
                <p className="subtle">Waiting for the first sync.</p>
              ) : (
                <dl className="acct-stats">
                  <div>
                    <dt>Total level</dt>
                    <dd>
                      <span className="num">{a.snapshot!.totalLevel.toLocaleString('en-US')}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Total XP</dt>
                    <dd>
                      <span className="num">{formatXp(a.snapshot!.totalXp)}</span>
                    </dd>
                  </div>
                  <div>
                    <dt>Combat</dt>
                    <dd>
                      <span className="num">{a.snapshot!.combatLevel}</span>
                    </dd>
                  </div>
                </dl>
              )}

              <div className="acct-foot">
                <span className="subtle">
                  {a.lastSyncedAt
                    ? `Checked ${ago((Date.now() - a.lastSyncedAt.getTime()) / 60_000)} ago`
                    : 'Never checked'}
                </span>
                <AccountActions accountId={a.id} rsn={a.rsn} />
              </div>
            </article>
          ))}
        </div>
      )}

      <section className="card">
        <h2>Add an account</h2>
        {atCap ? (
          <p className="muted">
            You&rsquo;re tracking {MAX_TRACKED_ACCOUNTS}, which is the limit. Every tracked name is
            a recurring request to Jagex&rsquo;s hiscores — a free service run as a courtesy — so
            the cap is there to keep this site from becoming a problem for them. Remove one to add
            another.
          </p>
        ) : (
          <AddAccount remaining={MAX_TRACKED_ACCOUNTS - rows.length} />
        )}
      </section>
    </AppShell>
  );
}
