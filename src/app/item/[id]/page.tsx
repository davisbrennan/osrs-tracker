import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, and, gte, asc, inArray } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices, osrsPriceHistory, osrsItemWiki } from '@/database/schema';
import {
  evaluate,
  formatGp,
  geTax,
  breakevenSellPrice,
  minimumViableSpreadPercent,
} from '@/lib/osrs/ge';
import { buildPortfolio } from '@/lib/osrs/portfolio';
import { limitStatus, formatResetIn } from '@/lib/osrs/limits';
import { WIKI_LICENCE } from '@/lib/osrs/wiki';
import { currentUser, cashStackFor } from '@/lib/session';
import { tradesForItem } from '@/app/actions/trades';
import { isWatching } from '@/app/actions/watchlist';
import { gpExact, ago, plClass } from '@/lib/gp';
import { priceAge, exactStamp, slowerSide } from '@/lib/osrs/freshness';
import AppShell from '@/components/app-shell';
import { itemSchema, breadcrumbSchema, jsonLdProps } from '@/lib/structured-data';
import { SITE, SOCIAL_CARD } from '@/lib/site';
import PriceHistory from './price-history';
import WatchButton from './watch-button';
import HistoryContextPanel from './history-context';
import { contextFor } from '@/app/actions/history';

export const revalidate = 120;

/** How much history the chart shows. */
const HISTORY_DAYS = 30;

/** Alching consumes one of these per cast. */
const NATURE_RUNE_ID = 561;

async function loadItem(id: number) {
  const [row] = await db
    .select({
      id: osrsItems.id,
      name: osrsItems.name,
      examine: osrsItems.examine,
      members: osrsItems.members,
      buyLimit: osrsItems.buyLimit,
      value: osrsItems.value,
      highalch: osrsItems.highalch,
      low: osrsPrices.low,
      high: osrsPrices.high,
      lowTime: osrsPrices.lowTime,
      highTime: osrsPrices.highTime,
      hourlyVolume: osrsPrices.hourlyVolume,
      fetchedAt: osrsPrices.fetchedAt,
      wikiSummary: osrsItemWiki.summary,
      wikiTitle: osrsItemWiki.title,
      wikiUrl: osrsItemWiki.url,
    })
    .from(osrsItems)
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
    .leftJoin(osrsItemWiki, eq(osrsItemWiki.itemId, osrsItems.id))
    .where(eq(osrsItems.id, id))
    .limit(1);
  return row ?? null;
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric)) return { title: 'Item' };
  const item = await loadItem(numeric).catch(() => null);
  if (!item) return { title: 'Item' };

  const price = item.low !== null ? formatGp(item.low) : 'unpriced';
  const canonical = `/item/${numeric}`;
  const description =
    item.low !== null && item.high !== null
      ? `${item.name} is buying at ${formatGp(item.low)} and selling at ${formatGp(item.high)} on the Old School RuneScape Grand Exchange. Live margin after the 2% tax, breakeven sell price, buy limit and a ${HISTORY_DAYS}-day price history.`
      : `${item.name} — Old School RuneScape Grand Exchange price, buy limit and ${HISTORY_DAYS}-day history. Currently unpriced on at least one side.`;

  return {
    // The item name alone is what people search; the site name is appended
    // by the title template in the root layout.
    title: `${item.name} price`,
    description,
    alternates: { canonical },
    openGraph: {
      title: `${item.name} — ${price} on the Grand Exchange`,
      description,
      url: canonical,
      type: 'website',
      // Declaring openGraph at all drops the inherited file-based image, so
      // it goes back in by hand. See SOCIAL_CARD.
      images: [SOCIAL_CARD],
    },
  };
}

export default async function ItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const numeric = Number(id);
  if (!Number.isInteger(numeric) || numeric < 0) notFound();

  const user = await currentUser();
  const [item, cashStack] = await Promise.all([loadItem(numeric), cashStackFor(user?.id ?? null)]);
  if (!item) notFound();

  const since = new Date(Date.now() - HISTORY_DAYS * 86_400_000);
  const [history, myTrades, watching, natureRune, ctx] = await Promise.all([
    db
      .select({
        ts: osrsPriceHistory.ts,
        avgHigh: osrsPriceHistory.avgHigh,
        avgLow: osrsPriceHistory.avgLow,
      })
      .from(osrsPriceHistory)
      .where(and(eq(osrsPriceHistory.itemId, numeric), gte(osrsPriceHistory.ts, since)))
      .orderBy(asc(osrsPriceHistory.ts)),
    user ? tradesForItem(user.id, numeric) : Promise.resolve([]),
    isWatching(user?.id ?? null, numeric),
    db
      .select({ high: osrsPrices.high })
      .from(osrsPrices)
      .where(inArray(osrsPrices.itemId, [NATURE_RUNE_ID]))
      .limit(1),
    contextFor(numeric, item.low, item.high, item.hourlyVolume),
  ]);

  const age = priceAge(item.lowTime, item.highTime, item.fetchedAt);
  const lagging = slowerSide(age);

  const priced = item.low !== null && item.high !== null;
  const opportunity = priced
    ? evaluate(
        {
          itemId: item.id,
          name: item.name,
          low: item.low!,
          high: item.high!,
          lowTime: item.lowTime ? Math.floor(item.lowTime.getTime() / 1000) : null,
          highTime: item.highTime ? Math.floor(item.highTime.getTime() / 1000) : null,
          buyLimit: item.buyLimit,
          hourlyVolume: item.hourlyVolume ?? 0,
        },
        cashStack
      )
    : null;

  /* ------------------------------------------------- your side of the book */
  const marks = new Map<number, number | null>([[numeric, item.high ?? null]]);
  const myBook = myTrades.length > 0 ? buildPortfolio(myTrades, marks) : null;
  const myPosition = myBook?.positions.find((p) => p.itemId === numeric) ?? null;
  const myRealised = myBook?.closes.reduce((s, c) => s + c.profit, 0) ?? 0;
  const limit = limitStatus(numeric, item.buyLimit, myTrades);
  const resetIn = formatResetIn(limit.resetsInMs);

  /* -------------------------------------------------- high alchemy economics
     A genuine use for the item expressed in numbers rather than prose: alch
     value against what it costs to buy, net of the nature rune burned. For
     most items this is deeply negative, which is itself the useful answer —
     it is why the alch value acts as a price floor only on a few things. */
  const runePrice = natureRune[0]?.high ?? null;
  const alch =
    item.highalch && item.highalch > 0 && item.low !== null && runePrice !== null
      ? { proceeds: item.highalch - runePrice, margin: item.highalch - runePrice - item.low }
      : null;

  return (
    <AppShell current="items" signedIn={Boolean(user)} cashStack={cashStack}>
      {/* Every value here is also rendered on the page below — marking up a
          price that is not shown is exactly what gets structured data
          penalised. */}
      <script
        {...jsonLdProps([
          itemSchema({
            id: item.id,
            name: item.name,
            description: item.wikiSummary ?? item.examine,
            buyPrice: item.low,
            members: item.members,
          }),
          breadcrumbSchema([
            { name: 'Items', url: `${SITE.url}/items` },
            { name: item.name, url: `${SITE.url}/item/${item.id}` },
          ]),
        ])}
      />

      <p className="crumb">
        <Link href="/items">Items</Link>
      </p>

      <div className="item-head">
        <h1>
          {item.name}
          {item.members && <span className="members">members</span>}
        </h1>
        <span className="item-actions">
          <WatchButton itemId={item.id} initial={watching} signedIn={Boolean(user)} />
          {user && (
            <Link href={`/alerts?item=${item.id}`} className="watch-btn">
              <span aria-hidden="true">◔</span> Alert me
            </Link>
          )}
        </span>
      </div>

      {item.examine && <p className="examine">&ldquo;{item.examine}&rdquo;</p>}

      {/* ------------------------------------------------ what it is and does */}
      <section className="card about">
        <h2>About this item</h2>
        <div className="about-body">
          <div className="about-main">
        {item.wikiSummary ? (
          <>
            <p className="about-text">{item.wikiSummary}</p>
            {/* The attribution the licence requires. It travels with the text
                it credits — see lib/osrs/wiki.ts before changing this. */}
            <p className="about-credit">
              From{' '}
              <a href={item.wikiUrl ?? '#'} target="_blank" rel="noopener noreferrer nofollow">
                {item.wikiTitle ?? item.name}
              </a>{' '}
              on the Old School RuneScape Wiki, used under{' '}
              <a href={WIKI_LICENCE.url} target="_blank" rel="noopener noreferrer nofollow">
                {WIKI_LICENCE.name}
              </a>
              .
            </p>
          </>
        ) : (
          <p className="subtle">
            No description yet. These are fetched from the wiki a few at a time, heaviest-traded
            first, so this fills in on its own.
          </p>
        )}

          </div>

        <dl className="facts">
          <div>
            <dt>Buy limit</dt>
            <dd>
              <span className="num">
                {item.buyLimit ? item.buyLimit.toLocaleString('en-US') : '—'}
              </span>
              <span className="subtle"> per 4h</span>
            </dd>
          </div>
          <div>
            <dt>High alch</dt>
            <dd>
              <span className="num">{item.highalch ? gpExact(item.highalch) : '—'}</span>
            </dd>
          </div>
          <div>
            <dt>Shop value</dt>
            <dd>
              <span className="num">{item.value ? gpExact(item.value) : '—'}</span>
            </dd>
          </div>
          <div>
            <dt>Traded last hour</dt>
            <dd>
              <span className="num">{(item.hourlyVolume ?? 0).toLocaleString('en-US')}</span>
            </dd>
          </div>
        </dl>

        </div>

        {alch && (
          <p className="subtle alch-note">
            {alch.proceeds <= 0 ? (
              /* Some items alch for less than the rune costs. Saying they
                 "yield -202" is technically true and reads like a bug. */
              <>
                Its high alch value of <span className="num">{gpExact(item.highalch!)}</span> does
                not cover the <span className="num">{gpExact(runePrice!)}</span> nature rune it
                would burn, so alching is a loss before the item itself is counted.
              </>
            ) : alch.margin >= 0 ? (
              <>
                Alching it yields <span className="num">{gpExact(alch.proceeds)}</span> after the
                nature rune — <span className="pl-up">{gpExact(alch.margin)}</span> more than it
                costs to buy, so the alch value is holding this price up.
              </>
            ) : (
              <>
                Alching it yields <span className="num">{gpExact(alch.proceeds)}</span> after the
                nature rune, <span className="pl-down">{gpExact(Math.abs(alch.margin))}</span> less
                than it costs to buy. Alching it is a loss, so the price floats free of the alch
                value.
              </>
            )}
          </p>
        )}
      </section>

      {!priced ? (
        <div className="empty">
          <strong>No price on record</strong>
          <p>
            This item has not traded recently enough for the Grand Exchange to report a price on
            both sides. That is normal for untradeable items and for things almost nobody buys.
          </p>
        </div>
      ) : (
        <>
          <div className="item-grid">
            <div className="sum">
              <h3>One unit, right now</h3>
              <dl>
                <dt>
                  Buy at (instant-sell)
                  <span className="age" title={exactStamp(item.lowTime)}>
                    traded {ago(age.buyMinutes)}
                    {age.buyMinutes !== null && age.buyMinutes >= 1 ? ' ago' : ''}
                  </span>
                </dt>
                <dd>
                  <span className="num">{gpExact(item.low!)}</span>
                </dd>
                <dt>
                  Sell at (instant-buy)
                  <span className="age" title={exactStamp(item.highTime)}>
                    traded {ago(age.sellMinutes)}
                    {age.sellMinutes !== null && age.sellMinutes >= 1 ? ' ago' : ''}
                  </span>
                </dt>
                <dd>
                  <span className="num">{gpExact(item.high!)}</span>
                </dd>
                <dt>Spread</dt>
                <dd>
                  <span className="num">{gpExact(item.high! - item.low!)}</span>
                </dd>
                <div className="rule" />
                <dt>Tax on the sale</dt>
                <dd>
                  <span className="num pl-down">−{gpExact(geTax(item.high!, item.id))}</span>
                </dd>
                <div className="rule" />
                <dt className="total">Margin per unit</dt>
                <dd className="total">
                  <span className={plClass(opportunity!.marginPerUnit)}>
                    {gpExact(opportunity!.marginPerUnit)}
                  </span>
                </dd>
              </dl>
              <p className="sum-foot">
                Breakeven sell price is{' '}
                <span className="num">{gpExact(breakevenSellPrice(item.low!, item.id))}</span> — a
                spread of {minimumViableSpreadPercent(item.low!, item.id).toFixed(2)}% just to clear
                the tax.
              </p>
            </div>

            <div className="sum">
              <h3>Your {formatGp(cashStack)}</h3>
              <dl>
                <dt>Buy limit per 4 hours</dt>
                <dd>
                  <span className="num">
                    {item.buyLimit ? item.buyLimit.toLocaleString('en-US') : 'not published'}
                  </span>
                </dd>
                <dt>Units you can fund</dt>
                <dd>
                  <span className={opportunity!.unitsPerWindow === 0 ? 'num pl-down' : 'num'}>
                    {opportunity!.unitsPerWindow.toLocaleString('en-US')}
                  </span>
                </dd>
                <dt>Capital required</dt>
                <dd>
                  <span className="num">{gpExact(opportunity!.capitalRequired)}</span>
                </dd>
                <div className="rule" />
                <dt className="total">Profit per window</dt>
                <dd className="total">
                  <span className={plClass(opportunity!.profitPerWindow)}>
                    {gpExact(opportunity!.profitPerWindow)}
                  </span>
                </dd>
              </dl>
              <p className="sum-foot">
                Price is{' '}
                <span className={`conf conf-${opportunity!.confidence}`}>
                  {opportunity!.confidence === 'good' ? 'a healthy book' : opportunity!.confidence}
                </span>
                {age.olderMinutes === null ? (
                  <> — one side has never been seen trade.</>
                ) : (
                  <>
                    , governed by the {lagging === 'buy' ? 'buy' : lagging === 'sell' ? 'sell' : 'slower'}{' '}
                    side at {ago(age.olderMinutes)}.
                  </>
                )}
                {lagging && (
                  <>
                    {' '}
                    You can {lagging === 'sell' ? 'get in faster than you can get out' : 'get out faster than you can get in'}.
                  </>
                )}
              </p>
              <p className="sum-foot refreshed" title={exactStamp(item.fetchedAt)}>
                {age.fetchedMinutes === null
                  ? 'Refresh time unknown.'
                  : `Prices refreshed ${ago(age.fetchedMinutes)}${age.fetchedMinutes >= 1 ? ' ago' : ''}.`}
                {age.pollOverdue && (
                  <span className="pl-down">
                    {' '}
                    That is longer than the five-minute poll, so this may be our data rather than a
                    quiet market.
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* ------------------------------------------------- your own history */}
          {user && myTrades.length > 0 && (
            <section className="chart-block">
              <h2>
                Your position <span className="subtle">in {item.name}</span>
              </h2>

              <div className="kpi-row kpi-4">
                <div className="kpi">
                  <dt>Holding</dt>
                  <dd className="num">
                    {myPosition ? myPosition.quantity.toLocaleString('en-US') : '—'}
                  </dd>
                  <span className="subtle">
                    {myPosition ? `avg ${gpExact(Math.round(myPosition.avgCost))}` : 'nothing open'}
                  </span>
                </div>
                <div className="kpi">
                  <dt>Unrealised</dt>
                  <dd
                    className={
                      myPosition?.unrealised == null ? 'num' : plClass(myPosition.unrealised)
                    }
                  >
                    {myPosition?.unrealised == null ? '—' : formatGp(myPosition.unrealised)}
                  </dd>
                  <span className="subtle">net of exit tax</span>
                </div>
                <div className="kpi">
                  <dt>Realised here</dt>
                  <dd className={plClass(myRealised)}>{formatGp(myRealised)}</dd>
                  <span className="subtle">{myBook?.closes.length ?? 0} closes</span>
                </div>
                <div className="kpi">
                  <dt>Limit left</dt>
                  <dd className={limit.exhausted ? 'num pl-down' : 'num'}>
                    {limit.remaining === null ? '—' : limit.remaining.toLocaleString('en-US')}
                  </dd>
                  <span className="subtle">
                    {resetIn ? `resets in ${resetIn}` : 'window is clear'}
                  </span>
                </div>
              </div>

              {limit.used > 0 && (
                <p className="subtle">
                  You&rsquo;ve bought {limit.used.toLocaleString('en-US')}
                  {limit.limit ? ` of ${limit.limit.toLocaleString('en-US')}` : ''} in the current
                  four-hour window
                  {resetIn ? `, which resets in ${resetIn}` : ''}. Counted from fills recorded
                  here, so anything bought in game and not logged is invisible to it.
                </p>
              )}

              <div className="table-wrap">
                <table className="flips">
                  <thead>
                    <tr>
                      <th className="left">When</th>
                      <th className="left">Side</th>
                      <th>Qty</th>
                      <th>Price</th>
                      <th>Value</th>
                      <th>Tax</th>
                    </tr>
                  </thead>
                  <tbody>
                    {myTrades.slice(0, 20).map((t) => (
                      <tr key={t.id}>
                        <th scope="row" className="subtle">
                          {new Intl.DateTimeFormat('en-GB', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(t.executedAt)}
                        </th>
                        <td className="left">
                          <span className={t.side === 'buy' ? 'side-buy' : 'side-sell'}>
                            {t.side === 'buy' ? 'BUY' : 'SELL'}
                          </span>
                        </td>
                        <td>
                          <span className="num">{t.quantity.toLocaleString('en-US')}</span>
                        </td>
                        <td>
                          <span className="num">{gpExact(t.price)}</span>
                        </td>
                        <td>
                          <span className="num">{formatGp(t.price * t.quantity)}</span>
                        </td>
                        <td>
                          <span className="num pl-down">
                            {t.taxPaid === null ? '—' : formatGp(t.taxPaid)}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {myTrades.length > 20 && (
                <p className="subtle">
                  Showing the 20 most recent of {myTrades.length} —{' '}
                  <Link href="/journal?view=activity">the full blotter</Link> has the rest.
                </p>
              )}
            </section>
          )}

          <HistoryContextPanel ctx={ctx} />

          {history.length > 1 ? (
            <section className="chart-block">
              <h2>Last {HISTORY_DAYS} days</h2>
              <PriceHistory
                points={history.map((h) => ({
                  t: h.ts.getTime(),
                  high: h.avgHigh,
                  low: h.avgLow,
                }))}
              />
            </section>
          ) : (
            <p className="subtle">
              Not enough history to chart yet — one point is recorded per hour, so this fills in as
              the site runs.
            </p>
          )}
        </>
      )}
    </AppShell>
  );
}
