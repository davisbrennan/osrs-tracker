import type { Metadata } from 'next';
import { Archivo, IBM_Plex_Mono } from 'next/font/google';
import { SITE } from '@/lib/site';
import './globals.css';

/*
 * Two families, down from five.
 *
 * next/font downloads these at build time and serves them from our own
 * domain, so a visitor's browser never contacts Google and no IP address
 * leaves for a font. That keeps the site free of third-party requests, which
 * is what keeps it out of cookie-consent territory.
 *
 * The trade-off is that the Docker build needs to reach Google, and a blip
 * there fails the whole deploy — which has happened. Fewer families is fewer
 * chances to fail, and two is all the design needs: Archivo sets the
 * interface, Plex Mono sets every figure.
 */
const archivo = Archivo({
  subsets: ['latin'],
  display: 'swap',
  variable: '--f-archivo',
});

const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  display: 'swap',
  variable: '--f-plex-mono',
});

const fontVars = [archivo.variable, plexMono.variable].join(' ');

export const metadata: Metadata = {
  metadataBase: new URL(SITE.url),
  title: {
    default: `${SITE.name} — ${SITE.tagline}`,
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  openGraph: {
    type: 'website',
    siteName: SITE.name,
    title: SITE.longName,
    description: SITE.description,
    url: SITE.url,
  },
  twitter: { card: 'summary' },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={fontVars}>
      <body>{children}</body>
    </html>
  );
}
