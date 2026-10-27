import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { eq, and, desc, asc } from 'drizzle-orm';
import { db } from '@/database';
import { osrsAccounts, osrsSnapshots, osrsGoals } from '@/database/schema';
import { currentUser, cashStackFor } from '@/lib/session';
import { SKILLS, type SkillRow } from '@/lib/osrs/skills';
import {
  formatXp,
  levelProgress,
  xpToNextLevel,
  xpToLevel,
  MAX_LEVEL,
  XP_AT_99,
  project,
  ratePerHour,
} from '@/lib/osrs/xp';
import { ago, formatEta } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import XpHistory from './xp-history';
import Goals, { type GoalView } from './goals';

export const metadata: Metadata = {
  title: 'Account',
  robots: { index: false, follow: false },
};

/** How far back the XP chart and the measured rate look. */
const WINDOW_DAYS = 30;

export default async function AccountDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await currentUser();
  if (!user) redirect('/signin?next=/accounts');

  const [account] = await db
    .select()
    .from(osrsAccounts)
    .where(and(eq(osrsAccounts.id, id), eq(osrsAccounts.userId, user.id)))
    .limit(1);
  if (!account) notFound();

  const cashStack = await cashStackFor(user.id);

  const snapshots = await db
    .select({
      takenAt: osrsSnapshots.takenAt,
      totalXp: osrsSnapshots.totalXp,
      totalLevel: osrsSnapshots.totalLevel,
      combatLevel: osrsSnapshots.combatLevel,
      skills: osrsSnapshots.skills,
    })
    .from(osrsSnapshots)
    .where(eq(osrsSnapshots.accountId, account.id))
    .orderBy(desc(osrsSnapshots.takenAt))
    .limit(400);

  if (snapshots.length === 0) {
    return (
      <AppShell current="accounts" signedIn cashStack={cashStack}>
        <p className="crumb">
          <Link href="/accounts">Accounts</Link>
        </p>
        <h1>{account.rsn}</h1>
        <div className="empty">
          <strong>No data yet</strong>
          <p>
            The hiscores haven&rsquo;t been read for this account. Use Refresh on the accounts page,
            or wait for the next scheduled pass.
          </p>
        </div>
      </AppShell>
    );
  }

  const current = snapshots[0];
  const skills = current.skills as Record<string, SkillRow>;

  // The oldest snapshot inside the window, for a rate measured over real
  // elapsed time rather than a guess. Falls back to the oldest we have.
  const cutoff = Date.now() - WINDOW_DAYS * 86_400_000;
  const inWindow = snapshots.filter((s) => s.takenAt.getTime() >= cutoff);
  const earliest = (inWindow.length > 1 ? inWindow : snapshots)[
    (inWindow.length > 1 ? inWindow : snapshots).length - 1
  ];

  const xpGained = current.totalXp - earliest.totalXp;
  // Returns null under 30 minutes of elapsed time — a rate extrapolated from
  // two readings minutes apart is noise dressed up as a number.
  const measuredRate = ratePerHour(
    earliest.totalXp,
    earliest.takenAt,
    current.totalXp,
    current.takenAt
  );

  const ordered = SKILLS.filter((m) => m.key !== 'overall')
    .map((meta) => skills[meta.key])
    .filter((s): s is SkillRow => Boolean(s));

  const goalRows = await db
    .select()
    .from(osrsGoals)
    .where(eq(osrsGoals.accountId, account.id))
    .orderBy(asc(osrsGoals.createdAt));

  const goals: GoalView[] = goalRows.map((g) => {
    const meta = SKILLS.find((m) => m.key === g.skill);
    const row = skills[g.skill];
    const target = g.targetLevel ?? MAX_LEVEL;
    const xpRemaining = row ? xpToLevel(row.xp, target) : 0;
    return {
      id: g.id,
      skillName: meta?.name ?? g.skill,
      targetLevel: target,
      currentLevel: row?.level ?? 1,
      xpRemaining,
      xpLabel: formatXp(xpRemaining),
      eta:
        measuredRate && measuredRate > 0 && xpRemaining > 0 && row
          ? formatEta(project(row.xp, target, measuredRate).hours)
          : null,
      note: g.note,
      achieved: xpRemaining <= 0,
    };
  });

  const maxed = ordered.filter((s) => s.level >= MAX_LEVEL).length;
  return (
    <AppShell current="accounts" signedIn cashStack={cashStack}>
      <p className="crumb">
        <Link href="/accounts">Accounts</Link>
      </p>
      <h1>{account.rsn}</h1>
      <p className="lede">
        Last read {ago((Date.now() - current.takenAt.getTime()) / 60_000)} ago.{' '}
        {snapshots.length === 1
          ? 'One snapshot so far — rates and projections need a second one.'
          : `${snapshots.length} snapshots on record.`}
      </p>

      <div className="acct-stats wide">
        <div>
          <dt>Total level</dt>
          <dd>
            <span className="num">{current.totalLevel.toLocaleString('en-US')}</span>
          </dd>
        </div>
        <div>
          <dt>Total XP</dt>
          <dd>
            <span className="num">{formatXp(current.totalXp)}</span>
          </dd>
        </div>
        <div>
          <dt>Combat</dt>
          <dd>
            <span className="num">{current.combatLevel}</span>
          </dd>
        </div>
        <div>
          <dt>99s</dt>
          <dd>
            <span className="num">
              {maxed} / {ordered.length}
            </span>
          </dd>
        </div>
        <div>
          <dt>XP in {WINDOW_DAYS}d</dt>
          <dd>
            <span className={xpGained > 0 ? 'num pl-up' : 'num'}>{formatXp(xpGained)}</span>
          </dd>
        </div>
        <div>
          <dt>Measured rate</dt>
          <dd>
            {/* Null below 30 minutes of elapsed time — a rate extrapolated
                from a few minutes is noise dressed up as a number. */}
            <span className="num">
              {measuredRate === null ? '—' : `${formatXp(Math.round(measuredRate))}/h`}
            </span>
          </dd>
        </div>
      </div>

      {snapshots.length > 1 && (
        <section className="chart-block">
          <h2>Total XP, last {WINDOW_DAYS} days</h2>
          <XpHistory
            points={snapshots
              .slice()
              .reverse()
              .map((s) => ({ t: s.takenAt.getTime(), xp: s.totalXp }))}
          />
        </section>
      )}

      <Goals
        accountId={account.id}
        goals={goals}
        skills={SKILLS.filter((m) => m.key !== 'overall').map((m) => ({
          key: m.key,
          name: m.name,
        }))}
        hasRate={Boolean(measuredRate && measuredRate > 0)}
      />

      <section className="chart-block">
        <h2>Skills</h2>
        <div className="skill-grid">
          {ordered.map((s) => {
            const pct = s.level >= MAX_LEVEL ? 100 : Math.round(levelProgress(s.xp) * 100);
            const toNext = xpToNextLevel(s.xp);
            // project() takes a target LEVEL, not an xp figure.
            const eta =
              measuredRate && measuredRate > 0 && s.level < MAX_LEVEL
                ? formatEta(project(s.xp, MAX_LEVEL, measuredRate).hours)
                : null;
            return (
              <article key={s.key} className={`skill${s.level >= MAX_LEVEL ? ' maxed' : ''}`}>
                <div className="skill-head">
                  <span className="skill-name">{s.name}</span>
                  <span className="num skill-level">{s.level}</span>
                </div>
                <div className="skill-bar" aria-hidden="true">
                  <span style={{ width: `${pct}%` }} />
                </div>
                <div className="skill-foot">
                  <span className="num">{formatXp(s.xp)}</span>
                  {s.level < MAX_LEVEL && (
                    <span
                      className="subtle"
                      title={`${toNext.toLocaleString('en-US')} xp to level ${s.level + 1}`}
                    >
                      {formatXp(toNext)} to {s.level + 1}
                    </span>
                  )}
                  {s.rank !== null && (
                    <span className="subtle">#{s.rank.toLocaleString('en-US')}</span>
                  )}
                </div>
                {eta && (
                  <p className="skill-eta subtle">
                    {formatXp(XP_AT_99 - s.xp)} to 99 · {eta} at your rate
                  </p>
                )}
              </article>
            );
          })}
        </div>
      </section>

      <p className="subtle">
        Bosses, clue scrolls and minigames are being recorded with every snapshot but aren&rsquo;t
        shown yet. The hiscores return them as an unlabelled list, and showing them means being
        certain which row is which — getting that wrong would attach real numbers to the wrong boss
        and look entirely plausible. They go in once the order is verified against a known account.
      </p>
    </AppShell>
  );
}
