/**
 * Price alerts, over the email path that already exists.
 *
 * Runs straight after each price poll rather than on its own schedule, so an
 * alert can never be evaluated against prices older than the ones that just
 * landed.
 */

import { eq, and, isNotNull, inArray, gte } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAlerts, osrsPrices, osrsItems, users, osrsPriceDaily } from '@/database/schema';
import { sendEmail } from '@/lib/email';
import { formatGp, marginPerUnit, breakevenSellPrice } from '@/lib/osrs/ge';
import { historyContext, CONTEXT_DAYS, type DailyBar } from '@/lib/osrs/stats';
import type { JobResult } from '@/lib/osrs/jobs/util';

export type AlertKind = 'price' | 'margin' | 'unusual';

/**
 * Does this alert's condition hold right now?
 *
 * Split out and exported so the three kinds can be tested without a
 * database, an email service or a clock. The firing path around it is
 * plumbing; this is the part that decides whether somebody gets mailed.
 */
export function alertTriggered(opts: {
  kind: AlertKind;
  direction: 'below' | 'above';
  threshold: number;
  priceSide: 'low' | 'high';
  low: number | null;
  high: number | null;
  /** Percentile of the current margin against the item's own history. */
  spreadPercentile?: number | null;
}): boolean {
  if (opts.kind === 'price') {
    const price = opts.priceSide === 'high' ? opts.high : opts.low;
    // A null price means "never traded", not "zero". Treating it as zero
    // would mail about every untraded item in the game on a below alert.
    if (price === null) return false;
    return opts.direction === 'below' ? price <= opts.threshold : price >= opts.threshold;
  }

  if (opts.kind === 'margin') {
    if (opts.low === null || opts.high === null) return false;
    const margin = marginPerUnit(opts.low, opts.high);
    return opts.direction === 'below' ? margin <= opts.threshold : margin >= opts.threshold;
  }

  // unusual: the margin has to be both historically wide AND actually
  // positive. Without the second test an item that normally has no spread
  // fires the moment it has one of a single gp, which is the failure the
  // Unusual page guards against too.
  if (opts.spreadPercentile === null || opts.spreadPercentile === undefined) return false;
  if (opts.low === null || opts.high === null) return false;
  if (marginPerUnit(opts.low, opts.high) <= 0) return false;
  return opts.spreadPercentile >= opts.threshold;
}

export async function checkAlerts(now: Date = new Date()): Promise<JobResult> {
  const candidates = await db
    .select({
      id: osrsAlerts.id,
      kind: osrsAlerts.kind,
      direction: osrsAlerts.direction,
      threshold: osrsAlerts.threshold,
      priceSide: osrsAlerts.priceSide,
      lastFiredAt: osrsAlerts.lastFiredAt,
      cooldownMinutes: osrsAlerts.cooldownMinutes,
      itemId: osrsItems.id,
      itemName: osrsItems.name,
      buyLimit: osrsItems.buyLimit,
      high: osrsPrices.high,
      low: osrsPrices.low,
      email: users.email,
      userName: users.name,
    })
    .from(osrsAlerts)
    .innerJoin(osrsPrices, eq(osrsPrices.itemId, osrsAlerts.itemId))
    .innerJoin(osrsItems, eq(osrsItems.id, osrsAlerts.itemId))
    .innerJoin(users, eq(users.id, osrsAlerts.userId))
    // A deleted account's alerts stop mattering the moment it is deleted.
    .where(and(eq(osrsAlerts.active, true), isNotNull(users.email)));

  /* Percentiles are only loaded for the items that actually need them, so a
     book full of ordinary price alerts costs nothing extra. */
  const unusualItemIds = [
    ...new Set(candidates.filter((a) => a.kind === 'unusual').map((a) => a.itemId)),
  ];
  const percentiles = new Map<number, number | null>();
  if (unusualItemIds.length > 0) {
    const since = new Date(Date.now() - CONTEXT_DAYS * 86_400_000).toISOString().slice(0, 10);
    const bars = await db
      .select({
        itemId: osrsPriceDaily.itemId,
        day: osrsPriceDaily.day,
        avgHigh: osrsPriceDaily.avgHigh,
        avgLow: osrsPriceDaily.avgLow,
        volume: osrsPriceDaily.volume,
      })
      .from(osrsPriceDaily)
      .where(and(inArray(osrsPriceDaily.itemId, unusualItemIds), gte(osrsPriceDaily.day, since)));

    const byItem = new Map<number, DailyBar[]>();
    for (const b of bars) {
      const list = byItem.get(b.itemId) ?? [];
      list.push({
        day: new Date(`${b.day}T00:00:00Z`),
        avgHigh: b.avgHigh,
        avgLow: b.avgLow,
        volume: b.volume,
      });
      byItem.set(b.itemId, list);
    }
    for (const id of unusualItemIds) {
      const row = candidates.find((c) => c.itemId === id);
      const ctx = historyContext(byItem.get(id) ?? [], row?.low ?? null, row?.high ?? null, null);
      // Below the sample floor this is null, and an unusual alert on an item
      // with no history must stay silent rather than guess.
      percentiles.set(id, ctx.enough ? ctx.spreadPercentile : null);
    }
  }

  const toFire: typeof candidates = [];
  let onCooldown = 0;
  let noPrice = 0;

  for (const a of candidates) {
    if (a.kind === 'price' && (a.priceSide === 'high' ? a.high : a.low) === null) {
      noPrice++;
      continue;
    }

    const triggered = alertTriggered({
      kind: a.kind as AlertKind,
      direction: a.direction as 'below' | 'above',
      threshold: a.threshold,
      priceSide: a.priceSide as 'low' | 'high',
      low: a.low,
      high: a.high,
      spreadPercentile: percentiles.get(a.itemId) ?? null,
    });
    if (!triggered) continue;

    if (a.lastFiredAt) {
      const elapsedMinutes = (now.getTime() - a.lastFiredAt.getTime()) / 60_000;
      if (elapsedMinutes < a.cooldownMinutes) {
        onCooldown++;
        continue;
      }
    }

    toFire.push(a);
  }

  let sent = 0;
  let failed = 0;
  const firedIds: string[] = [];

  for (const a of toFire) {
    const price = (a.priceSide === 'high' ? a.high : a.low) as number;
    try {
      const mail = alertEmail({
        itemName: a.itemName,
        itemId: a.itemId,
        kind: a.kind as AlertKind,
        spreadPercentile: percentiles.get(a.itemId) ?? null,
        direction: a.direction as 'below' | 'above',
        threshold: a.threshold,
        priceSide: a.priceSide as 'low' | 'high',
        price,
        buy: a.low,
        sell: a.high,
        buyLimit: a.buyLimit,
      });
      await sendEmail({ to: a.email, ...mail });
      sent++;
      firedIds.push(a.id);
    } catch (err) {
      // One bad address must not stop the rest of the batch, and the alert is
      // deliberately NOT stamped as fired — so it retries next poll rather
      // than going quiet for the whole cooldown on a transient failure.
      failed++;
      console.error(
        `[osrs] alert email failed for ${a.itemName}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  // Stamped in one statement after the sends, so a crash mid-batch re-sends
  // at worst a duplicate rather than silently swallowing alerts.
  if (firedIds.length > 0) {
    await db.update(osrsAlerts).set({ lastFiredAt: now }).where(inArray(osrsAlerts.id, firedIds));
  }

  return { checked: candidates.length, sent, failed, onCooldown, noPrice };
}

/**
 * The alert email.
 *
 * It carries the flip maths rather than just the number that tripped,
 * because "Abyssal whip dropped below 1.5M" on its own does not tell you
 * whether there is anything in it — and the breakeven line is the part
 * people get wrong, since the tax is charged on the sale.
 */
export function alertEmail(opts: {
  itemName: string;
  itemId: number;
  kind?: AlertKind;
  direction: 'below' | 'above';
  threshold: number;
  priceSide: 'low' | 'high';
  price: number;
  buy: number | null;
  sell: number | null;
  buyLimit: number | null;
  spreadPercentile?: number | null;
}) {
  const kind: AlertKind = opts.kind ?? 'price';
  const sideLabel = opts.priceSide === 'high' ? 'instant-buy' : 'instant-sell';

  // The subject has to say which condition tripped. "is below 1.5M" on an
  // alert about an unusually wide margin is simply a different sentence
  // about a different thing.
  const margin =
    opts.buy !== null && opts.sell !== null
      ? marginPerUnit(opts.buy, opts.sell, opts.itemId)
      : null;

  const subject =
    kind === 'unusual'
      ? `${opts.itemName} — margin is unusually wide`
      : kind === 'margin'
        ? `${opts.itemName} — margin is ${opts.direction} ${formatGp(opts.threshold)}`
        : `${opts.itemName} is ${opts.direction} ${formatGp(opts.threshold)}`;

  const lines: string[] =
    kind === 'unusual'
      ? [
          `${opts.itemName} — the margin after tax is ${margin === null ? 'unknown' : formatGp(margin)} per unit.`,
          opts.spreadPercentile === null || opts.spreadPercentile === undefined
            ? `Your alert: margin in the top of its own 90-day range.`
            : `That is wider than ${opts.spreadPercentile.toFixed(0)}% of the last 90 days for this item — your alert fires at ${opts.threshold}%.`,
        ]
      : kind === 'margin'
        ? [
            `${opts.itemName} — margin after tax is now ${margin === null ? 'unknown' : formatGp(margin)} per unit.`,
            `Your alert: margin ${opts.direction} ${formatGp(opts.threshold)}.`,
          ]
        : [
            `${opts.itemName} — ${sideLabel} price is now ${formatGp(opts.price)} (${opts.price.toLocaleString('en-US')} gp).`,
            `Your alert: ${opts.direction} ${formatGp(opts.threshold)}.`,
          ];

  if (opts.buy !== null && opts.sell !== null && margin !== null) {
    const breakeven = breakevenSellPrice(opts.buy, opts.itemId);
    lines.push(
      '',
      `Buy at ${formatGp(opts.buy)} / sell at ${formatGp(opts.sell)}.`,
      `Margin after tax: ${formatGp(margin)} per unit.`,
      `Breakeven sell price: ${formatGp(breakeven)} — below that it is a loss.`
    );
    if (opts.buyLimit) {
      lines.push(`Buy limit: ${opts.buyLimit.toLocaleString('en-US')} per 4 hours.`);
    }
  } else {
    lines.push('', 'No complete two-sided price right now, so there is no margin to quote.');
  }

  // The route is /item/[id]. This said /ge/item/, which is not a route this
  // app has ever had, so the main button in every alert email was a 404.
  const base = process.env.APP_URL ?? process.env.SITE_URL ?? '';
  const url = base ? `${base}/item/${opts.itemId}` : '';
  if (url) lines.push('', url);

  return {
    subject,
    text: lines.join('\n'),
    html: `<!doctype html><html><body style="margin:0;padding:32px;background:#13100d;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#efe6d6">
  <div style="max-width:520px;margin:0 auto;background:#1c1813;border:1px solid #3a3228;border-radius:8px;padding:28px">
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3">${escapeHtml(opts.itemName)}</h1>
    <p style="margin:0 0 20px;color:#a39682;font-size:14px">${
      kind === 'price'
        ? `${sideLabel} price is now <strong style="color:#efe6d6">${formatGp(opts.price)}</strong>`
        : `margin after tax is now <strong style="color:#efe6d6">${margin === null ? 'unknown' : formatGp(margin)}</strong> per unit`
    }</p>
    ${lines
      .slice(1)
      .filter((l) => l && !l.startsWith('http'))
      .map(
        (l) =>
          `<p style="margin:0 0 8px;color:#a39682;font-size:14px;line-height:1.6">${escapeHtml(l)}</p>`
      )
      .join('')}
    ${
      url
        ? `<p style="margin:24px 0 0"><a href="${url}" style="display:inline-block;background:#c8a24a;color:#1c1813;text-decoration:none;padding:11px 20px;border-radius:6px;font-weight:600">Open the item</a></p>`
        : ''
    }
  </div></body></html>`,
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
