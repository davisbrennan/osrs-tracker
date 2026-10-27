/**
 * Brand, navigation and marketing copy in one place.
 *
 * Everything the public pages render comes from here, so changing a headline
 * does not mean hunting through components.
 */

export const SITE = {
  name: 'RSpill',
  /** Full name for titles and the odd place that needs it spelled out. */
  longName: 'RSpill — OSRS progress and Grand Exchange tracker',
  tagline: 'Track your progress. Flip with real numbers.',
  url: process.env.SITE_URL ?? 'https://rspill.com',
  /** Shown on the legal pages and in the wiki User-Agent. */
  contact: process.env.OSRS_CONTACT ?? 'hello@rspill.com',
  description:
    'Live Grand Exchange margins that account for tax, buy limits and your actual cash stack — plus skill tracking and goal ETAs from your own XP rate.',
} as const;

/**
 * The signed-in navigation.
 *
 * `public: true` means the page works without an account, which is how the
 * flip finder and item pages get indexed. Only routes that exist are listed;
 * a nav entry pointing at an unbuilt page is a 404 waiting to happen.
 */
export const NAV = [
  { href: '/flips', label: 'Flip finder', key: 'flips', public: true },
  { href: '/items', label: 'Items', key: 'items', public: true },
  { href: '/accounts', label: 'Accounts', key: 'accounts', public: false },
  { href: '/journal', label: 'Book', key: 'journal', public: false },
] as const;

export type NavKey = (typeof NAV)[number]['key'] | 'settings' | 'admin';

/** The three things the landing page leads with. */
export const FEATURES = [
  {
    title: 'Margins you can actually hit',
    body: 'Most flip finders show you a spread and stop. Profit here is capped by whichever bites first — the item’s four-hour buy limit, or what you can afford. A 28k margin on an item costing 1.5m reads as zero profit on a 500k stack, because you cannot buy one.',
  },
  {
    title: 'Tax and breakeven, built in',
    body: 'The Grand Exchange takes 2% of every sale, rounded down, free under 50gp and capped at 5m. So buy at 100 and sell at 101 and you are down a gp. Every row carries the lowest sell price that actually clears.',
  },
  {
    title: 'Confidence, not just a number',
    body: 'A fat margin on something that trades twice an hour is a trap — you will sit on it while the price moves. Volume and price age ride alongside every margin, and thin or stale books are labelled as such.',
  },
] as const;

export const STEPS = [
  {
    title: 'Set your cash stack',
    body: 'Everything reprices around it. The table only shows flips you could actually fund.',
  },
  {
    title: 'Add your RSN',
    body: 'Skills, total level and XP pulled from the hiscores, with goal ETAs worked out from your own measured rate rather than a generic table.',
  },
  {
    title: 'Log what you trade',
    body: 'Record a flip and it tracks tax paid and realised profit, so your P&L is what you actually made, not what the margin column promised.',
  },
] as const;

export const FAQS = [
  {
    q: 'Where do the prices come from?',
    a: 'The OSRS Wiki’s real-time price API, polled every five minutes, with hourly trade volumes alongside. It is the same source most of the community uses.',
  },
  {
    q: 'How is the tax calculated?',
    a: '2% of the sale price, rounded down to whole gp, not charged below 50gp, and capped at 5,000,000gp per item. Bonds and a handful of tools are exempt. The rate has changed before, so it lives in one place and every number follows it.',
  },
  {
    q: 'Do I need an account?',
    a: 'Not for the flip finder or item pages. You need one to track RSNs, save a cash stack, log flips or set price alerts.',
  },
  {
    q: 'Is this allowed?',
    a: 'Yes. It reads public price data and public hiscores, the same as any wiki page. It does not connect to the game, read your client, or automate anything.',
  },
] as const;

/** Paths that must never be indexed: anything behind sign-in, plus the API. */
export const NOINDEX_PATHS = ['/admin', '/settings', '/signin', '/api/'] as const;
