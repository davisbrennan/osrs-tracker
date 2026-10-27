import { formatGp } from '@/lib/osrs/ge';

/**
 * Cumulative realised P&L.
 *
 * Zero is drawn as a visible line rather than left implicit, because the
 * only thing anyone wants to know at a glance is which side of it the curve
 * is on. The fill is split at that line — green above, red below — so the
 * answer reads before any number does.
 *
 * Points are stepped, not smoothed: P&L changes when a position closes, not
 * continuously, and interpolating between closes would draw profit that
 * never existed at that moment.
 */

export type Point = { t: number; pnl: number };

const W = 900;
const H = 220;
const PAD = { top: 16, right: 74, bottom: 26, left: 8 };

export default function EquityCurve({ points }: { points: Point[] }) {
  if (points.length < 2) return null;

  const t0 = points[0].t;
  const t1 = points[points.length - 1].t;
  const tSpan = t1 - t0 || 1;

  const values = points.map((p) => p.pnl);
  const rawMin = Math.min(0, ...values);
  const rawMax = Math.max(0, ...values);
  const span = rawMax - rawMin || Math.max(1, Math.abs(rawMax) * 0.1 || 1);
  const lo = rawMin - span * 0.1;
  const hi = rawMax + span * 0.1;

  const x = (t: number) => PAD.left + ((t - t0) / tSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  // Stepped: hold the previous level until the moment of the next close.
  const steps: string[] = [];
  points.forEach((p, i) => {
    if (i === 0) steps.push(`${x(p.t).toFixed(1)},${y(p.pnl).toFixed(1)}`);
    else {
      steps.push(`${x(p.t).toFixed(1)},${y(points[i - 1].pnl).toFixed(1)}`);
      steps.push(`${x(p.t).toFixed(1)},${y(p.pnl).toFixed(1)}`);
    }
  });
  const line = steps.join(' ');
  const zeroY = y(0);
  const area = `${line} ${x(t1).toFixed(1)},${zeroY.toFixed(1)} ${x(t0).toFixed(1)},${zeroY.toFixed(1)}`;

  const last = points[points.length - 1].pnl;
  // The first point is the zero anchor at the opening of the first
  // position, not a close — counting it would overstate by one.
  const closeCount = points.length - 1;
  const peak = Math.max(...values);
  const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Cumulative realised profit and loss, ending at ${formatGp(last)} after ${closeCount} closes.`}
        preserveAspectRatio="none"
      >
        <defs>
          {/* Clipped at zero so the fill above and below can differ. */}
          <clipPath id="eq-above">
            <rect x="0" y="0" width={W} height={zeroY} />
          </clipPath>
          <clipPath id="eq-below">
            <rect x="0" y={zeroY} width={W} height={H - zeroY} />
          </clipPath>
        </defs>

        {/* Drop any gridline that would crowd the zero line — breakeven is
            the label that matters, and a tick 15px away just fights it. */}
        {[hi, (hi + lo) / 2, lo]
          .filter((v) => Math.abs(y(v) - zeroY) > 22)
          .map((v, i) => (
            <g key={i}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
              <text x={W - PAD.right + 6} y={y(v) + 4} className="chart-tick">
                {formatGp(v)}
              </text>
            </g>
          ))}

        <polygon points={area} className="eq-fill up" clipPath="url(#eq-above)" />
        <polygon points={area} className="eq-fill down" clipPath="url(#eq-below)" />

        {/* Breakeven. The most important line on the chart. */}
        <line x1={PAD.left} x2={W - PAD.right} y1={zeroY} y2={zeroY} className="chart-zero" />
        <text x={W - PAD.right + 6} y={zeroY + 4} className="chart-tick zero">
          0
        </text>

        <polyline points={line} className={`chart-line ${last >= 0 ? 'up' : 'down'}`} />

        <text x={PAD.left} y={H - 6} className="chart-tick">
          {dayFormat.format(new Date(t0))}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="chart-tick">
          {dayFormat.format(new Date(t1))}
        </text>
      </svg>
      <figcaption className="subtle">
        {closeCount} closes, ending at {formatGp(last)}
        {peak > last ? ` — ${formatGp(peak - last)} below the peak` : ''}. Steps, not a smooth line:
        P&amp;L moves when a position closes, not in between.
      </figcaption>
    </figure>
  );
}
