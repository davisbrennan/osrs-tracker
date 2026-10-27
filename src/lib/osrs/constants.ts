/**
 * Shared constants for the account and goal screens.
 *
 * These live here rather than beside the server actions that use them
 * because a file marked 'use server' may only export async functions —
 * every other export becomes a build error, and the message points at the
 * constant rather than the rule, which is slow to read.
 */

/** Account types the hiscores and the schema both recognise. */
export const ACCOUNT_TYPES = [
  { value: 'main', label: 'Main' },
  { value: 'ironman', label: 'Ironman' },
  { value: 'hardcore', label: 'Hardcore ironman' },
  { value: 'ultimate', label: 'Ultimate ironman' },
  { value: 'group', label: 'Group ironman' },
] as const;

/** Goals per account. Enough to plan with, few enough to stay readable. */
export const MAX_GOALS = 10;
