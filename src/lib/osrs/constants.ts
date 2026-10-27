/**
 * Shared constants for the account, goal and alert screens.
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

/**
 * Alerts per person.
 *
 * Every active alert is evaluated on every price poll, and each one that
 * fires sends an email from a shared sending reputation. Forty is more than
 * anyone needs and well short of a problem.
 */
export const MAX_ALERTS = 40;

/** Shortest gap between repeat emails for one alert. */
export const MIN_COOLDOWN_MINUTES = 30;
