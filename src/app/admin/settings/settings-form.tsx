'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveAppSettings } from '@/app/actions/admin';
import type { AppSettings } from '@/lib/app-settings';

export default function SettingsForm({ settings }: { settings: AppSettings }) {
  const router = useRouter();
  const [msg, setMsg] = useState<string | null>(null);
  const [maintenance, setMaintenance] = useState(settings.maintenance);
  const [, start] = useTransition();

  return (
    <form
      className="adm-card"
      action={(fd) =>
        start(async () => {
          const res = await saveAppSettings(fd);
          setMsg(res && 'error' in res ? (res.error ?? 'Failed.') : 'Saved.');
          router.refresh();
        })
      }
    >
      <label className="adm-check">
        <input type="checkbox" name="signupsOpen" defaultChecked={settings.signupsOpen} />
        <span>
          <strong>Accept new sign-ups</strong>
          <em>
            Turn off and people who already have an account can still sign in, but a new email
            address is refused at the sign-in form.
          </em>
        </span>
      </label>

      <label className="adm-check">
        <input
          type="checkbox"
          name="maintenance"
          checked={maintenance}
          onChange={(e) => setMaintenance(e.target.checked)}
        />
        <span>
          <strong>Maintenance mode</strong>
          <em>
            Shows a short notice instead of the planner. Guest RSVP pages and published wedding
            sites keep working — guests shouldn&rsquo;t be blocked by your deploy.
          </em>
        </span>
      </label>

      {maintenance && (
        <p className="adm-warn">
          While this is on, couples can&rsquo;t reach their planner. Remember to turn it off.
        </p>
      )}

      <div className="adm-field">
        <label htmlFor="banner">Notice shown across the app</label>
        <input
          id="banner"
          name="banner"
          defaultValue={settings.banner ?? ''}
          placeholder="Back up and running after this morning's outage."
          maxLength={300}
        />
        <p className="adm-muted">Leave blank for no notice.</p>
      </div>

      <div className="adm-field">
        <label htmlFor="bannerLevel">Notice tone</label>
        <select id="bannerLevel" name="bannerLevel" defaultValue={settings.bannerLevel}>
          <option value="info">Information</option>
          <option value="warn">Warning</option>
        </select>
      </div>

      <div className="adm-actions">
        <button type="submit">Save settings</button>
        {msg && <span className="adm-ok">{msg}</span>}
      </div>
    </form>
  );
}
