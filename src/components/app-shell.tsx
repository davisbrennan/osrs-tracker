import Link from 'next/link';
import { appSettings } from '@/lib/app-settings';
import { NAV, SITE, type NavKey } from '@/lib/site';
import SignOut from './sign-out';
import CashStack from './cash-stack';
import { lastPriceSync } from '@/lib/osrs/last-sync';
import { exactStamp } from '@/lib/osrs/freshness';
import { ago } from '@/lib/gp';

/**
 * The frame every page sits in.
 *
 * Works signed out on purpose: the flip finder and item pages are public, so
 * the shell has to render without a user rather than assuming one. That is
 * also what makes them indexable, which is the whole growth plan.
 */

const ICONS: Record<string, React.ReactElement> = {
  flips: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1.5 11.5 L5.5 6.5 L8.5 9 L14.5 2.5" />
      <path d="M10.5 2.5 H14.5 V6.5" />
    </svg>
  ),
  items: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="7" cy="7" r="4.75" />
      <path d="m10.5 10.5 3.5 3.5" />
    </svg>
  ),
  unusual: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1.5 10.5h3l2-6 2.5 9 2-5h3.5" />
    </svg>
  ),
  money: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="6" />
      <path d="M9.9 6.1a2.1 2.1 0 0 0-3.8 1.1c0 1.9 3.8 1 3.8 2.6a2.1 2.1 0 0 1-3.8-1" />
      <path d="M8 4.2v1.1M8 10.7v1.1" />
    </svg>
  ),
  watchlist: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 1.9 9.9 5.8l4.3.6-3.1 3 .7 4.3L8 11.7 4.2 13.7l.7-4.3-3.1-3 4.3-.6z" />
    </svg>
  ),
  alerts: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 6.5a4 4 0 0 1 8 0c0 3 1.2 4 1.2 4H2.8S4 9.5 4 6.5Z" />
      <path d="M6.6 13a1.6 1.6 0 0 0 2.8 0" />
    </svg>
  ),
  accounts: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="5.25" r="2.75" />
      <path d="M2.5 14c0-2.9 2.4-4.75 5.5-4.75S13.5 11.1 13.5 14" />
    </svg>
  ),
  journal: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 2.5h8.5a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H3z" />
      <path d="M3 2.5v12M5.5 6h4M5.5 9h4" />
    </svg>
  ),
  settings: (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <circle cx="8" cy="8" r="2.4" />
      <path d="M8 1.2v2M8 12.8v2M1.2 8h2M12.8 8h2M3.2 3.2l1.4 1.4M11.4 11.4l1.4 1.4M12.8 3.2l-1.4 1.4M4.6 11.4l-1.4 1.4" />
    </svg>
  ),
};

/** Pages whose numbers come from the price feed, and so need its age. */
const PRICE_PAGES = new Set<string>([
  'flips',
  'items',
  'money',
  'unusual',
  'watchlist',
  'journal',
]);

export default async function AppShell({
  current,
  signedIn,
  cashStack,
  children,
}: {
  current: NavKey;
  signedIn: boolean;
  cashStack: number;
  children: React.ReactNode;
}) {
  // Both fail open and neither depends on the other, so they go together.
  const [settings, sync] = await Promise.all([
    appSettings(),
    PRICE_PAGES.has(current) ? lastPriceSync() : Promise.resolve(null),
  ]);

  if (settings.maintenance) {
    return (
      <div className="notice-page">
        <h1>Back shortly</h1>
        <p>
          {SITE.name} is down for maintenance. Nothing of yours is being changed — tracked accounts,
          flips and alerts are all where you left them.
        </p>
      </div>
    );
  }

  return (
    <div className="shell page-wrap">
      {settings.banner && (
        <p className={`sitebanner${settings.bannerLevel === 'warn' ? ' warn' : ''}`} role="status">
          {settings.banner}
        </p>
      )}

      <header className="masthead">
        <Link href="/" className="brand">
          RS<span>pill</span>
        </Link>

        {/* The cash stack lives in the masthead because it reprices every
            number on every page. Burying the one input the whole tool
            depends on in a settings screen would be the wrong place. */}
        <CashStack value={cashStack} signedIn={signedIn} />

        {signedIn && (
          <Link
            href="/settings"
            className={`gear${current === 'settings' ? ' on' : ''}`}
            aria-label="Settings"
            title="Settings"
          >
            {ICONS.settings}
          </Link>
        )}
      </header>

      <nav className="tabs">
        {NAV.filter((t) => t.public || signedIn).map((t) => (
          <Link key={t.key} href={t.href} aria-current={current === t.key ? 'page' : undefined}>
            {ICONS[t.key]}
            {t.label}
          </Link>
        ))}
        <span className="tabs-spacer" />
        {signedIn ? (
          <SignOut />
        ) : (
          <Link href="/signin" className="signin-link">
            Sign in
          </Link>
        )}
      </nav>

      {/* How fresh the whole feed is, as opposed to how old one price is.
          Sits above the data rather than in a footer, because it is meant
          to be glanced at while reading the numbers it qualifies. */}
      {sync && (
        <p
          className={`sync-strip${sync.overdue ? ' overdue' : ''}`}
          title={exactStamp(sync.at)}
          role="status"
        >
          <span className="sync-dot" aria-hidden="true" />
          {sync.minutesAgo === null ? (
            <>Waiting for the first price sync.</>
          ) : (
            <>
              Prices pulled from the OSRS Wiki{' '}
              <strong>
                {ago(sync.minutesAgo)}
                {sync.minutesAgo >= 1 ? ' ago' : ''}
              </strong>
              {sync.overdue ? (
                <span className="sync-note">
                  {' '}
                  — longer than the five-minute poll, so these may be behind the game.
                </span>
              ) : (
                <span className="sync-note"> · refreshed every five minutes</span>
              )}
            </>
          )}
        </p>
      )}

      <div className="content">{children}</div>
    </div>
  );
}
