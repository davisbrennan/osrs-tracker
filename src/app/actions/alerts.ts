'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc, count } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAlerts, osrsItems, osrsPrices } from '@/database/schema';
import { requireUser, currentUser } from '@/lib/session';
import { parseGp } from '@/lib/osrs/ge';
import { MAX_ALERTS, MIN_COOLDOWN_MINUTES } from '@/lib/osrs/constants';

export type AlertResult = { ok: true; message: string } | { ok: false; error: string };

export type AlertRow = {
  id: string;
  kind: string;
  direction: string;
  threshold: number;
  priceSide: string;
  cooldownMinutes: number;
  active: boolean;
  lastFiredAt: Date | null;
  createdAt: Date;
  itemId: number;
  itemName: string;
  low: number | null;
  high: number | null;
};

export async function alertsFor(userId: string): Promise<AlertRow[]> {
  return db
    .select({
      id: osrsAlerts.id,
      kind: osrsAlerts.kind,
      direction: osrsAlerts.direction,
      threshold: osrsAlerts.threshold,
      priceSide: osrsAlerts.priceSide,
      cooldownMinutes: osrsAlerts.cooldownMinutes,
      active: osrsAlerts.active,
      lastFiredAt: osrsAlerts.lastFiredAt,
      createdAt: osrsAlerts.createdAt,
      itemId: osrsItems.id,
      itemName: osrsItems.name,
      low: osrsPrices.low,
      high: osrsPrices.high,
    })
    .from(osrsAlerts)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsAlerts.itemId))
    .leftJoin(osrsPrices, eq(osrsPrices.itemId, osrsAlerts.itemId))
    .where(eq(osrsAlerts.userId, userId))
    .orderBy(desc(osrsAlerts.createdAt));
}

export async function myAlerts(): Promise<AlertRow[]> {
  const user = await currentUser();
  return user ? alertsFor(user.id) : [];
}

export async function createAlert(formData: FormData): Promise<AlertResult> {
  const user = await requireUser();

  const itemId = Number(formData.get('itemId'));
  const kind = String(formData.get('kind') ?? 'price');
  const direction = String(formData.get('direction') ?? 'below');
  const priceSide = String(formData.get('priceSide') ?? 'low');
  const cooldownRaw = Number(formData.get('cooldownMinutes'));
  const thresholdRaw = String(formData.get('threshold') ?? '').trim();

  if (!Number.isInteger(itemId) || itemId <= 0) {
    return { ok: false, error: 'Pick an item first.' };
  }
  if (!['price', 'margin', 'unusual'].includes(kind)) {
    return { ok: false, error: 'Unknown alert type.' };
  }
  if (!['below', 'above'].includes(direction)) {
    return { ok: false, error: 'An alert fires either below or above.' };
  }
  if (!['low', 'high'].includes(priceSide)) {
    return { ok: false, error: 'Pick which side of the book to watch.' };
  }

  // The threshold means a different thing per kind, so it is validated
  // per kind rather than as one number that happens to fit all three.
  let threshold: number;
  if (kind === 'unusual') {
    const pct = Number(thresholdRaw);
    if (!Number.isFinite(pct) || pct < 50 || pct > 100) {
      return {
        ok: false,
        error: 'A percentile between 50 and 100. Below 50 is not unusual, it is most of the time.',
      };
    }
    threshold = Math.round(pct);
  } else {
    const gp = parseGp(thresholdRaw);
    if (gp === null || gp < 0) {
      return { ok: false, error: 'A gp amount — 1.5m, 250k and 1500000 all work.' };
    }
    threshold = gp;
  }

  const cooldownMinutes =
    Number.isFinite(cooldownRaw) && cooldownRaw >= MIN_COOLDOWN_MINUTES
      ? Math.round(cooldownRaw)
      : 360;

  const [item] = await db
    .select({ id: osrsItems.id, name: osrsItems.name })
    .from(osrsItems)
    .where(eq(osrsItems.id, itemId))
    .limit(1);
  if (!item) return { ok: false, error: 'That item is not in the catalogue.' };

  const [{ value: existing }] = await db
    .select({ value: count() })
    .from(osrsAlerts)
    .where(eq(osrsAlerts.userId, user.id));
  if (existing >= MAX_ALERTS) {
    return {
      ok: false,
      error: `That is the ${MAX_ALERTS}-alert limit. Delete one you no longer need first.`,
    };
  }

  await db.insert(osrsAlerts).values({
    userId: user.id,
    itemId,
    kind,
    direction: kind === 'unusual' ? 'above' : direction,
    threshold,
    priceSide,
    cooldownMinutes,
    active: true,
  });

  revalidatePath('/alerts');
  revalidatePath(`/item/${itemId}`);
  return {
    ok: true,
    message:
      kind === 'unusual'
        ? `Watching ${item.name} for an unusually wide margin.`
        : `Alert set on ${item.name}.`,
  };
}

export async function deleteAlert(id: string): Promise<AlertResult> {
  const user = await requireUser();
  await db.delete(osrsAlerts).where(and(eq(osrsAlerts.id, id), eq(osrsAlerts.userId, user.id)));
  revalidatePath('/alerts');
  return { ok: true, message: 'Alert deleted.' };
}

/** Pause without losing the setup, which is what people actually want. */
export async function toggleAlert(id: string): Promise<AlertResult> {
  const user = await requireUser();
  const [row] = await db
    .select({ active: osrsAlerts.active })
    .from(osrsAlerts)
    .where(and(eq(osrsAlerts.id, id), eq(osrsAlerts.userId, user.id)))
    .limit(1);
  if (!row) return { ok: false, error: 'That alert no longer exists.' };

  await db
    .update(osrsAlerts)
    .set({ active: !row.active })
    .where(and(eq(osrsAlerts.id, id), eq(osrsAlerts.userId, user.id)));

  revalidatePath('/alerts');
  return { ok: true, message: row.active ? 'Alert paused.' : 'Alert resumed.' };
}
