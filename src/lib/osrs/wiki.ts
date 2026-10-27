/**
 * Item descriptions from the OSRS Wiki.
 *
 * LICENSING — read this before changing how the text is displayed.
 *
 * Wiki prose is licensed CC BY-NC-SA 3.0. Three consequences, all of which
 * the code and the UI are built around:
 *
 *  1. BY — attribution is required. Every stored summary keeps the exact
 *     article URL it came from, and the item page renders it as a visible
 *     credit next to the text. The credit is not decoration; removing it
 *     makes the site non-compliant.
 *  2. NC — NON-COMMERCIAL. This is fine for a hobby site and is a real
 *     constraint if that ever changes. Ads, subscriptions or paid tiers
 *     would make republishing this text a licence breach. It lives in its
 *     own table so it can be dropped in one statement if that day comes.
 *  3. SA — share-alike on modifications. We store a verbatim prefix and do
 *     not rewrite it, which keeps us clear of producing a derivative.
 *
 * The `examine` text on osrs_items is a different thing: an in-game string
 * from Jagex that arrives with the prices mapping endpoint, not wiki prose.
 * It is not covered by any of the above.
 *
 * Everything except `fetchWikiSummaries` is pure, because the response shape
 * is the part most likely to surprise us and it deserves tests.
 */

export const WIKI_API = 'https://oldschool.runescape.wiki/api.php';
export const WIKI_ARTICLE_BASE = 'https://oldschool.runescape.wiki/w/';

export const WIKI_LICENCE = {
  name: 'CC BY-NC-SA 3.0',
  url: 'https://creativecommons.org/licenses/by-nc-sa/3.0/',
} as const;

/** How many sentences of the lead we keep. Short on purpose — see SA above. */
export const SUMMARY_SENTENCES = 4;

/** The wiki asks consumers to batch; 20 titles is well inside what it allows. */
export const TITLES_PER_REQUEST = 20;

export type WikiEntry = {
  /** The article title we actually landed on, after redirects. */
  title: string;
  pageId: number | null;
  summary: string;
  url: string;
};

export function articleUrl(title: string): string {
  return WIKI_ARTICLE_BASE + encodeURIComponent(title.replace(/ /g, '_'));
}

export function buildExtractsUrl(titles: string[]): string {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    // Makes `pages` an array keyed by nothing instead of an object keyed by
    // page id. The parser below handles both anyway, because this is the one
    // thing most likely to differ from what the docs say.
    formatversion: '2',
    prop: 'extracts',
    // Lead section only, as plain text rather than HTML.
    exintro: '1',
    explaintext: '1',
    // Follow "Whip" to "Abyssal whip" rather than reporting a miss.
    redirects: '1',
    titles: titles.join('|'),
  });
  return `${WIKI_API}?${params.toString()}`;
}

/**
 * First N sentences of a block of prose.
 *
 * Splits on terminal punctuation followed by whitespace and something that
 * starts a sentence. Deliberately conservative: when in doubt it keeps the
 * text together rather than cutting mid-thought, because a truncated
 * sentence reads as a bug.
 */
export function firstSentences(text: string, n = SUMMARY_SENTENCES): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  const parts = clean.split(/(?<=[.!?])\s+(?=[A-Z0-9"'(“])/);
  return parts.slice(0, n).join(' ').trim();
}

/**
 * Normalise a `pages` payload from either format version into a list.
 *
 * Entries that are not objects are dropped rather than trusted. A malformed
 * element used to reach `page.title` and throw, which would have taken out
 * the item page rather than merely leaving it without a description.
 */
function pagesOf(query: Record<string, unknown>): Record<string, unknown>[] {
  const pages = query.pages;
  const raw = Array.isArray(pages)
    ? pages
    : pages && typeof pages === 'object'
      ? Object.values(pages as object)
      : [];
  return raw.filter(
    (p): p is Record<string, unknown> => p !== null && typeof p === 'object'
  );
}

/** Build requested-title → final-title by walking normalisations then redirects. */
function titleResolution(query: Record<string, unknown>): Map<string, string> {
  const hops = new Map<string, string>();
  for (const key of ['normalized', 'redirects'] as const) {
    const list = query[key];
    if (!Array.isArray(list)) continue;
    for (const hop of list) {
      if (hop && typeof hop === 'object' && 'from' in hop && 'to' in hop) {
        hops.set(String(hop.from), String(hop.to));
      }
    }
  }

  const resolve = (start: string): string => {
    let at = start;
    // Bounded: normalisation then redirect is two hops, and a redirect loop
    // on the wiki would otherwise spin here.
    for (let i = 0; i < 5; i++) {
      const next = hops.get(at);
      if (next === undefined || next === at) break;
      at = next;
    }
    return at;
  };

  const out = new Map<string, string>();
  for (const from of hops.keys()) out.set(from, resolve(from));
  return out;
}

/**
 * Pull one entry per requested title out of an extracts response.
 *
 * Returns null for a title the wiki has no article for, so the caller can
 * record the miss and stop asking. Never throws on a shape it does not
 * recognise — a surprise upstream should leave item pages working without a
 * description, not break them.
 */
export function parseExtracts(
  payload: unknown,
  requested: string[]
): Map<string, WikiEntry | null> {
  const out = new Map<string, WikiEntry | null>();
  for (const t of requested) out.set(t, null);

  if (!payload || typeof payload !== 'object') return out;
  const query = (payload as Record<string, unknown>).query;
  if (!query || typeof query !== 'object') return out;

  const q = query as Record<string, unknown>;
  const resolved = titleResolution(q);

  const byTitle = new Map<string, Record<string, unknown>>();
  for (const page of pagesOf(q)) {
    const title = page.title;
    if (typeof title === 'string') byTitle.set(title, page);
  }

  for (const want of requested) {
    const page = byTitle.get(resolved.get(want) ?? want) ?? byTitle.get(want);
    if (!page) continue;

    // `missing` is `true` under formatversion 2 and `""` under the legacy
    // format, so its presence is the signal rather than its value.
    if ('missing' in page || 'invalid' in page) continue;

    const extract = page.extract;
    if (typeof extract !== 'string') continue;
    const summary = firstSentences(extract);
    if (!summary) continue;

    const title = String(page.title);
    const rawId = page.pageid;
    out.set(want, {
      title,
      pageId: typeof rawId === 'number' ? rawId : null,
      summary,
      url: articleUrl(title),
    });
  }

  return out;
}

/** Split a list of titles into batches the API will accept in one request. */
export function titleBatches(titles: string[], size = TITLES_PER_REQUEST): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < titles.length; i += size) out.push(titles.slice(i, i + size));
  return out;
}
