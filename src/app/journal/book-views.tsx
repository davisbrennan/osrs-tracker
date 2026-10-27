import Link from 'next/link';

/**
 * Sub-navigation inside the book.
 *
 * Everything here used to be one scroll — eight sections deep, which is a
 * document rather than an interface. Real books split the same material the
 * same way: what you hold, how it's doing, what you did, and the ticket.
 *
 * Deliberately styled as a segmented control rather than tabs, because the
 * masthead above is already a row of tabs and two identical strips stacked is
 * worse than one long page. This reads as "within this page", which is what
 * it is.
 *
 * URL-driven rather than client state, so each view is linkable, survives a
 * reload, and the back button does what it looks like it does.
 */

export const VIEWS = ['positions', 'record', 'performance', 'activity'] as const;
export type View = (typeof VIEWS)[number];

export function parseView(raw: string | string[] | undefined): View {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return (VIEWS as readonly string[]).includes(v ?? '') ? (v as View) : 'positions';
}

const LABELS: Record<View, string> = {
  positions: 'Positions',
  record: 'Record a fill',
  performance: 'Performance',
  activity: 'Activity',
};

export default function BookViews({
  current,
  counts,
}: {
  current: View;
  counts: Partial<Record<View, number>>;
}) {
  return (
    <nav className="book-views" aria-label="Book sections">
      {VIEWS.map((v) => {
        const n = counts[v];
        return (
          <Link
            key={v}
            href={v === 'positions' ? '/journal' : `/journal?view=${v}`}
            aria-current={current === v ? 'true' : undefined}
            className={v === 'record' ? 'bv-record' : undefined}
          >
            {LABELS[v]}
            {n !== undefined && n > 0 && <span className="bv-count">{n}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
