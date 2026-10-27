import Link from 'next/link';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { unusualCandidates, historyCoverage } from '@/app/actions/history';
import { evaluate, formatGp } from '@/lib/osrs/ge';
import { gpExact, plClass } from '@/lib/gp';
import { describePercentile, CONTEXT_DAYS, MIN_SAMPLE_DAYS } from '@/lib/osrs/stats';
import { SITE } from '@/lib/site';
import { collectionSchema, jsonLdProps, SCHEMA_ITEMS } from '@/lib/structured-data';
import AppShell from '@/components/app-shell';

export const revalidate = 300;

export const metadata: Metadata = {
  alternates: { canonical: '/unusual' },
  title: 'Unusual right now',
  description:
    'Old School RuneScape items whose margin, price or trading volume has departed from their own 90-day normal — measured against each item’s own history rather than against a fixed threshold.',
};

/** Only items that actually trade. An unusual spread on a dead item is a trap. */
const MIN_VOLUME = 500;

/** How many liquid items to measure. Covers everything anyone flips. */
const CANDIDATES = 400;

/** Below this the spread is not "wide for this item", it is just noise. */
const INTERESTING_PERCENTILE = 80;

type Search = { view?: string | string[] };

const VIEWS = ['margin', 'cheap', 'busy'] as const;
type View = (typeof VIEWS)[number];

const VIEW_LABELS: Record<View, string> = {
  margin: 'Margin unusually wide',
  cheap: 'Price unusually low',
  busy: 'Unusually busy',
};

export default async function Unusual({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const raw = Array.isArray(sp.view) ? sp.view[0] : sp.view;
  const view: View = (VIEWS as readonly string[]).includes(raw ?? '') ? (raw as View) : 'margin';

  const user = await currentUser();
  const [cashStack, candidates, coverage] = await Promise.all([
    cashStackFor(user?.id ?? null),
    unusualCandidates(MIN_VOLUME, CANDIDATES),
    historyCoverage(),
  ]);

  const measured = candidates.filter((c) => c.context.enough);

  const scored = measured.map((c) => ({
    ...c,
    opportunity: evaluate(
      {
        itemId: c.id,
        name: c.name,
        low: c.low,
        high: c.high,
        lowTime: c.lowTime ? Math.floor(c.lowTime.getTime() / 1000) : null,
        highTime: c.highTime ? Math.floor(c.highTime.getTime() / 1000) : null,
        buyLimit: c.buyLimit,
        hourlyVolume: c.hourlyVolume,
      },
      cashStack
    ),
  }));

  let rows: typeof scored;
  if (view === 'margin') {
    // Unusual AND worth taking. An item that normally has no spread at all
    // will sit at the 100th percentile the moment it has a spread of 1gp,
    // and would otherwise top this list every time while being worthless.
    rows = scored
      .filter(
        (r) =>
          (r.context.spreadPercentile ?? 0) >= INTERESTING_PERCENTILE &&
          r.opportunity.marginPerUnit > 0 &&
          r.opportunity.profitPerWindow > 0
      )
      .sort((a, b) => {
        const byPct = (b.context.spreadPercentile ?? 0) - (a.context.spreadPercentile ?? 0);
        // The percentile saturates at 100, so ties are broken by the robust
        // z, which keeps going — and then by what it is actually worth.
        if (byPct !== 0) return byPct;
        const byZ = (b.context.spreadZ ?? 0) - (a.context.spreadZ ?? 0);
        return byZ !== 0 ? byZ : b.opportunity.profitPerWindow - a.opportunity.profitPerWindow;
      });
  } else if (view === 'cheap') {
    rows = scored
      .filter((r) => (r.context.pricePosition ?? 100) <= 20)
      .sort((a, b) => (a.context.pricePosition ?? 100) - (b.context.pricePosition ?? 100));
  } else {
    rows = scored
      .filter((r) => (r.context.volumeRatio ?? 0) >= 1.5)
      .sort((a, b) => (b.context.volumeRatio ?? 0) - (a.context.volumeRatio ?? 0));
  }

  const coveragePct =
    coverage.priced > 0 ? Math.round((coverage.withEnough / coverage.priced) * 100) : 0;

  return (
    <AppShell current="unusual" signedIn={Boolean(user)} cashStack={cashStack}>
      {view === 'margin' && rows.length > 0 && (
        <script
          {...jsonLdProps(
            collectionSchema({
              name: 'Unusual OSRS margins right now',
              description:
                `Old School RuneScape items whose Grand Exchange margin is wider than usual for that item, measured against its own last ${CONTEXT_DAYS} days.`,
              path: '/unusual',
              items: rows.slice(0, SCHEMA_ITEMS).map((r) => ({
                name: r.name,
                url: `${SITE.url}/item/${r.id}`,
              })),
            })
          )}
        />
      )}
      <h1>Unusual right now</h1>
      <p className="lede">
        Every other page here tells you what a trade is worth today. This one tells you whether
        today is unusual — each item measured against its own last {CONTEXT_DAYS} days, not against
        a threshold that means different things for a rune and a godsword.
      </p>

      <nav className="book-views" aria-label="What kind of unusual">
        {VIEWS.map((v) => (
          <Link
            key={v}
            href={v === 'margin' ? '/unusual' : `/unusual?view=${v}`}
            aria-current={view === v ? 'true' : undefined}
          >
            {VIEW_LABELS[v]}
          </Link>
        ))}
      </nav>

      {coveragePct < 60 && (
        <p className="book-warn">
          <strong>
            {coveragePct}% of priced items have enough history to judge ({coverage.withEnough} of{' '}
            {coverage.priced.toLocaleString('en-US')}).
          </strong>{' '}
          An item needs {MIN_SAMPLE_DAYS} daily bars before anything here can be said about it, and
          history is fetched a few items at a time so as not to hammer the wiki. Busiest items come
          first, so this list is useful well before that number reaches 100%.
        </p>
      )}

      {rows.length === 0 ? (
        <div className="empty">
          <strong>Nothing unusual</strong>
          <p>
            {measured.length === 0
              ? `No item has the ${MIN_SAMPLE_DAYS} days of history needed yet. The backfill job fills this in over the first day or two.`
              : view === 'margin'
                ? `Of the ${measured.length} liquid items with enough history, none has a spread in the top ${100 - INTERESTING_PERCENTILE}% of its own range that is also worth taking after tax. That is the normal state of the market — this list is meant to be empty most of the time.`
                : view === 'cheap'
                  ? `None of the ${measured.length} measured items is near the bottom of its ${CONTEXT_DAYS}-day range.`
                  : `None of the ${measured.length} measured items is trading at 1.5× its usual volume.`}
          </p>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="flips">
            <thead>
              <tr>
                <th className="left">Item</th>
                <th title="Spread now, as a percentage of the buy price">Spread</th>
                <th title="What this item's spread usually is">Usually</th>
                <th title="How today compares with its own last 90 days">Standing</th>
                <th>Margin</th>
                <th>Per window</th>
                <th title="Where it sits in its 90-day price range">In range</th>
                <th title="Today's volume against its own median">Activity</th>
                <th title="Daily bars behind these figures">Days</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 60).map((r) => (
                <tr key={r.id}>
                  <th scope="row">
                    <Link href={`/item/${r.id}`} className="item-name">
                      {r.name}
                    </Link>
                    {r.members && <span className="members">members</span>}
                  </th>
                  <td>
                    <span className="num">
                      {r.context.currentSpreadPct === null
                        ? '—'
                        : `${r.context.currentSpreadPct.toFixed(2)}%`}
                    </span>
                  </td>
                  <td>
                    <span className="num subtle">
                      {r.context.medianSpreadPct === null
                        ? '—'
                        : `${r.context.medianSpreadPct.toFixed(2)}%`}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        (r.context.spreadPercentile ?? 0) >= 95 ? 'pl-up' : 'num'
                      }
                    >
                      {describePercentile(r.context.spreadPercentile) ?? '—'}
                    </span>
                  </td>
                  <td>
                    <span className={plClass(r.opportunity.marginPerUnit)}>
                      {gpExact(r.opportunity.marginPerUnit)}
                    </span>
                  </td>
                  <td>
                    <span className={plClass(r.opportunity.profitPerWindow)}>
                      {formatGp(r.opportunity.profitPerWindow)}
                    </span>
                  </td>
                  <td>
                    <span className="num subtle">
                      {r.context.pricePosition === null
                        ? '—'
                        : `${r.context.pricePosition.toFixed(0)}%`}
                    </span>
                  </td>
                  <td>
                    <span
                      className={
                        (r.context.volumeRatio ?? 1) >= 2 ? 'num pl-up' : 'num subtle'
                      }
                    >
                      {r.context.volumeRatio === null
                        ? '—'
                        : `${r.context.volumeRatio.toFixed(2)}×`}
                    </span>
                  </td>
                  <td>
                    <span className="num subtle">{r.context.samples}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <section className="card mm-notes">
        <h2>How &ldquo;unusual&rdquo; is decided</h2>
        <p>
          Each item is compared with <strong>itself</strong>. A 4% spread is wide for a nature rune
          and narrow for a dragon warhammer, so a single threshold across the catalogue would
          surface the same volatile items forever and miss everything else.
        </p>
        <ul>
          <li>
            <strong>Medians, not averages.</strong> One spike — an update, a streamer, a brief
            squeeze — drags an average around for weeks and makes everything after it look
            ordinary. The spread of the distribution is measured with median absolute deviation
            for the same reason.
          </li>
          <li>
            <strong>At least {MIN_SAMPLE_DAYS} days or nothing.</strong> A percentile from four
            days is noise with a number attached. Items below the floor are left out rather than
            guessed at.
          </li>
          <li>
            <strong>Unusual is not the same as worth doing.</strong> An item that normally has no
            spread sits at the 100th percentile the moment it has one of a single gp. So this list
            also requires a margin that survives the tax and a window worth filling.
          </li>
          <li>
            <strong>Only items that actually trade.</strong> Restricted to{' '}
            {MIN_VOLUME.toLocaleString('en-US')}+ an hour, because an unusual spread on something
            that changes hands twice a day is a trap rather than an opportunity.
          </li>
        </ul>
        <p className="subtle">
          Expect this to be empty much of the time. A market where something is always unusual is
          one with a badly set threshold.
        </p>
      </section>
    </AppShell>
  );
}
