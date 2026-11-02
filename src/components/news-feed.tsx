import Link from 'next/link';
import type { NewsItem } from '@/app/actions/news';
import { ago } from '@/lib/gp';

/**
 * The feed, shared by the dashboard panel and the news page.
 *
 * A Jagex item is a headline and a link out; a site post carries its own
 * text. They are labelled rather than separated, because the reader's
 * question is "what changed", not "who changed it" — but the label still
 * matters, so nobody mistakes an official patch note for something I wrote.
 */
export default function NewsFeed({ items, compact }: { items: NewsItem[]; compact?: boolean }) {
  if (items.length === 0) {
    return (
      <p className="subtle">
        Nothing yet. Game updates appear here within a few hours of Jagex posting them.
      </p>
    );
  }

  return (
    <ul className="news-list">
      {items.map((n) => (
        <li key={n.id} className={`news-item news-${n.source}`}>
          <div className="news-head">
            <span className="news-tag">{n.source === 'jagex' ? 'Game update' : 'RSpill'}</span>
            <time dateTime={n.publishedAt.toISOString()} className="subtle">
              {ago((Date.now() - n.publishedAt.getTime()) / 60_000)} ago
            </time>
          </div>

          <h3>
            {n.url ? (
              <a href={n.url} target="_blank" rel="noopener noreferrer">
                {n.title}
              </a>
            ) : (
              n.title
            )}
          </h3>

          {/* Jagex items carry no body by design — the link is the point.
              Site posts show their text, trimmed in the compact view. */}
          {n.body && !compact && <p className="news-body">{n.body}</p>}
          {n.body && compact && (
            <p className="news-body">
              {n.body.length > 160 ? `${n.body.slice(0, 159)}…` : n.body}
            </p>
          )}
        </li>
      ))}
    </ul>
  );
}
