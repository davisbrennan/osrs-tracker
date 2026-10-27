/**
 * Price alerts, over the email path that already exists.
 *
 * Runs straight after each price poll rather than on its own schedule, so an
 * alert can never be evaluated against prices older than the ones that just
 * landed.
 */

import { eq, and, isNotNull, inArray } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAlerts, osrsPrices, osrsItems, users } from '@/database/schema';
import { sendEmail } from '@/lib/email';
import { formatGp, marginPerUnit, breakevenSellPrice } from '@/lib/osrs/ge';
import type { JobResult } from '@/lib/osrs/jobs/util';

export async function checkAlerts(now: Date = new Date()): Promise<JobResult> {
  const candidates = await db
    .select({
      id: osrsAlerts.id,
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

  const toFire: typeof candidates = [];
  let onCooldown = 0;
  let noPrice = 0;

  for (const a of candidates) {
    const price = a.priceSide === 'high' ? a.high : a.low;
    // A null price is "never traded", not "zero". Firing a below-threshold
    // alert on it would mail about every untraded item in the game.
    if (price === null) {
      noPrice++;
      continue;
    }

    const triggered = a.direction === 'below' ? price <= a.threshold : price >= a.threshold;
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
  direction: 'below' | 'above';
  threshold: number;
  priceSide: 'low' | 'high';
  price: number;
  buy: number | null;
  sell: number | null;
  buyLimit: number | null;
}) {
  const sideLabel = opts.priceSide === 'high' ? 'instant-buy' : 'instant-sell';
  const subject = `${opts.itemName} is ${opts.direction} ${formatGp(opts.threshold)}`;

  const lines: string[] = [
    `${opts.itemName} — ${sideLabel} price is now ${formatGp(opts.price)} (${opts.price.toLocaleString('en-US')} gp).`,
    `Your alert: ${opts.direction} ${formatGp(opts.threshold)}.`,
  ];

  if (opts.buy !== null && opts.sell !== null) {
    const margin = marginPerUnit(opts.buy, opts.sell, opts.itemId);
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

  const base = process.env.APP_URL ?? process.env.SITE_URL ?? '';
  const url = base ? `${base}/ge/item/${opts.itemId}` : '';
  if (url) lines.push('', url);

  return {
    subject,
    text: lines.join('\n'),
    html: `<!doctype html><html><body style="margin:0;padding:32px;background:#13100d;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#efe6d6">
  <div style="max-width:520px;margin:0 auto;background:#1c1813;border:1px solid #3a3228;border-radius:8px;padding:28px">
    <h1 style="margin:0 0 6px;font-size:20px;line-height:1.3">${escapeHtml(opts.itemName)}</h1>
    <p style="margin:0 0 20px;color:#a39682;font-size:14px">${sideLabel} price is now <strong style="color:#efe6d6">${formatGp(opts.price)}</strong></p>
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
