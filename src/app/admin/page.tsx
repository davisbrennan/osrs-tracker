import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdmin, formatBytes } from '@/lib/admin';
import { counts, storage } from '@/lib/admin-stats';
import AdminShell from '@/components/admin-shell';

export const metadata: Metadata = {
  title: 'Admin',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * How stale the prices can get before it is a problem.
 *
 * The poller runs every five minutes, so anything past fifteen means it has
 * missed at least two turns. This is the single most important number on the
 * page: if prices have stopped arriving, every margin on the site is wrong
 * while still looking perfectly plausible.
 */
const PRICE_STALE_MINUTES = 15;

/** Hiscores run every six hours and take a budgeted slice, so a day is fine. */
const HISCORE_STALE_MINUTES = 60 * 30;

function age(minutes: number | null): string {
  if (minutes === null) return 'never';
  if (minutes < 1) return 'just now';
  if (minutes < 90) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

export default async function AdminOverview() {
  // 404 rather than 403: a signed-in user shouldn't learn this page exists.
  const admin = await requireAdmin();
  if (!admin) notFound();

  const [c, s] = await Promise.all([counts(), storage()]);
  const diskUsedPct =
    s.diskTotal && s.diskFree ? Math.round(((s.diskTotal - s.diskFree) / s.diskTotal) * 100) : null;

  const pricesStale = c.priceAgeMinutes === null || c.priceAgeMinutes > PRICE_STALE_MINUTES;
  const hiscoresStale = c.accounts > 0 && (c.hiscoreAgeMinutes ?? Infinity) > HISCORE_STALE_MINUTES;

  return (
    <AdminShell current="/admin">
      <h1>Overview</h1>

      {pricesStale && (
        <p className="adm-note adm-warn">
          <strong>Prices are stale.</strong> Last written {age(c.priceAgeMinutes)}, and the poller
          runs every five minutes. Every margin on the site is being calculated from old data. Check{' '}
          <code>docker compose logs worker</code>.
        </p>
      )}

      <div className="adm-stats">
        <div className="adm-stat">
          <span className="adm-label">Price data</span>
          <strong>{age(c.priceAgeMinutes)}</strong>
          <span className="adm-sub">
            {c.pricedItems.toLocaleString('en-US')} items with a two-sided price
          </span>
        </div>
        <div className="adm-stat">
          <span className="adm-label">People</span>
          <strong>{c.users}</strong>
          <span className="adm-sub">{c.usersWeek} in the last 7 days</span>
        </div>
        <div className="adm-stat">
          <span className="adm-label">Tracked accounts</span>
          <strong>{c.accounts}</strong>
          <span className="adm-sub">
            {c.snapshots.toLocaleString('en-US')} snapshots, last {age(c.hiscoreAgeMinutes)}
          </span>
        </div>
        <div className="adm-stat">
          <span className="adm-label">Flips logged</span>
          <strong>{c.flips}</strong>
          <span className="adm-sub">{c.openFlips} still open</span>
        </div>
      </div>

      <section className="adm-card">
        <h2>Data freshness</h2>
        <table className="adm-table">
          <tbody>
            <tr>
              <th scope="row">Prices last written</th>
              <td>{age(c.priceAgeMinutes)}</td>
              <td className="adm-muted">
                {pricesStale ? 'the poller has missed a turn' : 'poller healthy'}
              </td>
            </tr>
            <tr>
              <th scope="row">Item catalogue</th>
              <td>{c.items.toLocaleString('en-US')} items</td>
              <td className="adm-muted">
                {c.items === 0 ? 'empty — sync-items has not run' : 'refreshed daily'}
              </td>
            </tr>
            <tr>
              <th scope="row">Hiscores last fetched</th>
              <td>{age(c.hiscoreAgeMinutes)}</td>
              <td className="adm-muted">
                {c.accounts === 0
                  ? 'nothing tracked yet'
                  : hiscoresStale
                    ? 'overdue'
                    : 'within the window'}
              </td>
            </tr>
            <tr>
              <th scope="row">Active price alerts</th>
              <td>{c.activeAlerts}</td>
              <td className="adm-muted">evaluated after every price poll</td>
            </tr>
          </tbody>
        </table>
      </section>

      <section className="adm-card">
        <h2>Storage</h2>
        <table className="adm-table">
          <tbody>
            <tr>
              <th scope="row">Database</th>
              <td>{formatBytes(s.dbBytes)}</td>
              <td className="adm-muted">pg_database_size</td>
            </tr>
            <tr>
              <th scope="row">Price history</th>
              <td>{formatBytes(s.historyBytes)}</td>
              <td className="adm-muted">
                {c.historyRows.toLocaleString('en-US')} rows — the only table that grows without
                bound
              </td>
            </tr>
          </tbody>
        </table>

        {s.diskTotal !== null && diskUsedPct !== null ? (
          <>
            <div className="adm-meter" aria-hidden="true">
              <span
                style={{ width: `${diskUsedPct}%` }}
                className={diskUsedPct > 80 ? 'hot' : ''}
              />
            </div>
            <p className="adm-muted">
              Disk {diskUsedPct}% used — {formatBytes(s.diskTotal - (s.diskFree ?? 0))} of{' '}
              {formatBytes(s.diskTotal)}, {formatBytes(s.diskFree ?? 0)} free.
              {diskUsedPct > 80 && <strong> Worth clearing space.</strong>}
            </p>
          </>
        ) : (
          <p className="adm-muted">Disk figures unavailable on this host.</p>
        )}
      </section>

      <p className="adm-note">
        This panel shows counts only. There is no screen here for reading anyone&rsquo;s tracked
        accounts, flip log or alerts, and that&rsquo;s deliberate — running the service
        doesn&rsquo;t require knowing what people are trading.
      </p>
    </AdminShell>
  );
}
