import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { GUIDES, guideBySlug, guideWords } from '@/lib/guides';
import { SITE, SOCIAL_CARD } from '@/lib/site';
import { breadcrumbSchema, jsonLdProps } from '@/lib/structured-data';
import { currentUser, cashStackFor } from '@/lib/session';
import AppShell from '@/components/app-shell';

/** Every guide is known at build time, so they prerender. */
export function generateStaticParams() {
  return GUIDES.map((g) => ({ slug: g.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) return { title: 'Guide' };

  const canonical = `/guides/${guide.slug}`;
  return {
    title: guide.title,
    description: guide.summary,
    alternates: { canonical },
    openGraph: {
      title: guide.title,
      description: guide.summary,
      url: canonical,
      type: 'article',
      // Declaring openGraph at all drops the inherited file-based image.
      images: [SOCIAL_CARD],
    },
  };
}

export default async function GuidePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const guide = guideBySlug(slug);
  if (!guide) notFound();

  const user = await currentUser();
  const cashStack = await cashStackFor(user?.id ?? null);
  const others = GUIDES.filter((g) => g.slug !== guide.slug);

  return (
    <AppShell current="guides" signedIn={Boolean(user)} cashStack={cashStack}>
      <script
        {...jsonLdProps([
          breadcrumbSchema([
            { name: 'Guides', url: `${SITE.url}/guides` },
            { name: guide.title, url: `${SITE.url}/guides/${guide.slug}` },
          ]),
        ])}
      />

      <p className="crumb">
        <Link href="/guides">Guides</Link>
      </p>

      <article className="guide">
        <h1>{guide.title}</h1>
        <p className="lede">{guide.summary}</p>
        <p className="guide-meta">
          {guide.minutes} min read · {guideWords(guide).toLocaleString('en-US')} words
        </p>

        {guide.sections.map((s) => (
          <section key={s.heading}>
            <h2>{s.heading}</h2>
            {s.body.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </section>
        ))}
      </article>

      <nav className="guide-more" aria-label="More guides">
        <h2>More guides</h2>
        <ul>
          {others.map((g) => (
            <li key={g.slug}>
              <Link href={`/guides/${g.slug}`}>{g.title}</Link>
              <span className="subtle"> — {g.summary}</span>
            </li>
          ))}
        </ul>
      </nav>
    </AppShell>
  );
}
