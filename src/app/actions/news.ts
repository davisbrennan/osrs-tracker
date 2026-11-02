'use server';

import { revalidatePath } from 'next/cache';
import { eq, and, desc, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsNews } from '@/database/schema';
import { requireAdmin } from '@/lib/admin';

export type ActionResult = { ok: true; message: string } | { ok: false; error: string };

export type NewsItem = {
  id: string;
  source: 'site' | 'jagex';
  title: string;
  body: string | null;
  url: string | null;
  publishedAt: Date;
  published: boolean;
};

/** Long enough for a real update, short enough that the feed stays a feed. */
const MAX_TITLE = 140;
const MAX_BODY = 4_000;

export async function createPost(formData: FormData): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Not allowed.' };

  const title = String(formData.get('title') ?? '').trim();
  const body = String(formData.get('body') ?? '').trim();
  const publish = formData.get('publish') === 'on';

  if (!title) return { ok: false, error: 'A post needs a title.' };
  if (title.length > MAX_TITLE) {
    return { ok: false, error: `Titles are capped at ${MAX_TITLE} characters.` };
  }
  if (body.length > MAX_BODY) {
    return { ok: false, error: `Posts are capped at ${MAX_BODY} characters.` };
  }

  try {
    await db.insert(osrsNews).values({
      source: 'site',
      title,
      body: body || null,
      authorId: admin.id,
      published: publish,
    });
  } catch {
    return { ok: false, error: 'Could not save that. Try again.' };
  }

  revalidatePath('/news');
  revalidatePath('/dashboard');
  revalidatePath('/admin/news');
  return { ok: true, message: publish ? 'Posted.' : 'Saved as a draft.' };
}

export async function setPostPublished(id: string, published: boolean): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Not allowed.' };

  try {
    await db
      .update(osrsNews)
      .set({ published, updatedAt: new Date() })
      // Only site posts. A Jagex headline is not ours to unpublish — the
      // sync would simply put it back on the next run.
      .where(and(eq(osrsNews.id, id), eq(osrsNews.source, 'site')));
  } catch {
    return { ok: false, error: 'Could not change that.' };
  }

  revalidatePath('/news');
  revalidatePath('/dashboard');
  revalidatePath('/admin/news');
  return { ok: true, message: published ? 'Published.' : 'Hidden.' };
}

export async function deletePost(id: string): Promise<ActionResult> {
  const admin = await requireAdmin();
  if (!admin) return { ok: false, error: 'Not allowed.' };

  try {
    await db.delete(osrsNews).where(and(eq(osrsNews.id, id), eq(osrsNews.source, 'site')));
  } catch {
    return { ok: false, error: 'Could not delete that.' };
  }

  revalidatePath('/news');
  revalidatePath('/dashboard');
  revalidatePath('/admin/news');
  return { ok: true, message: 'Deleted.' };
}

/**
 * The feed.
 *
 * Published items only, newest first, both sources together — somebody
 * reading this wants to know what changed, and whether it changed in the
 * game or on this site is a label rather than a reason to look in two
 * places.
 */
export async function latestNews(limit = 20): Promise<NewsItem[]> {
  try {
    const rows = await db
      .select({
        id: osrsNews.id,
        source: osrsNews.source,
        title: osrsNews.title,
        body: osrsNews.body,
        url: osrsNews.url,
        publishedAt: osrsNews.publishedAt,
        published: osrsNews.published,
      })
      .from(osrsNews)
      .where(eq(osrsNews.published, true))
      .orderBy(desc(osrsNews.publishedAt))
      .limit(limit);

    return rows.map((r) => ({ ...r, source: r.source === 'jagex' ? 'jagex' : 'site' }));
  } catch {
    // The news panel failing must not take down the page it sits on.
    return [];
  }
}

/** Everything, drafts included. Admin only. */
export async function allNews(limit = 60): Promise<NewsItem[]> {
  const admin = await requireAdmin();
  if (!admin) return [];

  const rows = await db
    .select({
      id: osrsNews.id,
      source: osrsNews.source,
      title: osrsNews.title,
      body: osrsNews.body,
      url: osrsNews.url,
      publishedAt: osrsNews.publishedAt,
      published: osrsNews.published,
    })
    .from(osrsNews)
    .orderBy(desc(osrsNews.publishedAt))
    .limit(limit);

  return rows.map((r) => ({ ...r, source: r.source === 'jagex' ? 'jagex' : 'site' }));
}

/** How many site posts exist, for the admin page's empty state. */
export async function sitePostCount(): Promise<number> {
  try {
    const [row] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(osrsNews)
      .where(eq(osrsNews.source, 'site'));
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}
