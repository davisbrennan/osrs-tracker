import { formatGp } from '@/lib/osrs/ge';

/**
 * Hourly price history as inline SVG.
 *
 * No charting library on purpose: this is two polylines and a band, it has to
 * render inside a server component, and an artifact that loads a library from
 * a CDN is one more thing that can fail at the wrong moment.
 *
 * The band between the two lines is the subject rather than decoration — for
 * a flipper the gap IS the story, so it gets the fill and the lines are kept
 * thin. Each series is labelled at its own end rather than in a legend, so
 * the chart does not depend on telling two colours apart.
 */

export type Point = { t: number; high: number | null; low: number | null };

const W = 900;
const H = 240;
const PAD = { top: 14, right: 64, bottom: 24, left: 8 };

export default function PriceHistory({ points }: { points: Point[] }) {
  const usable = points.filter((p) => p.high !== null || p.low !== null);
  if (usable.length < 2) return null;

  const values = usable.flatMap((p) => [p.high, p.low]).filter((v): v is number => v !== null);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  // A flat series would divide by zero; give it a nominal band so the line
  // sits in the middle instead of vanishing.
  const span = rawMax - rawMin || Math.max(1, rawMax * 0.02);
  const min = rawMin - span * 0.12;
  const max = rawMax + span * 0.12;

  const t0 = usable[0].t;
  const t1 = usable[usable.length - 1].t;
  const tSpan = t1 - t0 || 1;

  const x = (t: number) => PAD.left + ((t - t0) / tSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - min) / (max - min)) * (H - PAD.top - PAD.bottom);

  const line = (pick: (p: Point) => number | null) =>
    usable
      .map((p) => {
        const v = pick(p);
        return v === null ? null : `${x(p.t).toFixed(1)},${y(v).toFixed(1)}`;
      })
      .filter((s): s is string => s !== null)
      .join(' ');

  const highLine = line((p) => p.high);
  const lowLine = line((p) => p.low);

  // The band only makes sense where both sides are known.
  const both = usable.filter((p) => p.high !== null && p.low !== null);
  const band =
    both.length > 1
      ? [
          ...both.map((p) => `${x(p.t).toFixed(1)},${y(p.high!).toFixed(1)}`),
          ...both
            .slice()
            .reverse()
            .map((p) => `${x(p.t).toFixed(1)},${y(p.low!).toFixed(1)}`),
        ].join(' ')
      : null;

  const last = usable[usable.length - 1];
  const ticks = [max - span * 0.12, (min + max) / 2, min + span * 0.12];
  const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Hourly instant-buy and instant-sell prices. Instant-buy ranges from ${formatGp(
          rawMin
        )} to ${formatGp(rawMax)} over the period.`}
        preserveAspectRatio="none"
      >
        {ticks.map((v) => (
          <g key={v}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={W - PAD.right + 6} y={y(v) + 4} className="chart-tick">
              {formatGp(v)}
            </text>
          </g>
        ))}

        {band && <polygon points={band} className="chart-band" />}
        {lowLine && <polyline points={lowLine} className="chart-line low" />}
        {highLine && <polyline points={highLine} className="chart-line high" />}

        {/* Labels sit INSIDE the plot, anchored to its right edge. Placed
            outside they landed in the same column as the axis ticks and the
            two overlapped. */}
        {last.high !== null && (
          <text
            x={W - PAD.right - 6}
            y={y(last.high) - 7}
            textAnchor="end"
            className="chart-label high"
          >
            sell
          </text>
        )}
        {last.low !== null && (
          <text
            x={W - PAD.right - 6}
            y={y(last.low) + 15}
            textAnchor="end"
            className="chart-label low"
          >
            buy
          </text>
        )}

        <text x={PAD.left} y={H - 6} className="chart-tick">
          {dayFormat.format(new Date(t0))}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="chart-tick">
          {dayFormat.format(new Date(t1))}
        </text>
      </svg>
      <figcaption className="subtle">
        One point per hour, from the wiki&rsquo;s hourly averages. The shaded gap is the spread —
        the part the tax comes out of.
      </figcaption>
    </figure>
  );
}
