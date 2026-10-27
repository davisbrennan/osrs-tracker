import { formatGp } from '@/lib/osrs/ge';
import { gpExact } from '@/lib/gp';
import {
  describePercentile,
  MIN_SAMPLE_DAYS,
  CONTEXT_DAYS,
  type HistoryContext,
} from '@/lib/osrs/stats';

/** A percentile drawn as a position on a bar, because 93 means little alone. */
function Gauge({ pct, label }: { pct: number | null; label: string }) {
  if (pct === null) return null;
  const clamped = Math.max(0, Math.min(100, pct));
  return (
    <div className="gauge">
      <div className="gauge-track" aria-hidden="true">
        <span className="gauge-mark" style={{ left: `${clamped}%` }} />
      </div>
      <p className="gauge-label">{label}</p>
    </div>
  );
}

/**
 * Where this item stands against its own recent past.
 *
 * Every other number on the page describes right now. These describe whether
 * right now is unusual, which is the part that decides whether to act. A
 * spread is meaningless until you know what this item's spread normally is.
 *
 * Below the sample floor this says so rather than showing a figure. A
 * percentile from a handful of days is noise, and the weeks after a
 * deployment are exactly when it would be most tempting to show one anyway.
 */
export default function HistoryContextPanel({ ctx }: { ctx: HistoryContext }) {
  if (!ctx.enough) {
    return (
      <section className="card">
        <h2>
          Against its own history <span className="subtle">last {CONTEXT_DAYS} days</span>
        </h2>
        <p className="subtle">
          {ctx.samples === 0
            ? 'No daily history for this item yet.'
            : `Only ${ctx.samples} day${ctx.samples === 1 ? '' : 's'} of history so far.`}{' '}
          Statistics need at least {MIN_SAMPLE_DAYS} days before they mean anything — a percentile
          from a handful of days is noise with a number attached. History is fetched a few items
          at a time, busiest first, so this fills in on its own.
        </p>
      </section>
    );
  }

  const spreadLabel = describePercentile(ctx.spreadPercentile);
  const priceLabel = describePercentile(ctx.pricePercentile);
  const busy = ctx.volumeRatio;

  return (
    <section className="card">
      <h2>
        Against its own history{' '}
        <span className="subtle">
          last {CONTEXT_DAYS} days · {ctx.samples} daily bars
        </span>
      </h2>

      <div className="ctx-grid">
        <div className="ctx">
          <dt>Margin right now</dt>
          <dd className={ctx.spreadPercentile !== null && ctx.spreadPercentile >= 80 ? 'pl-up' : ''}>
            {spreadLabel ?? '—'}
          </dd>
          <span className="subtle">
            {ctx.currentSpreadPct !== null && ctx.medianSpreadPct !== null ? (
              <>
                spread is {ctx.currentSpreadPct.toFixed(2)}% against a usual{' '}
                {ctx.medianSpreadPct.toFixed(2)}%
              </>
            ) : (
              'no spread to compare'
            )}
          </span>
          <Gauge
            pct={ctx.spreadPercentile}
            label={
              ctx.spreadPercentile === null
                ? ''
                : ctx.spreadPercentile >= 99.5
                  ? `wider than any of the last ${ctx.samples} days`
                  : ctx.spreadPercentile <= 0.5
                    ? `narrower than any of the last ${ctx.samples} days`
                    : `wider than ${ctx.spreadPercentile.toFixed(0)}% of the last ${ctx.samples} days`
            }
          />
        </div>

        <div className="ctx">
          <dt>Price right now</dt>
          <dd>{priceLabel ?? '—'}</dd>
          <span className="subtle">
            {ctx.periodLow !== null && ctx.periodHigh !== null ? (
              <>
                range {formatGp(ctx.periodLow)} to {formatGp(ctx.periodHigh)}
              </>
            ) : (
              'no range yet'
            )}
          </span>
          <Gauge
            pct={ctx.pricePosition}
            label={
              ctx.pricePosition === null
                ? ''
                : `${ctx.pricePosition.toFixed(0)}% of the way up its ${CONTEXT_DAYS}-day range`
            }
          />
        </div>

        <div className="ctx">
          <dt>Activity</dt>
          <dd>
            {busy === null
              ? '—'
              : busy >= 2
                ? 'much busier than usual'
                : busy >= 1.3
                  ? 'busier than usual'
                  : busy <= 0.5
                    ? 'much quieter than usual'
                    : busy <= 0.77
                      ? 'quieter than usual'
                      : 'normal'}
          </dd>
          <span className="subtle">
            {busy === null || ctx.medianVolume === null ? (
              'no usual volume to compare'
            ) : (
              <>
                {busy.toFixed(2)}× its usual {Math.round(ctx.medianVolume).toLocaleString('en-US')}{' '}
                a day
              </>
            )}
          </span>
        </div>

        <div className="ctx">
          <dt>Typical daily move</dt>
          <dd className="num">
            {ctx.typicalMovePct === null ? '—' : `${ctx.typicalMovePct.toFixed(2)}%`}
          </dd>
          <span className="subtle">
            {ctx.typicalMovePct === null
              ? 'not enough movement to measure'
              : ctx.currentSpreadPct !== null && ctx.typicalMovePct > ctx.currentSpreadPct
                ? 'it moves further in a day than the spread you are trying to capture'
                : 'how far it usually travels overnight'}
          </span>
        </div>
      </div>

      <p className="subtle ctx-note">
        Measured with medians rather than averages, because one spike — an update, a streamer, a
        brief squeeze — drags an average around for weeks afterwards and makes everything since
        look ordinary.
        {ctx.typicalMovePct !== null &&
          ctx.currentSpreadPct !== null &&
          ctx.typicalMovePct > ctx.currentSpreadPct && (
            <>
              {' '}
              Worth noting here: this item typically moves {ctx.typicalMovePct.toFixed(2)}% in a
              day, which is more than the {ctx.currentSpreadPct.toFixed(2)}% you would be
              capturing — so holding it overnight risks more than the flip makes.
            </>
          )}
      </p>
    </section>
  );
}
