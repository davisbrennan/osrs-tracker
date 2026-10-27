import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdmin, adminEmails } from '@/lib/admin';
import { appSettings } from '@/lib/app-settings';
import AdminShell from '@/components/admin-shell';
import SettingsForm from './settings-form';

export const metadata: Metadata = {
  title: 'Admin — settings',
  robots: { index: false, follow: false, nocache: true },
};

export default async function AdminSettings() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  const settings = await appSettings();

  return (
    <AdminShell current="/admin/settings">
      <h1>Site settings</h1>
      <p className="adm-muted">These take effect immediately for everyone.</p>

      <SettingsForm settings={settings} />

      <section className="adm-card">
        <h2>Administrators</h2>
        <p className="adm-muted">
          Set by <code>ADMIN_EMAILS</code> in the server environment, not in the database — so
          nothing running in the app can grant admin access to anyone, including a bug.
        </p>
        <ul className="adm-list">
          {adminEmails().map((e) => (
            <li key={e}>
              {e}
              {e === admin.email.toLowerCase() && <span className="adm-flag">you</span>}
            </li>
          ))}
        </ul>
        <p className="adm-muted">
          To change this, edit <code>/srv/wedding/.env</code> and redeploy.
        </p>
      </section>
    </AdminShell>
  );
}
