import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, and, gte, asc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices, osrsPriceHistory } from '@/database/schema';
import {
  evaluate,
  formatGp,
  geTax,
  breakevenSellPrice,
  minimumViableSpreadPercent,
} from '@/lib/osrs/ge';
import { currentUser, cashStackFor } from '@/lib/session';
import { gpExact, ago, plClass } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import PriceHistory from './price-history';

export const revalidate = 120;

/** How much history the chart shows. */
const HISTORY_DAYS = 30;

async function loadItem(id: number) {
  const [row] = await db
    .select({
      id: osrsItems.id,
      name: osrsItems.name,
      examine: osrsItems.examine,
      members: osrsItems.members,
      buyLimit: osrsItems.buyLimit,
      highalch: osrsItems.highalch,
      low: osrsPrices.low,
      high: osrsPrices.high,
      lowTime: osrsPrices.lowTime,
      highTime: osrsPrices.highTime,
      hourlyVolume: osrsPrices.hourlyVolume,
      fetchedAt: osrsPrices.fetchedAt,
    })
    .from(osrsItems)
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsItems.id))
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
  return {
    title: item.name,
    description: `${item.name} — buying at ${price} on the Grand Exchange, with the margin after tax, the breakeven sell price and a ${HISTORY_DAYS}-day price history.`,
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
  const history = await db
    .select({
      ts: osrsPriceHistory.ts,
      avgHigh: osrsPriceHistory.avgHigh,
      avgLow: osrsPriceHistory.avgLow,
    })
    .from(osrsPriceHistory)
    .where(and(eq(osrsPriceHistory.itemId, numeric), gte(osrsPriceHistory.ts, since)))
    .orderBy(asc(osrsPriceHistory.ts));

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

  return (
    <AppShell current="items" signedIn={Boolean(user)} cashStack={cashStack}>
      <p className="crumb">
        <Link href="/items">Items</Link>
      </p>
      <h1>
        {item.name}
        {item.members && <span className="members">members</span>}
      </h1>
      {item.examine && <p className="lede">{item.examine}</p>}

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
                <dt>Buy at (instant-sell)</dt>
                <dd>
                  <span className="num">{gpExact(item.low!)}</span>
                </dd>
                <dt>Sell at (instant-buy)</dt>
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
                Traded {(item.hourlyVolume ?? 0).toLocaleString('en-US')} times in the last hour.
                Price is{' '}
                <span className={`conf conf-${opportunity!.confidence}`}>
                  {opportunity!.confidence === 'good' ? 'a healthy book' : opportunity!.confidence}
                </span>
                , last moved {ago(opportunity!.stalenessMinutes)} ago.
              </p>
            </div>
          </div>

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
