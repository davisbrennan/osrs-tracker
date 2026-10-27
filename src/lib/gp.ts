/**
 * Presenting gp.
 *
 * The thresholds here are the game's, not ours: Old School RuneScape draws an
 * item stack yellow below 100,000, white from 100,000 to 10,000,000, and
 * green above 10,000,000. Players have been reading quantity by colour for
 * twenty years, so reusing those three means magnitude registers before the
 * digits are read. Picking our own thresholds would look similar and teach
 * the wrong instinct.
 */

export type GpBand = 'small' | 'mid' | 'large';

export const GP_MID_THRESHOLD = 100_000;
export const GP_LARGE_THRESHOLD = 10_000_000;

export function gpBand(amount: number): GpBand {
  const n = Math.abs(amount);
  if (n >= GP_LARGE_THRESHOLD) return 'large';
  if (n >= GP_MID_THRESHOLD) return 'mid';
  return 'small';
}

/** The class that colours a figure. Pair with <span className={gpClass(n)}>. */
export function gpClass(amount: number): string {
  return `gp gp-${gpBand(amount)}`;
}

/**
 * Full precision with thousands separators, for the one place a figure is
 * the subject rather than a column entry. formatGp in ge.ts gives the short
 * form (1.25M) used in tables.
 */
export function gpExact(amount: number): string {
  return `${Math.round(amount).toLocaleString('en-US')}`;
}

/** Profit and loss get their own colour, which outranks the stack bands. */
export function plClass(amount: number): string {
  if (amount > 0) return 'num pl-up';
  if (amount < 0) return 'num pl-down';
  return 'num pl-flat';
}

/** How long ago, in the compact form a trader scanning a table wants. */
export function ago(minutes: number | null): string {
  if (minutes === null) return 'unknown';
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${Math.round(minutes)}m`;
  const hours = minutes / 60;
  if (hours < 24) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}
