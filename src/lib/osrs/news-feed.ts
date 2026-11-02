/**
 * Parsing the official news feed.
 *
 * Headlines and links only. Jagex's article text is theirs, and a tracker
 * that reprints it is taking their content rather than pointing at it —
 * which is also why there is no "read more" expander here, only a link out.
 *
 * This is the one place in the app that takes arbitrary XML from a third
 * party and writes it to the database, so it is deliberately paranoid:
 *
 *  - Links are checked against a scheme allow-list. A feed is a string
 *    someone else controls, and `javascript:` in an href is a stored XSS
 *    waiting for a click.
 *  - Entities and CDATA are decoded, because a title reading
 *    `Sailing &amp; You` on the page is the tell that nobody looked.
 *  - An item missing a title or a usable link is dropped rather than
 *    stored half-formed. A blank row in a news feed is worse than a
 *    shorter feed.
 *  - A bad date becomes null rather than 1970, which would otherwise sort
 *    every malformed item to the bottom of the feed forever.
 *
 * Hand-rolled rather than pulling in an XML library: this reads one known
 * feed, the shape is stable, and the parsing is exercised against fixtures
 * including the malformed cases.
 */

export type FeedItem = {
  title: string;
  url: string;
  /** The feed's own identifier, for not posting the same thing twice. */
  externalId: string;
  publishedAt: Date | null;
};

/** Schemes a link in a feed may use. Everything else is refused. */
const ALLOWED_SCHEMES = ['http:', 'https:'];

export function safeUrl(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    const parsed = new URL(trimmed);
    return ALLOWED_SCHEMES.includes(parsed.protocol) ? parsed.toString() : null;
  } catch {
    return null;
  }
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => safeFromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => safeFromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[String(name).toLowerCase()] ?? whole);
}

function safeFromCodePoint(code: number): string {
  // An out-of-range code point throws, which would take down the whole
  // sync over one malformed character.
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return '';
  try {
    return String.fromCodePoint(code);
  } catch {
    return '';
  }
}

/** The text of the first matching tag, CDATA unwrapped and entities decoded. */
export function tagText(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'i').exec(xml);
  if (!match) return null;

  let inner = match[1];
  const cdata = /<!\[CDATA\[([\s\S]*?)\]\]>/.exec(inner);
  if (cdata) inner = cdata[1];

  const text = decodeEntities(inner).replace(/\s+/g, ' ').trim();
  return text || null;
}

/** An Atom <link href="..."/>, which carries no text content. */
function atomLink(xml: string): string | null {
  const match = /<link\b[^>]*\bhref=["']([^"']+)["'][^>]*>/i.exec(xml);
  return match ? decodeEntities(match[1]).trim() : null;
}

function parseDate(raw: string | null): Date | null {
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  // A date far in the future is a parse accident, not news, and would pin
  // itself to the top of the feed permanently.
  if (d.getTime() > Date.now() + 86_400_000) return null;
  return d;
}

/** How many items to take from one fetch. The feed is a trickle, not a firehose. */
export const MAX_FEED_ITEMS = 15;

export function parseFeed(xml: string, limit: number = MAX_FEED_ITEMS): FeedItem[] {
  if (typeof xml !== 'string' || xml.length === 0) return [];

  // RSS calls them <item>, Atom calls them <entry>.
  const blocks = [
    ...xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi),
    ...xml.matchAll(/<entry(?:\s[^>]*)?>([\s\S]*?)<\/entry>/gi),
  ].map((m) => m[1]);

  const out: FeedItem[] = [];
  const seen = new Set<string>();

  for (const block of blocks) {
    const title = tagText(block, 'title');
    const url = safeUrl(tagText(block, 'link') ?? atomLink(block));

    // Both are load-bearing: a headline with nowhere to go, or a link with
    // nothing to call it, is not an item worth storing.
    if (!title || !url) continue;

    // guid, then id, then the link itself. Something stable is required or
    // every sync posts the same news again.
    const externalId = tagText(block, 'guid') ?? tagText(block, 'id') ?? url;
    if (seen.has(externalId)) continue;
    seen.add(externalId);

    out.push({
      title,
      url,
      externalId,
      publishedAt: parseDate(tagText(block, 'pubDate') ?? tagText(block, 'updated')),
    });

    if (out.length >= limit) break;
  }

  return out;
}

/**
 * Where to fetch from.
 *
 * An environment variable because I could not verify the Old School
 * variant of this URL from where this was written. The RuneScape news feed
 * is documented at secure.runescape.com/m=news/latest_news.rss, and the
 * Old School filter is conventionally `?oldschool=true` — but conventional
 * is not verified, and hardcoding a guess means a release to correct it.
 */
export const DEFAULT_FEED_URL =
  'https://secure.runescape.com/m=news/latest_news.rss?oldschool=true';

export function feedUrl(): string {
  return process.env.OSRS_NEWS_FEED_URL || DEFAULT_FEED_URL;
}
