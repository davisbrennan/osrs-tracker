import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { requireAdmin } from '@/lib/admin';
import { allNews } from '@/app/actions/news';
import { ago } from '@/lib/gp';
import AdminShell from '@/components/admin-shell';
import PostForm from './post-form';
import RowActions from './row-actions';

export const metadata: Metadata = {
  title: 'News',
  robots: { index: false, follow: false, nocache: true },
};

export const dynamic = 'force-dynamic';

export default async function AdminNews() {
  const admin = await requireAdmin();
  if (!admin) notFound();

  const items = await allNews(60);
  const site = items.filter((n) => n.source === 'site');
  const jagex = items.filter((n) => n.source === 'jagex');

  return (
    <AdminShell current="/admin/news">
      <h1>News</h1>
      <p className="subtle">
        Posts you write here appear on the overview of everyone signed in, and on the public news
        page alongside Jagex&rsquo;s game updates.
      </p>

      <section className="card">
        <h2>Write a post</h2>
        <PostForm />
      </section>

      <h2>Your posts</h2>
      {site.length === 0 ? (
        <p className="subtle">Nothing written yet.</p>
      ) : (
        <div className="table-wrap">
          <table className="flips">
            <thead>
              <tr>
                <th className="left">Title</th>
                <th className="left">When</th>
                <th className="left">State</th>
                <th className="left"></th>
              </tr>
            </thead>
            <tbody>
              {site.map((n) => (
                <tr key={n.id}>
                  <th scope="row" className="left">
                    {n.title}
                  </th>
                  <td className="left">
                    <span className="subtle">
                      {ago((Date.now() - n.publishedAt.getTime()) / 60_000)} ago
                    </span>
                  </td>
                  <td className="left">
                    <span className={n.published ? 'ok' : 'subtle'}>
                      {n.published ? 'live' : 'draft'}
                    </span>
                  </td>
                  <td className="left">
                    <RowActions id={n.id} published={n.published} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2>From Jagex</h2>
      <p className="subtle">
        Pulled from the official feed every six hours. These are not editable — the sync would put
        any change straight back. {jagex.length} stored.
      </p>
      {jagex.length === 0 && (
        <p className="adm-note adm-warn">
          <strong>Nothing has come through yet.</strong> The feed URL is set by{' '}
          <code>OSRS_NEWS_FEED_URL</code>, defaulting to the official news feed with the Old School
          filter. If this stays empty after a few hours, check <code>sync-news</code> on the health
          page — the URL is the likeliest thing to be wrong.
        </p>
      )}
    </AdminShell>
  );
}
