/**
 * What should I do right now?
 *
 * Every other page answers a question you already had. This one has to
 * work out what the question is, which makes it the easiest page on the
 * site to get wrong — and the failure mode is specific.
 *
 * A dashboard that always has something urgent to show you is lying. Most
 * of the time nothing needs doing, and a page that manufactures a card to
 * fill the space trains you to ignore all of them, including the one that
 * mattered. So everything here is allowed to be empty, and "nothing needs
 * you" is a result this page is happy to report.
 *
 * The second rule: an opportunity is not attention. A good flip is an
 * invitation; a position that has moved against you is a problem. They are
 * sorted into different parts of the page and the problems come first,
 * because a tool that leads with opportunities is a shop window.
 */

import type { Opportunity } from '@/lib/osrs/ge';
import type { Position } from '@/lib/osrs/portfolio';

/* ------------------------------------------------------------------ */
/* Things that need you                                                */
/* ------------------------------------------------------------------ */

export type Attention = {
  id: string;
  /** How loud. 'warn' is worth a look; 'info' is worth knowing. */
  level: 'warn' | 'info';
  title: string;
  detail: string;
  href: string;
};

/**
 * How far a position may drift before it is worth saying so.
 *
 * Not zero. A position a percent under water is noise — the spread alone
 * accounts for that the moment you buy — and flagging it would put a
 * warning on nearly every open flip the instant it opened.
 */
export const DRIFT_WARN_PCT = -8;

/** A position open this long without selling is sitting rather than flipping. */
export const STALE_POSITION_DAYS = 7;

/** Hiscores older than this make every level-based claim on the page suspect. */
export const HISCORES_STALE_DAYS = 7;

export function positionAttention(
  positions: Position[],
  now: Date = new Date()
): Attention[] {
  const out: Attention[] = [];

  for (const p of positions) {
    // Unmarkable positions are reported as unknown rather than skipped: an
    // item with no current price is exactly the kind you can get stranded
    // in, and silence about it reads as "fine".
    if (p.mark === null || p.unrealisedPct === null) {
      out.push({
        id: `unpriced-${p.itemId}`,
        level: 'info',
        title: `${p.itemName} has no current price`,
        detail: `You are holding ${p.quantity.toLocaleString('en-US')}, and the Grand Exchange has no price for at least one side — so what it is worth right now is genuinely unknown.`,
        href: `/item/${p.itemId}`,
      });
      continue;
    }

    if (p.unrealisedPct <= DRIFT_WARN_PCT) {
      out.push({
        id: `drift-${p.itemId}`,
        level: 'warn',
        title: `${p.itemName} is ${Math.abs(p.unrealisedPct).toFixed(1)}% under water`,
        // "would clear -940" is not a sentence anyone says. A loss is
        // phrased as a loss.
        detail: `Closing it now would leave you ${Math.abs(p.unrealised ?? 0).toLocaleString('en-US')} down on a cost of ${p.costBasis.toLocaleString('en-US')}.`,
        href: `/item/${p.itemId}`,
      });
      continue;
    }

    const days = (now.getTime() - p.oldestOpenedAt.getTime()) / 86_400_000;
    if (days >= STALE_POSITION_DAYS) {
      out.push({
        id: `sitting-${p.itemId}`,
        level: 'info',
        title: `${p.itemName} has been open ${Math.floor(days)} days`,
        detail:
          'Capital tied up in a position that is not moving is capital not flipping anything else.',
        href: `/item/${p.itemId}`,
      });
    }
  }

  // Worst first, and a stable order within a level so the page does not
  // reshuffle between loads.
  return out.sort(
    (a, b) => (a.level === b.level ? a.id.localeCompare(b.id) : a.level === 'warn' ? -1 : 1)
  );
}

export function dataAttention(facts: {
  hiscoresAgeDays: number | null;
  hasAccount: boolean;
}): Attention[] {
  if (!facts.hasAccount) {
    return [
      {
        id: 'no-account',
        level: 'info',
        title: 'No account tracked yet',
        detail:
          'Money makers and unlocks are both worked out against your levels, so they cannot say much until an RSN is attached.',
        href: '/accounts',
      },
    ];
  }

  if (facts.hiscoresAgeDays !== null && facts.hiscoresAgeDays >= HISCORES_STALE_DAYS) {
    return [
      {
        id: 'stale-hiscores',
        level: 'info',
        title: `Hiscores are ${Math.floor(facts.hiscoresAgeDays)} days old`,
        detail:
          'Anything on this page that depends on your levels is working from that snapshot, so it may be further behind than you are.',
        href: '/accounts',
      },
    ];
  }

  return [];
}

/* ------------------------------------------------------------------ */
/* Things you could do                                                 */
/* ------------------------------------------------------------------ */

/**
 * The best flip you can actually fund.
 *
 * Deliberately not "the biggest margin". A margin you cannot afford to take
 * is not an opportunity, and `profitPerWindow` already accounts for the buy
 * limit and the cash stack — so the ordering here is by what the flip would
 * actually put in your pocket.
 *
 * Confidence is a filter rather than a tiebreak: leading a dashboard with a
 * fat margin on something that trades twice a day is how this page would
 * lose someone money.
 */
export function bestFlip(opportunities: Opportunity[]): Opportunity | null {
  const usable = opportunities.filter(
    (o) => o.unitsPerWindow > 0 && o.profitPerWindow > 0 && o.confidence === 'good'
  );
  if (usable.length === 0) return null;
  return usable.reduce((best, o) => (o.profitPerWindow > best.profitPerWindow ? o : best));
}

/** Share of your cash one flip would consume, for the "can I afford it" line. */
export function capitalShare(capitalRequired: number, cashStack: number): number | null {
  if (cashStack <= 0) return null;
  return Math.min(100, Math.round((capitalRequired / cashStack) * 100));
}

/* ------------------------------------------------------------------ */
/* Standing                                                            */
/* ------------------------------------------------------------------ */

export type Standing = {
  cashStack: number;
  /** What the open book is worth at current prices, after tax. */
  openValue: number | null;
  /** Profit if everything open were closed now. Null when anything is unmarkable. */
  openUnrealised: number | null;
  positionCount: number;
  /** Cash plus what the book would clear. The number people mean by "worth". */
  total: number | null;
};

/**
 * Cash plus the book.
 *
 * `openValue` is null when ANY position cannot be marked, rather than
 * summing the ones that can. A total that silently omits an item reads as
 * complete and is not, and being told "unknown" is more useful than being
 * told a number that is quietly missing a chunk.
 */
export function standing(positions: Position[], cashStack: number): Standing {
  const anyUnmarkable = positions.some((p) => p.marketValue === null || p.unrealised === null);

  if (positions.length === 0) {
    return {
      cashStack,
      openValue: 0,
      openUnrealised: 0,
      positionCount: 0,
      total: cashStack,
    };
  }

  if (anyUnmarkable) {
    return {
      cashStack,
      openValue: null,
      openUnrealised: null,
      positionCount: positions.length,
      total: null,
    };
  }

  const openValue = positions.reduce((sum, p) => sum + (p.marketValue ?? 0), 0);
  const openUnrealised = positions.reduce((sum, p) => sum + (p.unrealised ?? 0), 0);
  const costBasis = positions.reduce((sum, p) => sum + p.costBasis, 0);

  return {
    cashStack,
    openValue,
    openUnrealised,
    positionCount: positions.length,
    // What you would have if you closed everything: the cash you are holding
    // back, plus the cost you already sank, plus what you would make on it.
    total: cashStack + costBasis + openUnrealised,
  };
}

/** "Good evening" is a lie at 3am; this is not. */
export function greeting(hour: number): string {
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return 'Hello';
  if (hour < 5) return 'Still up';
  if (hour < 12) return 'Morning';
  if (hour < 18) return 'Afternoon';
  return 'Evening';
}
