/**
 * The offer band: what to type into the Grand Exchange, and how far you can
 * push it.
 *
 * Drawn as two segments on ONE price axis rather than two separate gauges,
 * because that is the truth of it — the buying room and the selling room are
 * carved out of a single margin, they overlap in the middle, and spending
 * one spends the other. Two side-by-side meters would read as two budgets.
 *
 * Server component: there is nothing to interact with. The numbers are the
 * interaction — you read them and go type them in.
 */

import { gpExact } from '@/lib/gp';
import { formatGp } from '@/lib/osrs/ge';
import {
  type Offers,
  type Tightness,
  tightness as rateTightness,
  tightnessLabel,
} from '@/lib/osrs/offers';

/** Where a price sits on the axis, 0% at buyAt and 100% at sellAt. */
function pos(price: number, from: number, to: number): number {
  const span = to - from;
  if (span <= 0) return 0;
  return Math.min(100, Math.max(0, ((price - from) / span) * 100));
}

export default function OfferBand({
  offers,
  itemName,
}: {
  offers: Offers;
  itemName: string;
}) {
  const t: Tightness = rateTightness(offers);

  /* Not viable: there is no pair of prices that makes money, so a band would
     be drawing a range that does not exist. Say so instead. */
  if (!offers.viable) {
    return (
      <section className="card ob ob-dead">
        <h2>What to offer</h2>
        <p className="ob-dead-line">
          <strong>Nothing works here.</strong> Buying at{' '}
          <span className="num">{gpExact(offers.buyAt)}</span> and selling at{' '}
          <span className="num">{gpExact(offers.sellAt)}</span> loses{' '}
          <span className="num pl-down">{gpExact(Math.abs(offers.margin))}</span> a unit once the{' '}
          <span className="num">{gpExact(offers.tax)}</span> sale tax lands
          {offers.sellAt <= offers.buyAt
            ? ' — and the last sale was below the last purchase, so the book has moved.'
            : '.'}
        </p>
        <p className="ob-note">
          To break even you would need to sell above{' '}
          <span className="num">{gpExact(offers.minSell)}</span>, which is{' '}
          <span className="num">{gpExact(offers.minSell - offers.sellAt)}</span> more than anyone is
          currently paying.
        </p>
      </section>
    );
  }

  const buyEnd = pos(offers.maxBuy, offers.buyAt, offers.sellAt);
  const sellStart = pos(offers.minSell, offers.buyAt, offers.sellAt);

  /* Whether the two ranges meet decides both the drawing and the sentence
     under it, and they are different facts about the trade:

       gap     — maxBuy < minSell. Between them is a dead zone: more than
                 you may pay, less than you may accept. The common case.
       overlap — maxBuy >= minSell, which needs a margin wider than half the
                 spread. Slack whichever side you push.

     An earlier draft asserted the overlap unconditionally. The tight-margin
     screenshot showed two stubs at opposite ends of an empty bar under a
     caption claiming they overlapped. */
  const deadZone = offers.minSell - offers.maxBuy;
  const hasRoom = offers.overbidRoom > 0 || offers.undercutRoom > 0;

  return (
    <section className="card ob">
      <div className="ob-head">
        <h2>What to offer</h2>
        <span className={`ob-rate ob-rate-${t}`}>{tightnessLabel(t)}</span>
      </div>

      <div className="ob-pair">
        <div className="ob-side">
          <span className="ob-label">Buy at</span>
          <span className="ob-price num">{gpExact(offers.buyAt)}</span>
          <span className="ob-limit">
            {offers.overbidRoom > 0 ? (
              <>
                pay up to <strong className="num">{gpExact(offers.maxBuy)}</strong>
              </>
            ) : (
              <>and not a gp more</>
            )}
          </span>
        </div>
        <div className="ob-side ob-sell">
          <span className="ob-label">Sell at</span>
          <span className="ob-price num">{gpExact(offers.sellAt)}</span>
          <span className="ob-limit">
            {offers.undercutRoom > 0 ? (
              <>
                accept down to <strong className="num">{gpExact(offers.minSell)}</strong>
              </>
            ) : (
              <>and not a gp less</>
            )}
          </span>
        </div>
      </div>

      {/* One axis, two segments: buying room from the left edge, selling
          room to the right edge. Drawn only when there is something to
          draw — at a knife edge both segments are zero-width and an empty
          bar reads as a rendering failure rather than as "no slack". */}
      {hasRoom && (
        <>
          <div
            className="ob-rail"
            role="img"
            aria-label={`Buying room runs from ${formatGp(offers.buyAt)} to ${formatGp(
              offers.maxBuy
            )}, ${formatGp(offers.overbidRoom)}. Selling room runs from ${formatGp(
              offers.minSell
            )} to ${formatGp(offers.sellAt)}, ${formatGp(offers.undercutRoom)}.`}
          >
            <div className="ob-track" />
            <div className="ob-seg ob-seg-buy" style={{ left: 0, width: `${buyEnd}%` }} />
            <div
              className="ob-seg ob-seg-sell"
              style={{ left: `${sellStart}%`, width: `${100 - sellStart}%` }}
            />
          </div>

          <div className="ob-rooms">
            <span className="ob-room">
              <span className="ob-arrow" aria-hidden="true">
                ▲
              </span>{' '}
              <strong className="num">{gpExact(offers.overbidRoom)}</strong> to outbid other buyers
            </span>
            <span className="ob-room ob-room-sell">
              <strong className="num">{gpExact(offers.undercutRoom)}</strong> to undercut other
              sellers{' '}
              <span className="ob-arrow" aria-hidden="true">
                ▼
              </span>
            </span>
          </div>
        </>
      )}

      <p className="ob-note">
        {!hasRoom ? (
          <>
            <strong>These two prices exactly.</strong> The margin is{' '}
            <strong className="num pl-up">{gpExact(offers.margin)}</strong> a unit, which leaves
            nothing to bid with — a gp either way and the trade stops paying.
          </>
        ) : deadZone > 0 ? (
          <>
            Between <strong className="num">{gpExact(offers.maxBuy)}</strong> and{' '}
            <strong className="num">{gpExact(offers.minSell)}</strong> is dead ground: more than you
            may pay, less than you may accept. Both ends are cut from the same{' '}
            <strong className="num pl-up">{gpExact(offers.margin)}</strong> margin, so spend it
            outbidding and there is none left for undercutting.
          </>
        ) : (
          <>
            The two ranges overlap, so there is slack whichever side you push — but they are cut
            from the same <strong className="num pl-up">{gpExact(offers.margin)}</strong> margin.
            Spend it all outbidding and there is none left for undercutting.
          </>
        )}
      </p>

      <p className="ob-caveat">
        These are limits, not predictions. {itemName} last <em>sold</em> at{' '}
        {gpExact(offers.buyAt)} and last <em>bought</em> at {gpExact(offers.sellAt)} — offering
        exactly those joins a queue at a price that has already cleared. How long you wait depends
        on how many other offers are stacked at each price, and the Grand Exchange does not publish
        that to anyone outside Jagex.
      </p>
    </section>
  );
}
