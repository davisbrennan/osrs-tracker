import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { latestNews } from '@/app/actions/news';
import AppShell from '@/components/app-shell';
import NewsFeed from '@/components/news-feed';

export const metadata: Metadata = {
  alternates: { canonical: '/news' },
  title: 'News',
  description:
    'Old School RuneScape game updates and changes to RSpill, newest first.',
};

export const revalidate = 600;

export default async function News() {
  const user = await currentUser();
  const [cashStack, items] = await Promise.all([
    cashStackFor(user?.id ?? null),
    latestNews(40),
  ]);

  return (
    <AppShell current="news" signedIn={Boolean(user)} cashStack={cashStack}>
      <h1>News</h1>
      <p className="lede">
        Game updates from Jagex&rsquo;s official feed, and changes to this site. Headlines link
        straight to the source.
      </p>
      <NewsFeed items={items} />
    </AppShell>
  );
}
