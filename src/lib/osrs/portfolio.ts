/**
 * Position and P&L accounting from a blotter of executions.
 *
 * Modelled on how a real trading book works rather than on how flip trackers
 * usually work. The difference matters here for a mechanical reason: the
 * Grand Exchange's four-hour buy limit makes it impossible to acquire a large
 * position in one go, so anyone trading at size necessarily holds several
 * lots bought at different prices. A journal where one row is one
 * buy-and-sell cannot represent that, and quietly gets the cost basis wrong
 * the moment you average down.
 *
 * So: executions are the stored facts. Positions, average cost and realised
 * P&L are all DERIVED from them. Nothing here is a stored aggregate that can
 * drift out of step with the trades it came from.
 *
 * Lots are matched first-in-first-out. FIFO is the common default in real
 * books, and it matches the intuition of selling the ones you bought first.
 * The method is named in the output so the UI can say which it used rather
 * than leaving the reader to assume.
 *
 * Everything in this file is pure. No database, no clock, no network —
 * it takes trades and returns numbers, which is why it can be tested
 * exhaustively.
 */

import { geTax } from '@/lib/osrs/ge';

export type Side = 'buy' | 'sell';

export type Trade = {
  id: string;
  itemId: number;
  itemName: string;
  side: Side;
  quantity: number;
  /** Per unit, in gp. */
  price: number;
  executedAt: Date;
  /** Stored at execution. Null on buys; the GE taxes the seller only. */
  taxPaid: number | null;
  note: string | null;
};

/** One sell matched against one earlier buy. The atom of realised P&L. */
export type Close = {
  itemId: number;
  itemName: string;
  quantity: number;
  buyPrice: number;
  sellPrice: number;
  /** What the quantity cost to acquire. */
  cost: number;
  /** Gross receipts before tax. */
  gross: number;
  tax: number;
  /** gross - tax - cost. The only profit figure that means anything. */
  profit: number;
  openedAt: Date;
  closedAt: Date;
  /** Milliseconds the capital was tied up. */
  heldMs: number;
};

/** An open position: quantity still held, and what it cost. */
export type Position = {
  itemId: number;
  itemName: string;
  quantity: number;
  /** Weighted average of the remaining lots, not of everything ever bought. */
  avgCost: number;
  costBasis: number;
  oldestOpenedAt: Date;
  /** Current instant-buy price, or null when the item has no market price. */
  mark: number | null;
  /** quantity x mark, before tax. Null when unmarkable. */
  marketValue: number | null;
  /** What closing the whole position right now would clear, after tax. */
  unrealised: number | null;
  unrealisedPct: number | null;
};

/**
 * A sell with no buy to match it.
 *
 * Reported rather than absorbed. The tempting shortcut is to treat the
 * missing cost as zero, which turns an incomplete journal into an enormous
 * fictional profit — the single most misleading thing this file could do.
 */
export type UnmatchedSell = {
  itemId: number;
  itemName: string;
  quantity: number;
  sellPrice: number;
  executedAt: Date;
};

export type Portfolio = {
  positions: Position[];
  closes: Close[];
  unmatched: UnmatchedSell[];
  method: 'FIFO';
};

type OpenLot = { quantity: number; price: number; openedAt: Date };

/**
 * Build positions and realised closes from a blotter.
 *
 * `marks` maps item id to its current instant-buy price. Items missing from
 * it are left unmarked rather than valued at zero.
 */
export function buildPortfolio(trades: Trade[], marks: Map<number, number | null>): Portfolio {
  const byItem = new Map<number, Trade[]>();
  for (const t of trades) {
    const list = byItem.get(t.itemId);
    if (list) list.push(t);
    else byItem.set(t.itemId, [t]);
  }

  const positions: Position[] = [];
  const closes: Close[] = [];
  const unmatched: UnmatchedSell[] = [];

  for (const [itemId, itemTrades] of byItem) {
    // Chronological, with id as a tiebreak so two fills in the same second
    // match deterministically rather than depending on row order.
    const ordered = itemTrades
      .slice()
      .sort((a, b) => a.executedAt.getTime() - b.executedAt.getTime() || a.id.localeCompare(b.id));

    const lots: OpenLot[] = [];
    let itemName = ordered[0].itemName;

    for (const t of ordered) {
      itemName = t.itemName;

      if (t.side === 'buy') {
        lots.push({ quantity: t.quantity, price: t.price, openedAt: t.executedAt });
        continue;
      }

      let remaining = t.quantity;
      // Tax is charged per unit on the sale, so a partial match carries a
      // proportional share of it rather than the whole trade's tax.
      const taxPerUnit =
        t.taxPaid !== null && t.quantity > 0 ? t.taxPaid / t.quantity : geTax(t.price, t.itemId);

      while (remaining > 0 && lots.length > 0) {
        const lot = lots[0];
        const matched = Math.min(remaining, lot.quantity);

        const cost = lot.price * matched;
        const gross = t.price * matched;
        const tax = Math.round(taxPerUnit * matched);

        closes.push({
          itemId,
          itemName,
          quantity: matched,
          buyPrice: lot.price,
          sellPrice: t.price,
          cost,
          gross,
          tax,
          profit: gross - tax - cost,
          openedAt: lot.openedAt,
          closedAt: t.executedAt,
          heldMs: Math.max(0, t.executedAt.getTime() - lot.openedAt.getTime()),
        });

        lot.quantity -= matched;
        remaining -= matched;
        if (lot.quantity === 0) lots.shift();
      }

      if (remaining > 0) {
        unmatched.push({
          itemId,
          itemName,
          quantity: remaining,
          sellPrice: t.price,
          executedAt: t.executedAt,
        });
      }
    }

    const quantity = lots.reduce((sum, l) => sum + l.quantity, 0);
    if (quantity > 0) {
      const costBasis = lots.reduce((sum, l) => sum + l.price * l.quantity, 0);
      const mark = marks.get(itemId) ?? null;
      const marketValue = mark === null ? null : mark * quantity;
      // Marked to what closing would actually clear: the tax comes off on
      // the way out, so a position is worth less than its market value.
      const unrealised =
        mark === null ? null : marketValue! - geTax(mark, itemId) * quantity - costBasis;

      positions.push({
        itemId,
        itemName,
        quantity,
        avgCost: costBasis / quantity,
        costBasis,
        oldestOpenedAt: lots[0].openedAt,
        mark,
        marketValue,
        unrealised,
        unrealisedPct:
          unrealised === null || costBasis === 0 ? null : (unrealised / costBasis) * 100,
      });
    }
  }

  positions.sort((a, b) => b.costBasis - a.costBasis);
  closes.sort((a, b) => b.closedAt.getTime() - a.closedAt.getTime());

  return { positions, closes, unmatched, method: 'FIFO' };
}

// ---------------------------------------------------------------- analytics

export type Stats = {
  trades: number;
  realised: number;
  grossProfit: number;
  grossLoss: number;
  /** Gross profit over gross loss. Above 1 is a profitable book. */
  profitFactor: number | null;
  wins: number;
  losses: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** Expected gp per close, from this book's own win rate and sizes. */
  expectancy: number | null;
  /** Largest peak-to-trough fall in cumulative realised P&L. */
  maxDrawdown: number;
  totalTax: number;
  capitalDeployed: number;
  /** Realised profit over the capital it took to make it. */
  returnOnCapital: number | null;
  medianHoldMs: number | null;
  best: Close | null;
  worst: Close | null;
};

export function computeStats(closes: Close[]): Stats {
  const empty: Stats = {
    trades: 0,
    realised: 0,
    grossProfit: 0,
    grossLoss: 0,
    profitFactor: null,
    wins: 0,
    losses: 0,
    winRate: null,
    avgWin: null,
    avgLoss: null,
    expectancy: null,
    maxDrawdown: 0,
    totalTax: 0,
    capitalDeployed: 0,
    returnOnCapital: null,
    medianHoldMs: null,
    best: null,
    worst: null,
  };
  if (closes.length === 0) return empty;

  const wins = closes.filter((c) => c.profit > 0);
  const losses = closes.filter((c) => c.profit < 0);

  const grossProfit = wins.reduce((s, c) => s + c.profit, 0);
  const grossLoss = Math.abs(losses.reduce((s, c) => s + c.profit, 0));
  const realised = closes.reduce((s, c) => s + c.profit, 0);
  const capitalDeployed = closes.reduce((s, c) => s + c.cost, 0);

  const avgWin = wins.length ? grossProfit / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const winRate = closes.length ? wins.length / closes.length : null;

  // Chronological for the drawdown walk; `closes` arrives newest-first.
  const chrono = closes.slice().sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());
  let running = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const c of chrono) {
    running += c.profit;
    if (running > peak) peak = running;
    const drawdown = peak - running;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }

  const holds = closes.map((c) => c.heldMs).sort((a, b) => a - b);
  const mid = Math.floor(holds.length / 2);
  const medianHoldMs =
    holds.length % 2 === 0 ? Math.round((holds[mid - 1] + holds[mid]) / 2) : holds[mid];

  return {
    trades: closes.length,
    realised,
    grossProfit,
    grossLoss,
    // Null rather than Infinity when nothing has lost money: a book with no
    // losses has an undefined ratio, and printing ∞ reads as a bug.
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : null,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgWin,
    avgLoss,
    expectancy: winRate === null ? null : winRate * (avgWin ?? 0) - (1 - winRate) * (avgLoss ?? 0),
    maxDrawdown,
    totalTax: closes.reduce((s, c) => s + c.tax, 0),
    capitalDeployed,
    returnOnCapital: capitalDeployed > 0 ? (realised / capitalDeployed) * 100 : null,
    medianHoldMs,
    best: closes.reduce((a, b) => (b.profit > a.profit ? b : a)),
    worst: closes.reduce((a, b) => (b.profit < a.profit ? b : a)),
  };
}

/**
 * Cumulative realised P&L over time.
 *
 * Starts at zero, at the moment the first position was opened. Without that
 * anchor the curve begins at whatever the first close happened to make —
 * which on a book whose first trade was large draws as a solid block pinned
 * to the top of the chart, showing nothing. The zero point is where the
 * money actually started.
 */
export function equityCurve(closes: Close[]): { t: number; pnl: number }[] {
  if (closes.length === 0) return [];
  const chrono = closes.slice().sort((a, b) => a.closedAt.getTime() - b.closedAt.getTime());

  const firstOpen = Math.min(...chrono.map((c) => c.openedAt.getTime()));
  const points: { t: number; pnl: number }[] = [{ t: firstOpen, pnl: 0 }];

  let running = 0;
  for (const c of chrono) {
    running += c.profit;
    points.push({ t: c.closedAt.getTime(), pnl: running });
  }
  return points;
}

export type ItemBreakdown = {
  itemId: number;
  itemName: string;
  trades: number;
  realised: number;
  volume: number;
  winRate: number | null;
};

/** Which items actually make money — usually a surprise. */
export function byItem(closes: Close[]): ItemBreakdown[] {
  const map = new Map<number, ItemBreakdown & { wins: number }>();
  for (const c of closes) {
    const row = map.get(c.itemId) ?? {
      itemId: c.itemId,
      itemName: c.itemName,
      trades: 0,
      realised: 0,
      volume: 0,
      winRate: null,
      wins: 0,
    };
    row.trades += 1;
    row.realised += c.profit;
    row.volume += c.quantity;
    if (c.profit > 0) row.wins += 1;
    map.set(c.itemId, row);
  }
  return [...map.values()]
    .map(({ wins, ...r }) => ({ ...r, winRate: r.trades ? wins / r.trades : null }))
    .sort((a, b) => b.realised - a.realised);
}

/** How concentrated the open book is. Real risk, cheaply measured. */
export function concentration(positions: Position[]): { itemName: string; pct: number }[] {
  const total = positions.reduce((s, p) => s + p.costBasis, 0);
  if (total === 0) return [];
  return positions
    .map((p) => ({ itemName: p.itemName, pct: (p.costBasis / total) * 100 }))
    .sort((a, b) => b.pct - a.pct);
}
