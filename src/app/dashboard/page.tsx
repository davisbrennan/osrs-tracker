import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, and, isNotNull, desc, sql } from 'drizzle-orm';
import { db } from '@/database';
import { osrsItems, osrsPrices, osrsAccounts, osrsSnapshots } from '@/database/schema';
import { currentUser, cashStackFor } from '@/lib/session';
import { allTrades, marksFor } from '@/app/actions/trades';
import { loadMethodCatalogue } from '@/app/actions/methods';
import { myAccounts, progressFor } from '@/app/actions/quests';
import { buildPortfolio } from '@/lib/osrs/portfolio';
import { evaluate, formatGp } from '@/lib/osrs/ge';
import { rankMethods } from '@/lib/osrs/methods';
import { rankUnlocks } from '@/lib/osrs/quests';
import { questMap, UNLOCKS } from '@/lib/osrs/quest-data';
import {
  positionAttention,
  dataAttention,
  bestFlip,
  capitalShare,
  standing,
  greeting,
  type Attention,
} from '@/lib/osrs/dashboard';
import { xpGained, nextLevels, activityHighlights, totalClues, spanLabel } from '@/lib/osrs/progress-stats';
import { latestNews } from '@/app/actions/news';
import { formatXp } from '@/lib/osrs/xp';
import NewsFeed from '@/components/news-feed';
import { gpExact, plClass } from '@/lib/gp';
import AppShell from '@/components/app-shell';

export const metadata: Metadata = {
  title: 'Overview',
  robots: { index: false, follow: false },
};

/** Always live. A dashboard showing yesterday's position is worse than none. */
export const dynamic = 'force-dynamic';

/** Enough of the book to find a good flip without reading the whole catalogue. */
const FLIP_CANDIDATES = 300;

function Needs({ items }: { items: Attention[] }) {
  if (items.length === 0) return null;
  return (
    <section className="dash-needs">
      <h2>Needs you</h2>
      <ul>
        {items.map((a) => (
          <li key={a.id} className={`dash-att dash-${a.level}`}>
            <Link href={a.href}>
              <strong>{a.title}</strong>
              <span>{a.detail}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * The signed-in home.
 *
 * Everywhere else on the site answers a question you arrived with. This
 * page has to guess the question, so the discipline is restraint: each
 * section is allowed to be empty, and "nothing needs you" is a result it
 * reports rather than a gap it fills.
 *
 * Problems come before opportunities. A tool that leads with the best flip
 * is a shop window; a tool that leads with the position that has moved
 * against you is worth opening.
 */
export default async function Dashboard() {
  const user = await currentUser();
  if (!user) redirect('/signin?next=/dashboard');

  const [cashStack, trades, accounts] = await Promise.all([
    cashStackFor(user.id),
    allTrades(user.id),
    myAccounts(),
  ]);

  const marks = await marksFor([...new Set(trades.map((t) => t.itemId))]);
  const portfolio = buildPortfolio(trades, marks);
  const book = standing(portfolio.positions, cashStack);

  // The flip side. Busiest first, then evaluated against the actual stack,
  // which is what turns a margin into a profit.
  const rows = await db
    .select({
      itemId: osrsItems.id,
      name: osrsItems.name,
      buyLimit: osrsItems.buyLimit,
      low: osrsPrices.low,
      high: osrsPrices.high,
      lowTime: osrsPrices.lowTime,
      highTime: osrsPrices.highTime,
      hourlyVolume: osrsPrices.hourlyVolume,
    })
    .from(osrsPrices)
    .innerJoin(osrsItems, eq(osrsItems.id, osrsPrices.itemId))
    .where(and(isNotNull(osrsPrices.low), isNotNull(osrsPrices.high)))
    .orderBy(desc(osrsPrices.hourlyVolume))
    .limit(FLIP_CANDIDATES);

  // The WHERE clause already excludes nulls; this is what tells TypeScript
  // so, and it also means a null slipping through is dropped rather than
  // evaluated as a free item.
  const priced = rows.filter(
    (r): r is typeof r & { low: number; high: number } => r.low !== null && r.high !== null
  );

  const flip = bestFlip(
    priced.map((r) =>
      evaluate(
        {
          itemId: r.itemId,
          name: r.name,
          low: r.low,
          high: r.high,
          lowTime: r.lowTime ? Math.floor(r.lowTime.getTime() / 1000) : null,
          highTime: r.highTime ? Math.floor(r.highTime.getTime() / 1000) : null,
          buyLimit: r.buyLimit,
          hourlyVolume: r.hourlyVolume,
        },
        cashStack
      )
    )
  );

  // The character side, only where there is a character to speak about.
  const accountId = accounts[0]?.id ?? null;
  const progress = accountId ? await progressFor(accountId) : null;

  const [catalogue, hiscores, news] = await Promise.all([
    loadMethodCatalogue(),
    accountId
      ? db
          .select({
            takenAt: osrsSnapshots.takenAt,
            totalXp: osrsSnapshots.totalXp,
            totalLevel: osrsSnapshots.totalLevel,
            skills: osrsSnapshots.skills,
            activities: osrsSnapshots.activities,
          })
          .from(osrsSnapshots)
          .where(eq(osrsSnapshots.accountId, accountId))
          .orderBy(desc(osrsSnapshots.takenAt))
          // Enough history to find a baseline a week back without reading
          // every snapshot ever taken.
          .limit(60)
      : Promise.resolve([]),
    latestNews(5),
  ]);

  type SkillRow = { level: number; xp: number };
  const snapshots = hiscores.map((h) => ({
    takenAt: h.takenAt,
    totalXp: Number(h.totalXp ?? 0),
    totalLevel: h.totalLevel ?? 0,
    skills: (h.skills ?? {}) as Record<string, SkillRow>,
  }));

  const week = xpGained(snapshots);
  const climbing = nextLevels(snapshots[0]?.skills ?? {}, 3);
  const acts = Array.isArray(hiscores[0]?.activities)
    ? (hiscores[0].activities as { name: string; rank: number | null; score: number | null; kind: 'clue' | 'boss' | 'minigame' }[])
    : [];
  const bosses = activityHighlights(acts, 'boss', 3);
  const clues = totalClues(acts);

  const levels = progress?.levels ?? new Map<string, number>();
  // rankMethods keys levels by display name; the planner keys by skill key.
  const levelsByName = new Map<string, number>();
  for (const [key, level] of levels) {
    levelsByName.set(key.charAt(0).toUpperCase() + key.slice(1), level);
  }

  const method =
    rankMethods(catalogue.methods, catalogue.priced, cashStack, levelsByName).find(
      (m) => !m.locked && m.actionsPerHour > 0 && (m.profitPerHour ?? 0) > 0
    ) ?? null;

  const nextUnlock = progress
    ? (rankUnlocks(UNLOCKS, questMap(), progress.done, progress.levels, progress.questPoints).find(
        (p) => !p.complete
      ) ?? null)
    : null;
  const readyStep = nextUnlock?.ready[0] ?? null;

  const hiscoresAgeDays = hiscores[0]?.takenAt
    ? (Date.now() - hiscores[0].takenAt.getTime()) / 86_400_000
    : null;

  const needs = [
    ...positionAttention(portfolio.positions),
    ...dataAttention({ hiscoresAgeDays, hasAccount: accounts.length > 0 }),
  ];

  const hour = new Date().getHours();
  const name = accounts[0]?.rsn ?? user.email.split('@')[0];

  return (
    <AppShell current="dashboard" signedIn cashStack={cashStack}>
      <h1>
        {greeting(hour)}, {name}
      </h1>

      <div className="dash-standing">
        <div>
          <span className="dash-label">Cash stack</span>
          <strong>{formatGp(book.cashStack)}</strong>
        </div>
        <div>
          <span className="dash-label">Open positions</span>
          <strong>{book.positionCount}</strong>
          {book.positionCount > 0 && (
            <span className="subtle">
              {book.openUnrealised === null ? (
                'value unknown'
              ) : (
                <span className={plClass(book.openUnrealised)}>
                  {gpExact(book.openUnrealised)} if closed now
                </span>
              )}
            </span>
          )}
        </div>
        <div>
          <span className="dash-label">Cash plus book</span>
          <strong>{book.total === null ? '—' : formatGp(book.total)}</strong>
          {book.total === null && (
            <span className="subtle">an item has no price, so this would be short</span>
          )}
        </div>
      </div>

      <Needs items={needs} />

      <h2>Worth doing</h2>
      <div className="dash-cards">
        <article className="dash-card">
          <span className="dash-kicker">Flip</span>
          {flip ? (
            <>
              <h3>
                <Link href={`/item/${flip.itemId}`}>{flip.name}</Link>
              </h3>
              <p className="dash-figure">
                <span className={plClass(flip.profitPerWindow)}>
                  {formatGp(flip.profitPerWindow)}
                </span>{' '}
                <span className="subtle">per four-hour window, after tax</span>
              </p>
              <p className="subtle">
                Buy at {formatGp(flip.buyPrice)}, sell at {formatGp(flip.sellPrice)}.{' '}
                {flip.unitsPerWindow.toLocaleString('en-US')} units ties up{' '}
                {formatGp(flip.capitalRequired)}
                {capitalShare(flip.capitalRequired, cashStack) !== null && (
                  <> — {capitalShare(flip.capitalRequired, cashStack)}% of your stack</>
                )}
                .
              </p>
              <Link href="/flips" className="dash-more">
                All flips
              </Link>
            </>
          ) : (
            <p className="subtle">
              Nothing worth flipping on a liquid book at {formatGp(cashStack)} right now. That is a
              real answer, not a missing one — <Link href="/flips">the full table</Link> drops the
              volume floor.
            </p>
          )}
        </article>

        <article className="dash-card">
          <span className="dash-kicker">Make</span>
          {method ? (
            <>
              <h3>{method.method.name}</h3>
              <p className="dash-figure">
                <span className={plClass(method.profitPerHour ?? 0)}>
                  {formatGp(method.profitPerHour ?? 0)}
                </span>{' '}
                <span className="subtle">an hour, at live prices</span>
              </p>
              <p className="subtle">
                Capped by {method.limitedBy === 'rate' ? 'nothing but your clicking' : method.limitedBy}.
                Needs {formatGp(method.capitalPerHour)} of inputs an hour.
              </p>
              <Link href="/money" className="dash-more">
                All methods
              </Link>
            </>
          ) : (
            <p className="subtle">
              Nothing you can run right now — every method is above your level or beyond your cash.{' '}
              <Link href="/money">See what is worth training towards</Link>.
            </p>
          )}
        </article>

        <article className="dash-card">
          <span className="dash-kicker">Unlock</span>
          {nextUnlock && readyStep ? (
            <>
              <h3>{readyStep.quest.name}</h3>
              <p className="dash-figure">
                <span className="subtle">You can start this now</span>
              </p>
              <p className="subtle">
                Towards <strong>{nextUnlock.unlock.name}</strong> —{' '}
                {nextUnlock.questsLeft} step{nextUnlock.questsLeft === 1 ? '' : 's'} left
                {nextUnlock.levelsNeeded.length === 0 ? ' and no training' : ''}.
                {readyStep.quest.items && <> Bring: {readyStep.quest.items.join(', ')}.</>}
              </p>
              <Link href="/unlocks" className="dash-more">
                The whole chain
              </Link>
            </>
          ) : nextUnlock ? (
            <>
              <h3>{nextUnlock.unlock.name}</h3>
              <p className="subtle">
                Nothing startable yet — {nextUnlock.questsLeft} step
                {nextUnlock.questsLeft === 1 ? '' : 's'} left, blocked on earlier quests or levels.
              </p>
              <Link href="/unlocks" className="dash-more">
                What is in the way
              </Link>
            </>
          ) : (
            <p className="subtle">
              {accounts.length === 0 ? (
                <>
                  <Link href="/accounts">Add an account</Link> and this works out what is reachable
                  from your levels.
                </>
              ) : (
                <>
                  Everything tracked is unlocked. <Link href="/unlocks">The planner</Link> has more
                  to add.
                </>
              )}
            </p>
          )}
        </article>
      </div>

      {(week.xp !== null || climbing.length > 0 || bosses.length > 0 || clues !== null) && (
        <section className="card">
          <h2>Your week</h2>
          <div className="dash-progress">
            <div>
              <span className="dash-label">XP gained</span>
              {week.xp === null ? (
                <>
                  <strong>—</strong>
                  <span className="subtle">
                    not tracked long enough yet — this needs two syncs a few days apart
                  </span>
                </>
              ) : (
                <>
                  <strong>{formatXp(week.xp)}</strong>
                  <span className="subtle">
                    over {spanLabel(week.overMs)}
                    {week.bySkill[0] && <> · mostly {week.bySkill[0].skill}</>}
                  </span>
                </>
              )}
            </div>

            {clues !== null && (
              <div>
                <span className="dash-label">Clue scrolls</span>
                <strong>{clues.toLocaleString('en-US')}</strong>
                <span className="subtle">completed</span>
              </div>
            )}

            {bosses.length > 0 && (
              <div>
                <span className="dash-label">Most killed</span>
                <strong>{bosses[0].score.toLocaleString('en-US')}</strong>
                <span className="subtle">{bosses[0].name}</span>
              </div>
            )}
          </div>

          {climbing.length > 0 && (
            <>
              <h3 className="dash-sub">Closest level-ups</h3>
              <ul className="dash-levels">
                {climbing.map((l) => (
                  <li key={l.skill}>
                    <span className="dash-skill">
                      {l.skill.charAt(0).toUpperCase() + l.skill.slice(1)} {l.next}
                    </span>
                    <span className="dash-bar" aria-hidden="true">
                      <span style={{ width: `${Math.round(l.progressPct)}%` }} />
                    </span>
                    <span className="subtle">{formatXp(l.xpToGo)} to go</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>
      )}

      {news.length > 0 && (
        <section className="card">
          <h2>What&rsquo;s new</h2>
          <NewsFeed items={news} compact />
          <Link href="/news" className="dash-more">
            All news
          </Link>
        </section>
      )}

      {portfolio.positions.length > 0 && (
        <section className="card">
          <h2>Your book</h2>
          <div className="table-wrap">
            <table className="flips">
              <thead>
                <tr>
                  <th className="left">Item</th>
                  <th>Held</th>
                  <th>Avg cost</th>
                  <th>Now</th>
                  <th>If closed</th>
                </tr>
              </thead>
              <tbody>
                {portfolio.positions.map((p) => (
                  <tr key={p.itemId}>
                    <th scope="row" className="left">
                      <Link href={`/item/${p.itemId}`} className="item-name">
                        {p.itemName}
                      </Link>
                    </th>
                    <td>
                      <span className="num">{p.quantity.toLocaleString('en-US')}</span>
                    </td>
                    <td>
                      <span className="num subtle">{gpExact(p.avgCost)}</span>
                    </td>
                    <td>
                      <span className="num">{p.mark === null ? '—' : gpExact(p.mark)}</span>
                    </td>
                    <td>
                      {p.unrealised === null ? (
                        <span className="subtle">unknown</span>
                      ) : (
                        <span className={plClass(p.unrealised)}>{gpExact(p.unrealised)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link href="/journal" className="dash-more">
            The full book
          </Link>
        </section>
      )}

      {needs.length === 0 && portfolio.positions.length === 0 && (
        <p className="subtle dash-quiet">
          Nothing needs you and nothing is open. That is the normal state of this page, and it will
          say so rather than inventing something for you to worry about.
        </p>
      )}
    </AppShell>
  );
}
