'use client';

/**
 * The AdSense loader, mounted once in the root layout.
 *
 * Client-side because of the one thing it has to decide: which pages it is
 * allowed on. A server layout cannot see the pathname in the App Router
 * without middleware stamping a header, and usePathname is the honest way
 * to ask.
 *
 * Why it needs deciding at all: this tag is only the loader, but with Auto
 * ads enabled in the AdSense dashboard Google injects units wherever the
 * loader runs. That would put ads on the admin screens, the sign-in page
 * and the signed-in dashboard — useless to anyone, and against AdSense's
 * own placement rules, which disallow ads on pages behind a login or
 * without publisher content. Google suspends accounts over this, so the
 * list is a safety rail rather than a preference.
 *
 * NOINDEX_PATHS is reused rather than copied. It is already the answer to
 * "pages that are not public content" — the same judgement, for search —
 * and two lists would drift.
 */

import Script from 'next/script';
import { usePathname } from 'next/navigation';
import { ADSENSE, adsAllowedOn } from '@/lib/site';

export default function AdSense() {
  const pathname = usePathname();
  if (!adsAllowedOn(pathname ?? '')) return null;

  return (
    <Script
      id="adsbygoogle-loader"
      async
      src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${ADSENSE.client}`}
      crossOrigin="anonymous"
      // afterInteractive, not beforeInteractive: the ad script must never
      // be in the way of the first paint. These pages exist to show a price
      // quickly, and an ad network is the slowest thing on any page it is on.
      strategy="afterInteractive"
    />
  );
}
