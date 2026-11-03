/**
 * A small cross-request cache for work that is the same for everybody.
 *
 * Several pages declare `export const revalidate = 300` and none of them
 * are cached. They all call `currentUser()`, which reads cookies, and
 * reading cookies makes a route dynamic — so the revalidate is dead code
 * and the whole page is rebuilt on every request. `next build` says so
 * plainly, marking them ƒ rather than ○, which is easy to read past.
 *
 * Those pages are RIGHT to be dynamic: a margin depends on your cash
 * stack, so there is no shared HTML to serve. But the expensive part of
 * them is usually not the per-user part. The Unusual page spent 71ms of
 * its 220ms recomputing one dataset-wide statistic — a full aggregate over
 * every daily bar — to fill in a caption that is the same for every
 * visitor and changes at most once an hour.
 *
 * So this caches the shared half and leaves the per-user half alone.
 *
 * Deliberately a plain in-process map rather than Redis or a framework
 * cache: the app runs as one container per colour, the values are small
 * and cheap to recompute, and a cold start recomputing them once is not
 * worth a network hop and another failure mode. If this ever runs on
 * several app containers they will each keep their own copy, which for a
 * statistic that is allowed to be a few minutes stale is fine.
 */

type Entry<T> = { value: T; expires: number };

const store = new Map<string, Entry<unknown>>();

/** Stop a long-running process accumulating keys forever. */
const MAX_ENTRIES = 200;

/**
 * Run `fn` and remember it under `key` for `ttlMs`.
 *
 * Concurrent callers during a miss all run `fn` — no in-flight
 * deduplication. That is a deliberate omission: the alternative is storing
 * promises, and a stored rejected promise poisons the key for every later
 * caller until it expires. Recomputing a cheap statistic twice is a better
 * failure than serving an error for five minutes.
 */
export async function memo<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const hit = store.get(key);
  if (hit && hit.expires > now) return hit.value as T;

  const value = await fn();

  if (store.size >= MAX_ENTRIES) {
    // Drop whatever expired first. Not an LRU — this never holds enough
    // keys for the difference to matter.
    const oldest = [...store.entries()].sort((a, b) => a[1].expires - b[1].expires)[0];
    if (oldest) store.delete(oldest[0]);
  }

  store.set(key, { value, expires: now + ttlMs });
  return value;
}

/** For tests, and for a job that has just made a cached figure wrong. */
export function forget(key?: string): void {
  if (key === undefined) store.clear();
  else store.delete(key);
}

/** Entries currently held, expired ones included. Tests only. */
export function size(): number {
  return store.size;
}
