import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { alertsFor } from '@/app/actions/alerts';
import { MAX_ALERTS } from '@/lib/osrs/constants';
import { itemById } from '@/app/actions/trades';
import { formatGp, marginPerUnit } from '@/lib/osrs/ge';
import { gpExact, plClass, ago } from '@/lib/gp';
import { exactStamp } from '@/lib/osrs/freshness';
import { MIN_SAMPLE_DAYS, CONTEXT_DAYS } from '@/lib/osrs/stats';
import AppShell from '@/components/app-shell';
import AlertForm from './alert-form';
import AlertRowActions from './alert-row-actions';

export const metadata: Metadata = {
  title: 'Alerts',
  robots: { index: false, follow: false },
};

/** What an alert is watching for, in a sentence. */
function condition(a: { kind: string; direction: string; threshold: number; priceSide: string }) {
  if (a.kind === 'unusual') {
    return `margin reaches the ${a.threshold}th percentile of its own ${CONTEXT_DAYS} days`;
  }
  const verb = a.direction === 'below' ? 'falls to or below' : 'rises to or above';
  if (a.kind === 'margin') return `margin ${verb} ${gpExact(a.threshold)}`;
  const side = a.priceSide === 'high' ? 'sell price' : 'buy price';
  return `${side} ${verb} ${gpExact(a.threshold)}`;
}

/**
 * Alerts.
 *
 * The sending half of this — the checker, the cooldown, the email with the
 * flip maths in it — has existed and been tested since early on, with no way
 * to create one. This is that missing half.
 *
 * The default kind is deliberately "unusual" rather than a price threshold.
 * A fixed price requires knowing what the item normally does and goes stale
 * as it drifts; measuring against the item's own history needs neither.
 */
export default async function Alerts({
  searchParams,
}: {
  searchParams: Promise<{ item?: string | string[] }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/alerts');

  // Arriving from an item page preselects that item, so "alert me about
  // this" is one click rather than a search for something already on screen.
  const raw = (await searchParams).item;
  const presetId = Number(Array.isArray(raw) ? raw[0] : raw);

  const [cashStack, alerts, preset] = await Promise.all([
    cashStackFor(user.id),
    alertsFor(user.id),
    Number.isInteger(presetId) && presetId > 0 ? itemById(presetId) : Promise.resolve(null),
  ]);
  const active = alerts.filter((a) => a.active).length;

  return (
    <AppShell current="alerts" signedIn cashStack={cashStack}>
      <h1>Alerts</h1>
      <p className="lede">
        Email when something is worth looking at, so you do not have to keep looking. Every alert
        carries the margin after tax and the breakeven price, because &ldquo;it dropped to
        1.5M&rdquo; on its own does not tell you whether there is anything in it.
      </p>

      <section className="card">
        <h2>New alert</h2>
        <AlertForm presetItem={preset ?? undefined} />
      </section>

      {alerts.length === 0 ? (
        <div className="empty">
          <strong>No alerts yet</strong>
          <p>
            The one worth starting with is <strong>the margin goes unusual</strong> on something
            you already trade — it needs no number chosen by hand and does not go stale as the item
            moves. Items are on the <Link href="/items">items page</Link>, and{' '}
            <Link href="/unusual">Unusual right now</Link> shows what that alert would have caught
            today.
          </p>
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table className="flips">
              <thead>
                <tr>
                  <th className="left">Item</th>
                  <th className="left">Fires when</th>
                  <th>Margin now</th>
                  <th>Then waits</th>
                  <th>Last sent</th>
                  <th className="left">State</th>
                  <th className="left"></th>
                </tr>
              </thead>
              <tbody>
                {alerts.map((a) => {
                  const margin =
                    a.low !== null && a.high !== null
                      ? marginPerUnit(a.low, a.high, a.itemId)
                      : null;
                  return (
                    <tr key={a.id} className={a.active ? undefined : 'row-locked'}>
                      <th scope="row">
                        <Link href={`/item/${a.itemId}`} className="item-name">
                          {a.itemName}
                        </Link>
                      </th>
                      <td className="left">
                        <span className="subtle">{condition(a)}</span>
                      </td>
                      <td>
                        {margin === null ? (
                          <span className="subtle">—</span>
                        ) : (
                          <span className={plClass(margin)}>{gpExact(margin)}</span>
                        )}
                      </td>
                      <td>
                        <span className="num subtle">
                          {a.cooldownMinutes >= 1440
                            ? `${Math.round(a.cooldownMinutes / 1440)}d`
                            : a.cooldownMinutes >= 60
                              ? `${Math.round(a.cooldownMinutes / 60)}h`
                              : `${a.cooldownMinutes}m`}
                        </span>
                      </td>
                      <td>
                        <span className="num subtle" title={exactStamp(a.lastFiredAt)}>
                          {a.lastFiredAt
                            ? ago((Date.now() - a.lastFiredAt.getTime()) / 60_000)
                            : 'never'}
                        </span>
                      </td>
                      <td className="left">
                        <span className={a.active ? 'conf conf-good' : 'subtle'}>
                          {a.active ? 'active' : 'paused'}
                        </span>
                      </td>
                      <td className="left">
                        <AlertRowActions id={a.id} active={a.active} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <p className="subtle">
            {active} active of {alerts.length}, out of a {MAX_ALERTS} limit. Checked straight after
            each price poll, so an alert is never judged against prices older than the ones that
            just landed.
          </p>
        </>
      )}

      <section className="card mm-notes">
        <h2>Which kind to use</h2>
        <ul>
          <li>
            <strong>The margin goes unusual.</strong> Fires when the margin is wider than most of
            that item&rsquo;s own last {CONTEXT_DAYS} days. No number to choose, and it keeps
            meaning the same thing as the item drifts. Needs {MIN_SAMPLE_DAYS} days of history
            first, and will not fire on a margin that does not survive the tax however historically
            wide it is.
          </li>
          <li>
            <strong>The margin hits a number.</strong> For when you know what you want to clear.
            Measured after the 2% sale tax, not on the raw spread.
          </li>
          <li>
            <strong>The price hits a number.</strong> The familiar kind. Honest warning: a
            threshold that made sense in March is noise by June, and it cannot tell you whether
            there is a trade in it — only where the number went.
          </li>
        </ul>
        <p className="subtle">
          Each alert waits out its own cooldown after firing, so a price sitting on a threshold
          mails once rather than every five minutes.
        </p>
      </section>
    </AppShell>
  );
}
