import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';
import { healthReport } from '@/lib/osrs/health-facts';
import { overallStatus, countByStatus, type Check, type Status } from '@/lib/osrs/health';
import AdminShell from '@/components/admin-shell';

export const metadata: Metadata = {
  title: 'Health',
  robots: { index: false, follow: false, nocache: true },
};

/**
 * Always fresh.
 *
 * A cached health page is worse than none: it would report a green poller
 * for five minutes after the poller died, which is exactly the window in
 * which you would be looking at it.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const LABEL: Record<Status, string> = {
  ok: 'OK',
  warn: 'Check',
  fail: 'Broken',
  unknown: 'Unknown',
};

function CheckRow({ check }: { check: Check }) {
  return (
    <li className={`hc hc-${check.status}`} id={check.id}>
      <div className="hc-head">
        <span className="hc-badge">{LABEL[check.status]}</span>
        <span className="hc-title">{check.title}</span>
      </div>
      <p className="hc-detail">{check.detail}</p>
      {check.fix && <p className="hc-fix">{check.fix}</p>}
      {check.command && <pre className="hc-cmd">{check.command}</pre>}
    </li>
  );
}

/**
 * Health.
 *
 * Everything on this page answers a question the site itself cannot answer
 * by looking right. A page that renders an empty state looks identical
 * whether there is nothing to show or the job that fills it has been
 * throwing since it shipped.
 *
 * The ordering is deliberate: what is broken comes first. A health page
 * that lists twelve green rows before the red one is a page you skim.
 */
export default async function Health() {
  // 404 rather than 403, as elsewhere in the admin area: a signed-in user
  // should not learn this page exists.
  const admin = await requireAdmin();
  if (!admin) notFound();

  const report = await healthReport();
  const all = [...report.features, ...report.jobs];
  const overall = overallStatus(all);
  const tally = countByStatus(all);

  const severity: Record<Status, number> = { fail: 0, warn: 1, unknown: 2, ok: 3 };
  const bySeverity = (a: Check, b: Check) => severity[a.status] - severity[b.status];

  const features = [...report.features].sort(bySeverity);
  const jobs = [...report.jobs].sort(bySeverity);

  return (
    <AdminShell current="/admin/health">
      <h1>Health</h1>

      <p className={`hc-summary hc-${overall}`}>
        {overall === 'ok' ? (
          <>
            <strong>Everything is working.</strong> All {tally.ok} checks pass. This page reads
            live on every load, so what you are looking at is true right now.
          </>
        ) : (
          <>
            <strong>
              {tally.fail > 0
                ? `${tally.fail} ${tally.fail === 1 ? 'thing is' : 'things are'} broken`
                : `${tally.warn + tally.unknown} ${tally.warn + tally.unknown === 1 ? 'thing needs' : 'things need'} a look`}
              .
            </strong>{' '}
            {tally.ok} of {all.length} checks pass. Each line below says what to do about it.
          </>
        )}
      </p>

      {report.noRunsRecorded && (
        <p className="adm-note adm-warn">
          <strong>No job runs have been recorded yet.</strong> The run log is new in this release,
          so this is expected until the worker has restarted and each job has had its first turn —
          the price poller within five minutes, the daily ones within a day. Every job below will
          read as &ldquo;never run&rdquo; until then. If they still do tomorrow, that is real.
        </p>
      )}

      <h2>Features</h2>
      <p className="subtle">
        What a visitor would see. These check the data behind a page, not whether the page renders
        &mdash; an empty page renders perfectly.
      </p>
      <ul className="hc-list">
        {features.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>

      <h2>Background jobs</h2>
      <p className="subtle">
        Last recorded run of each job against the cadence it is scheduled at. A job that has never
        run is not the same as a job with nothing to do, which is the distinction the run log
        exists to make.
      </p>
      <ul className="hc-list">
        {jobs.map((c) => (
          <CheckRow key={c.id} check={c} />
        ))}
      </ul>
    </AdminShell>
  );
}
