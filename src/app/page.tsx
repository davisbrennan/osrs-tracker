import Link from 'next/link';
import type { Metadata } from 'next';
import { eq, and, isNotNull, desc, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices } from '@/database/schema';
import { SITE, FEATURES, STEPS, FAQS } from '@/lib/site';
import {
  geTax,
  formatGp,
  marginPerUnit,
  breakevenSellPrice,
  TAX_EXEMPT_ITEM_IDS,
} from '@/lib/osrs/ge';
import { currentUser, cashStackFor } from '@/lib/session';
import { gpExact } from '@/lib/gp';
import { unusualCandidates } from '@/app/actions/history';
import { lastPriceSync } from '@/lib/osrs/last-sync';
import { ago } from '@/lib/gp';
import { websiteSchema, faqSchema, jsonLdProps } from '@/lib/structured-data';
import AppShell from '@/components/app-shell';

export const revalidate = 300;

/**
 * The root layout supplies the title, description and social card. All this
 * adds is the canonical, which the layout cannot: `metadataBase` resolves
 * relative URLs but does not declare one, so without this the home page was
 * the only public page with no canonical at all — and it is the page most
 * likely to be linked with a tracking parameter stuck on the end.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * The hero is a real flip, not a headline.
 *
 * The thing people get wrong about the Grand Exchange is that the 2% is taken
 * off the sale, so a spread that looks like profit is often a loss. That
 * misunderstanding IS the product thesis, so the page opens by doing the
 * arithmetic on an item that is actually trading right now rather than
 * claiming to be useful in a sentence.
 */
async function heroFlip() {
  const rows = await db
    .select({
      itemId: osrsItems.id,
      name: osrsItems.name,
      low: osrsPrices.low,
      high: osrsPrices.high,
      buyLimit: osrsItems.buyLimit,
    })
    .from(osrsPrices)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsPrices.itemId))
    .where(
      and(
        isNotNull(osrsPrices.low),
        isNotNull(osrsPrices.high),
        sql`${osrsPrices.high} > ${osrsPrices.low}`
      )
    )
    // Busiest first, then choose in code. Pushing the "is this a good example"
    // rules into SQL made the query brittle: one strict threshold too many and
    // the only row that survived was the bond, so the panel claimed there was
    // no price data at all while the rest of the site was full of it.
    .orderBy(desc(osrsPrices.hourlyVolume))
    .limit(60);

  const usable = rows.filter(
    (r): r is typeof r & { low: number; high: number } => r.low !== null && r.high !== null
  );

  // Tax-exempt items are disqualified, not merely unlucky. The bond is among
  // the most-traded things in the game so it wins "busiest" easily — and it
  // pays no tax, which turns the one panel whose whole job is showing the tax
  // eat a spread into "Tax on the sale: 0". A worked example that works out to
  // nothing is worse than no example.
  const candidates = usable.filter(
    (r) => !TAX_EXEMPT_ITEM_IDS.has(r.itemId) && geTax(r.high, r.itemId) > 0
  );

  // Prefer something recognisably mid-priced and profitable, but fall back
  // through weaker preferences rather than giving up and showing an empty
  // panel — any real flip teaches the lesson better than a placeholder.
  const row =
    candidates.find((r) => r.low >= 50_000 && marginPerUnit(r.low, r.high, r.itemId) > 0) ??
    candidates.find((r) => marginPerUnit(r.low, r.high, r.itemId) > 0) ??
    candidates[0];

  if (!row) return null;
  return {
    itemId: row.itemId,
    name: row.name,
    buy: row.low,
    sell: row.high,
    buyLimit: row.buyLimit,
  };
}

/**
 * The state of the market, in three numbers.
 *
 * A landing page that only describes itself asks to be taken on trust. This
 * one is measuring four thousand items every five minutes, and saying so
 * with today's actual figures is both the proof and the most characteristic
 * thing about the subject — a market summary is what a market tool should
 * open with.
 *
 * Every row links to its item page, which is also where the search traffic
 * is meant to land.
 */
async function marketPulse() {
  const priced = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(osrsPrices)
    .where(and(isNotNull(osrsPrices.low), isNotNull(osrsPrices.high)));

  const liquid = await db
    .select({
      itemId: osrsItems.id,
      name: osrsItems.name,
      low: osrsPrices.low,
      high: osrsPrices.high,
      volume: osrsPrices.hourlyVolume,
    })
    .from(osrsPrices)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsPrices.itemId))
    .where(
      and(
        isNotNull(osrsPrices.low),
        isNotNull(osrsPrices.high),
        sql`${osrsPrices.hourlyVolume} >= 500`
      )
    )
    .orderBy(desc(osrsPrices.hourlyVolume))
    .limit(200);

  const usable = liquid.filter(
    (r): r is typeof r & { low: number; high: number } => r.low !== null && r.high !== null
  );

  const widest = usable
    .map((r) => ({ ...r, margin: marginPerUnit(r.low, r.high, r.itemId) }))
    .sort((a, b) => b.margin - a.margin)[0];

  const busiest = usable[0];

  // Limited to the busiest slice: this runs on every landing-page render and
  // the full Unusual screen's work is not worth it for one headline figure.
  const unusual = (await unusualCandidates(2000, 60).catch(() => []))
    .filter(
      (c) =>
        c.context.enough &&
        (c.context.spreadPercentile ?? 0) >= 90 &&
        marginPerUnit(c.low, c.high, c.id) > 0
    )
    .sort((a, b) => (b.context.spreadPercentile ?? 0) - (a.context.spreadPercentile ?? 0))[0];

  return {
    tracked: priced[0]?.n ?? 0,
    widest: widest && widest.margin > 0 ? widest : null,
    busiest: busiest ?? null,
    unusual: unusual ?? null,
  };
}

export default async function Landing() {
  const user = await currentUser();
  const [cashStack, flip, pulse, sync] = await Promise.all([
    cashStackFor(user?.id ?? null),
    heroFlip().catch(() => null),
    marketPulse().catch(() => null),
    lastPriceSync().catch(() => null),
  ]);

  return (
    <AppShell current="home" signedIn={Boolean(user)} cashStack={cashStack}>
      {/* The questions below are ones people type into a search bar, so they
          are marked up to be answerable directly from the results. */}
      <script {...jsonLdProps([websiteSchema(), faqSchema([...FAQS])])} />

      <section className="hero">
        <div className="hero-copy">
          <h1 className="hero-title">
            The margin is the easy part. Whether you can hit it is the question.
          </h1>
          <p className="hero-sub">
            {SITE.name} prices every Grand Exchange flip against the tax, the four-hour buy limit
            and the cash you actually have — then tells you how much of the book is thin enough to
            strand you.
          </p>
          <p className="hero-actions">
            <Link href="/flips" className="btn-primary">
              Open the flip finder
            </Link>
            <span className="subtle">No account needed.</span>
          </p>
        </div>

        {flip ? (
          <div className="sum hero-sum">
            <h3>
              Right now, one{' '}
              <Link href={`/item/${flip.itemId}`} className="item-name">
                {flip.name}
              </Link>
            </h3>
            <dl>
              <dt>Buy at</dt>
              <dd>
                <span className="num">{gpExact(flip.buy)}</span>
              </dd>
              <dt>Sell at</dt>
              <dd>
                <span className="num">{gpExact(flip.sell)}</span>
              </dd>
              <dt>Spread</dt>
              <dd>
                <span className="num">{gpExact(flip.sell - flip.buy)}</span>
              </dd>
              <div className="rule" />
              <dt>Tax on the sale</dt>
              <dd>
                <span className="num pl-down">−{gpExact(geTax(flip.sell, flip.itemId))}</span>
              </dd>
              <div className="rule" />
              <dt className="total">You keep</dt>
              <dd className="total">
                <span
                  className={`num ${marginPerUnit(flip.buy, flip.sell, flip.itemId) >= 0 ? 'pl-up' : 'pl-down'}`}
                >
                  {gpExact(marginPerUnit(flip.buy, flip.sell, flip.itemId))}
                </span>
              </dd>
            </dl>
            <p className="sum-foot">
              Breakeven sell price is{' '}
              <span className="num">{gpExact(breakevenSellPrice(flip.buy, flip.itemId))}</span>.
              Anything under that loses money however good the spread looks.
            </p>
          </div>
        ) : (
          <div className="sum hero-sum">
            <h3>Waiting on the first price poll</h3>
            <p className="sum-foot">
              Prices arrive every five minutes from the OSRS Wiki&rsquo;s API. This panel fills in
              with a live flip once the poller has run.
            </p>
          </div>
        )}
      </section>

      {pulse && pulse.tracked > 0 && (
        <section className="pulse" aria-label="The market right now">
          <p className="pulse-lead">
            Watching <strong>{pulse.tracked.toLocaleString('en-US')}</strong> priced items
            {sync?.minutesAgo != null && (
              <>
                , last checked <strong>{ago(sync.minutesAgo)}</strong>
                {sync.minutesAgo >= 1 ? ' ago' : ''}
              </>
            )}
            .
          </p>

          <div className="pulse-grid">
            {pulse.widest && (
              <div className="pulse-cell">
                <p className="pulse-label">Widest margin</p>
                <p className="pulse-figure pl-up">+{gpExact(pulse.widest.margin)}</p>
                <p className="pulse-item">
                  <Link href={`/item/${pulse.widest.itemId}`}>{pulse.widest.name}</Link>
                  <span className="subtle"> per unit, after tax</span>
                </p>
              </div>
            )}

            {pulse.busiest && (
              <div className="pulse-cell">
                <p className="pulse-label">Busiest</p>
                <p className="pulse-figure">
                  {formatGp(pulse.busiest.volume ?? 0).replace(/gp$/i, '')}
                </p>
                <p className="pulse-item">
                  <Link href={`/item/${pulse.busiest.itemId}`}>{pulse.busiest.name}</Link>
                  <span className="subtle"> traded in the last hour</span>
                </p>
              </div>
            )}

            {pulse.unusual ? (
              <div className="pulse-cell">
                <p className="pulse-label">Unusual today</p>
                <p className="pulse-figure">
                  {pulse.unusual.context.currentSpreadPct?.toFixed(1)}%
                </p>
                <p className="pulse-item">
                  <Link href={`/item/${pulse.unusual.id}`}>{pulse.unusual.name}</Link>
                  <span className="subtle">
                    {' '}
                    against its usual {pulse.unusual.context.medianSpreadPct?.toFixed(1)}%
                  </span>
                </p>
              </div>
            ) : (
              <div className="pulse-cell">
                <p className="pulse-label">Unusual today</p>
                <p className="pulse-figure quiet">Nothing</p>
                <p className="pulse-item">
                  <span className="subtle">
                    No item is trading far outside its own range. Most days look like this.
                  </span>
                </p>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="rows">
        {FEATURES.map((f) => (
          <article key={f.title} className="row">
            <h2>{f.title}</h2>
            <p>{f.body}</p>
          </article>
        ))}
      </section>

      <section className="steps">
        <h2>Getting set up</h2>
        <ol className="step-list">
          {STEPS.map((s) => (
            <li key={s.title}>
              <strong>{s.title}</strong>
              <span>{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section className="faq">
        <h2>Questions</h2>
        <dl className="faq-list">
          {FAQS.map((f) => (
            <div key={f.q}>
              <dt>{f.q}</dt>
              <dd>{f.a}</dd>
            </div>
          ))}
        </dl>
      </section>

      <footer className="foot">
        <p>
          Prices from the OSRS Wiki real-time API. Progress from the official hiscores. Not
          affiliated with Jagex.
        </p>
        <p>
          <Link href="/privacy">Privacy</Link> <Link href="/terms">Terms</Link>
        </p>
      </footer>
    </AppShell>
  );
}
