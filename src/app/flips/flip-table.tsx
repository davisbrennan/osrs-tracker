import Link from 'next/link';
import type { Opportunity } from '@/lib/osrs/ge';
import { formatGp, minimumViableSpreadPercent } from '@/lib/osrs/ge';
import { gpClass, plClass, ago } from '@/lib/gp';

export type SortKey = 'profit' | 'margin' | 'roi' | 'buy' | 'volume' | 'name' | 'limit' | 'capital';

export const SORTS: { key: SortKey; label: string; left?: boolean; title: string }[] = [
  { key: 'name', label: 'Item', left: true, title: 'Sort by name' },
  { key: 'buy', label: 'Buy at', title: 'The instant-sell price — what you buy at' },
  { key: 'margin', label: 'Margin', title: 'Profit per unit after the 2% sale tax' },
  { key: 'roi', label: 'ROI', title: 'Margin as a percentage of the buy price' },
  { key: 'limit', label: 'Limit', title: 'Units you may buy per 4 hours' },
  { key: 'capital', label: 'You can buy', title: 'Units your cash stack can actually fund' },
  { key: 'profit', label: 'Profit / 4h', title: 'Margin times the units you can actually buy' },
  { key: 'volume', label: 'Traded / h', title: 'Units traded in the last hour, both sides' },
];

function sortHref(
  base: Record<string, string | undefined>,
  key: SortKey,
  active: SortKey,
  dir: 'asc' | 'desc'
) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
  params.set('sort', key);
  // Clicking the active column flips it; a new column starts descending,
  // because "most of" is what you want first for every column here except
  // the name.
  params.set(
    'dir',
    key === active ? (dir === 'desc' ? 'asc' : 'desc') : key === 'name' ? 'asc' : 'desc'
  );
  params.delete('page');
  return `/flips?${params.toString()}`;
}

const CONF_LABEL: Record<string, string> = {
  good: 'good',
  thin: 'thin book',
  stale: 'stale',
  unknown: 'no data',
};

export default function FlipTable({
  rows,
  sort,
  dir,
  query,
}: {
  rows: Opportunity[];
  sort: SortKey;
  dir: 'asc' | 'desc';
  query: Record<string, string | undefined>;
}) {
  return (
    <div className="table-wrap">
      <table className="flips">
        <thead>
          <tr>
            {SORTS.map((col) => (
              <th
                key={col.key}
                className={col.left ? 'left' : undefined}
                aria-sort={
                  sort === col.key ? (dir === 'desc' ? 'descending' : 'ascending') : undefined
                }
                title={col.title}
              >
                <Link href={sortHref(query, col.key, sort, dir)}>{col.label}</Link>
              </th>
            ))}
            <th title="How much to trust this margin, from volume and price age">Confidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((o) => {
            const spread = minimumViableSpreadPercent(o.buyPrice, o.itemId);
            return (
              <tr key={o.itemId}>
                <th scope="row">
                  <Link href={`/item/${o.itemId}`} className="item-name">
                    {o.name}
                  </Link>
                </th>
                <td>
                  <span className={gpClass(o.buyPrice)}>{formatGp(o.buyPrice)}</span>
                </td>
                <td
                  title={`Needs a ${spread.toFixed(2)}% spread to clear the tax — sell above ${formatGp(
                    o.buyPrice + Math.max(1, Math.round((spread / 100) * o.buyPrice))
                  )}`}
                >
                  <span className={plClass(o.marginPerUnit)}>{formatGp(o.marginPerUnit)}</span>
                </td>
                <td>
                  <span className={plClass(o.roiPercent)}>{o.roiPercent.toFixed(1)}%</span>
                </td>
                <td>
                  <span className="num subtle">
                    {o.buyLimit > 0 ? o.buyLimit.toLocaleString('en-US') : '—'}
                  </span>
                </td>
                <td>
                  {/* The honest column. A huge margin with 0 here is the
                      item you cannot afford, which is exactly the row most
                      flip finders leave at the top of the table. */}
                  <span className={o.unitsPerWindow === 0 ? 'num pl-down' : 'num'}>
                    {o.unitsPerWindow.toLocaleString('en-US')}
                  </span>
                </td>
                <td>
                  <span className={plClass(o.profitPerWindow)}>{formatGp(o.profitPerWindow)}</span>
                </td>
                <td>
                  <span className="num subtle">{o.hourlyVolume.toLocaleString('en-US')}</span>
                </td>
                <td className={`conf conf-${o.confidence}`}>
                  {CONF_LABEL[o.confidence]}
                  <span className="subtle"> {ago(o.stalenessMinutes)}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
