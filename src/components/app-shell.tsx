import Link from 'next/link';
import { appSettings } from '@/lib/app-settings';
import { NAV, SITE, type NavKey } from '@/lib/site';
import SignOut from './sign-out';
import CashStack from './cash-stack';

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
  const settings = await appSettings();

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

      <div className="content">{children}</div>
    </div>
  );
}
