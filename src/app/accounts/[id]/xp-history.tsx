import { formatXp } from '@/lib/osrs/xp';

/**
 * Total XP over time, as inline SVG.
 *
 * Deliberately a step-free line with visible points: snapshots are taken when
 * XP changes, not on a fixed clock, so the gaps between points are themselves
 * information — a long flat stretch means you weren't playing, and smoothing
 * that away would be a lie about your own history.
 */

export type Point = { t: number; xp: number };

const W = 900;
const H = 200;
const PAD = { top: 14, right: 70, bottom: 24, left: 8 };

export default function XpHistory({ points }: { points: Point[] }) {
  if (points.length < 2) return null;

  const xs = points.map((p) => p.t);
  const ys = points.map((p) => p.xp);
  const t0 = Math.min(...xs);
  const t1 = Math.max(...xs);
  const tSpan = t1 - t0 || 1;

  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  // XP only goes up, so a flat period would otherwise collapse the scale.
  const ySpan = yMax - yMin || Math.max(1, yMax * 0.001);
  const lo = yMin - ySpan * 0.1;
  const hi = yMax + ySpan * 0.1;

  const x = (t: number) => PAD.left + ((t - t0) / tSpan) * (W - PAD.left - PAD.right);
  const y = (v: number) => PAD.top + (1 - (v - lo) / (hi - lo)) * (H - PAD.top - PAD.bottom);

  const line = points.map((p) => `${x(p.t).toFixed(1)},${y(p.xp).toFixed(1)}`).join(' ');
  const area = `${line} ${x(t1).toFixed(1)},${(H - PAD.bottom).toFixed(1)} ${x(t0).toFixed(1)},${(H - PAD.bottom).toFixed(1)}`;

  const gained = yMax - yMin;
  const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' });

  return (
    <figure className="chart">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Total experience over time, rising by ${formatXp(gained)} across the period.`}
        preserveAspectRatio="none"
      >
        {[yMax, (yMin + yMax) / 2, yMin].map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(v)} y2={y(v)} className="chart-grid" />
            <text x={W - PAD.right + 6} y={y(v) + 4} className="chart-tick">
              {formatXp(v)}
            </text>
          </g>
        ))}

        <polygon points={area} className="chart-band" />
        <polyline points={line} className="chart-line high" />

        {/* Points marked, because each one is a real reading rather than an
            interpolation. With many snapshots they merge into the line. */}
        {points.map((p) => (
          <circle key={p.t} cx={x(p.t)} cy={y(p.xp)} r="2" className="chart-dot" />
        ))}

        <text x={PAD.left} y={H - 6} className="chart-tick">
          {dayFormat.format(new Date(t0))}
        </text>
        <text x={W - PAD.right} y={H - 6} textAnchor="end" className="chart-tick">
          {dayFormat.format(new Date(t1))}
        </text>
      </svg>
      <figcaption className="subtle">
        {formatXp(gained)} gained across {points.length} readings. Flat stretches are time away, not
        missing data.
      </figcaption>
    </figure>
  );
}
