import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';
import { recentUsers } from '@/lib/admin-stats';
import { MAX_TRACKED_ACCOUNTS } from '@/lib/session';
import AdminShell from '@/components/admin-shell';

export const metadata: Metadata = {
  title: 'Admin — people',
  robots: { index: false, follow: false, nocache: true },
};

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

export default async function AdminUsers() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  const users = await recentUsers(200);

  return (
    <AdminShell current="/admin/users">
      <h1>People</h1>
      <p className="adm-muted">Everyone who has signed in, newest first. {users.length} shown.</p>

      {users.length === 0 ? (
        <p className="adm-empty">Nobody has signed up yet.</p>
      ) : (
        <section className="adm-card">
          <table className="adm-table wide">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Joined</th>
                <th>Accounts</th>
                <th>Flips</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id}>
                  <th scope="row">
                    {u.email}
                    {u.isAdmin && <span className="adm-flag">admin</span>}
                  </th>
                  <td>{u.name?.trim() || <span className="adm-muted">—</span>}</td>
                  <td>{dateFormat.format(u.createdAt)}</td>
                  <td>
                    {u.trackedAccounts}
                    {/* Worth seeing at a glance: someone sitting on the cap is
                        either a legitimate multi-account player or the first
                        sign that the limit needs thinking about. */}
                    {u.trackedAccounts >= MAX_TRACKED_ACCOUNTS && (
                      <span className="adm-flag">at cap</span>
                    )}
                  </td>
                  <td>{u.flips}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </AdminShell>
  );
}
