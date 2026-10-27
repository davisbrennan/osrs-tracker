/**
 * One place for the details that appear across the legal pages, so they can't
 * drift apart.
 *
 * Keep this honest. A sub-processor list or cookie table that is out of date
 * is worse than not having one, because it is a claim rather than an
 * omission. Both lists below are checked against the code, not assumed.
 */
export const LEGAL = {
  entity: 'RSpill',
  contactEmail: process.env.OSRS_CONTACT ?? 'hello@rspill.com',
  jurisdiction: 'Texas, United States',
  lastUpdated: 'October 2026',

  /** Every third party that touches user data. Add one here when you add one. */
  subprocessors: [
    {
      name: 'OVHcloud',
      role: 'Hosting',
      data: 'Everything — the server this runs on',
      where: 'United States',
    },
    {
      name: 'Resend',
      role: 'Email delivery',
      data: 'Email address and message content for sign-in links and price alerts',
      where: 'United States',
    },
    {
      name: 'Backblaze B2',
      role: 'Encrypted off-site backups',
      data: 'Encrypted copies of the database',
      where: 'United States',
    },
    {
      name: 'Cloudflare',
      role: 'DNS only',
      data: 'Domain lookups. Traffic is not proxied through Cloudflare',
      where: 'Global',
    },
  ],

  /**
   * Data read from third parties.
   *
   * Worth stating plainly: the site fetches public data ABOUT accounts you
   * name, which is not the same as connecting to them. People reasonably want
   * to know which it is.
   */
  sources: [
    {
      name: 'OSRS Wiki real-time prices',
      what: 'Grand Exchange prices and trade volumes for every item',
      note: 'Public data, identical for every visitor. Nothing about you is sent.',
    },
    {
      name: 'Old School RuneScape hiscores',
      what: 'Skill levels, experience and ranks for names you choose to track',
      note: 'Public data, read by name. No game login is involved, and nothing about you is sent to Jagex.',
    },
  ],

  /** Cookies actually set. Verified against the code. */
  cookies: [
    {
      name: 'Session cookie',
      purpose: 'Keeps you signed in after you click a magic link',
      life: 'Until you sign out, or 30 days',
      kind: 'Strictly necessary',
    },
  ],
} as const;
