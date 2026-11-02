import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { currentUser, cashStackFor } from '@/lib/session';
import { myAccounts, progressFor } from '@/app/actions/quests';
import { QUESTS, UNLOCKS, questMap } from '@/lib/osrs/quest-data';
import { rankUnlocks, planUnlock, questCount, type Plan, type Step } from '@/lib/osrs/quests';
import { SKILLS } from '@/lib/osrs/skills';
import { ago } from '@/lib/gp';
import AppShell from '@/components/app-shell';
import QuestTicks from './quest-ticks';

export const metadata: Metadata = {
  title: 'Unlocks',
  robots: { index: false, follow: false },
};

type Search = { account?: string | string[]; goal?: string | string[] };

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

const skillName = (key: string) => SKILLS.find((s) => s.key === key)?.name ?? key;

function StepRow({ step }: { step: Step }) {
  const quests = questMap();
  return (
    <li className={`ul-step ul-${step.status}`}>
      <div className="ul-step-head">
        <span className="ul-mark" aria-hidden="true">
          {step.status === 'done' ? '✓' : step.status === 'ready' ? '→' : '·'}
        </span>
        <span className="ul-step-name">
          {step.quest.name}
          {step.stage === 'started' && <span className="ul-partial">start only</span>}
        </span>
        <span className="ul-status">
          {step.status === 'done' ? 'done' : step.status === 'ready' ? 'you can start this' : ''}
        </span>
      </div>

      {step.stage === 'started' && step.status !== 'done' && (
        <p className="ul-note">
          You only need to play this far enough to be granted access. Finishing it is a separate
          job, and that is where its skill requirements live.
        </p>
      )}

      {step.waitingOn.length > 0 && (
        <p className="ul-why">
          Waiting on {step.waitingOn.map((id) => quests.get(id)?.name ?? id).join(', ')}
        </p>
      )}

      {step.gaps.length > 0 && (
        <p className="ul-why">
          {step.gaps.map((g) => (
            <span key={g.skill} className="ul-gap">
              {skillName(g.skill)} {g.need}
              <span className="subtle"> — you have {g.have}</span>
              {g.boostable && <span className="ul-boost">boostable</span>}
            </span>
          ))}
        </p>
      )}

      {step.quest.items && step.status !== 'done' && (
        <p className="ul-items">Bring: {step.quest.items.join(', ')}</p>
      )}
    </li>
  );
}

/**
 * The unlock planner.
 *
 * Answers "what is actually between me and this", which is a different
 * question from "what are this quest's requirements" and a much more useful
 * one. The difference shows up immediately: fairy rings read as three steps
 * and no training for an account that a naive reading would send to train
 * Herblore to 57, because the quest that wants 57 Herblore only needs to be
 * STARTED.
 */
export default async function Unlocks({ searchParams }: { searchParams: Promise<Search> }) {
  const sp = await searchParams;
  const user = await currentUser();
  if (!user) redirect('/signin?next=/unlocks');

  const [accounts, cashStack] = await Promise.all([myAccounts(), cashStackFor(user.id)]);

  if (accounts.length === 0) {
    return (
      <AppShell current="unlocks" signedIn cashStack={cashStack}>
        <h1>Unlocks</h1>
        <div className="empty">
          <strong>Add an account first</strong>
          <p>
            Plans are worked out against your own levels, so this needs an RSN to read them from.{' '}
            <Link href="/accounts">Add one</Link> and come back.
          </p>
        </div>
      </AppShell>
    );
  }

  const accountId = one(sp.account) ?? accounts[0].id;
  const progress = await progressFor(accountId);

  if (!progress) {
    return (
      <AppShell current="unlocks" signedIn cashStack={cashStack}>
        <h1>Unlocks</h1>
        <div className="empty">
          <strong>That account is not yours</strong>
          <p>
            <Link href="/unlocks">Start again</Link>.
          </p>
        </div>
      </AppShell>
    );
  }

  const quests = questMap();
  const plans = rankUnlocks(UNLOCKS, quests, progress.done, progress.levels, progress.questPoints);

  const goalId = one(sp.goal);
  const selected: Plan =
    (goalId ? plans.find((p) => p.unlock.id === goalId) : undefined) ?? plans[0];

  const href = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const base = { account: accountId, goal: selected.unlock.id, ...patch };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    return `/unlocks?${params.toString()}`;
  };

  return (
    <AppShell current="unlocks" signedIn cashStack={cashStack}>
      <h1>Unlocks</h1>
      <p className="lede">
        What actually stands between {progress.rsn} and something worth having — counted against
        your own levels, and careful about the difference between a quest you must finish and one
        you only need to start.
      </p>

      {accounts.length > 1 && (
        <div className="toolbar">
          <div className="seg">
            {accounts.map((a) => (
              <Link
                key={a.id}
                href={`/unlocks?account=${a.id}`}
                aria-current={a.id === accountId ? 'true' : undefined}
              >
                {a.rsn}
              </Link>
            ))}
          </div>
        </div>
      )}

      {progress.levels.size === 0 && (
        <p className="book-warn">
          <strong>No hiscores yet for {progress.rsn}.</strong> Every level reads as 1 until the
          first sync, so anything with a skill requirement will look further away than it is.{' '}
          <Link href="/accounts">Refresh the account</Link>.
        </p>
      )}

      <div className="ul-goals">
        {plans.map((p) => (
          <Link
            key={p.unlock.id}
            href={href({ goal: p.unlock.id })}
            className={`ul-goal${p.unlock.id === selected.unlock.id ? ' on' : ''}${p.complete ? ' ul-got' : ''}`}
          >
            <span className="ul-goal-name">{p.unlock.name}</span>
            <span className="ul-goal-left">
              {p.complete
                ? 'unlocked'
                : p.levelsNeeded.length === 0
                  ? `${questCount(p.questsLeft)}, no training`
                  : `${questCount(p.questsLeft)} + ${p.levelsNeeded.length} skill${p.levelsNeeded.length === 1 ? '' : 's'}`}
            </span>
          </Link>
        ))}
      </div>

      <section className="card ul-plan">
        <h2>{selected.unlock.name}</h2>
        <p className="ul-blurb">{selected.unlock.blurb}</p>

        {selected.complete ? (
          <p className="ok">You already have this.</p>
        ) : (
          <p className="ul-summary">
            <strong>
              {questCount(selected.questsLeft)} left
              {selected.levelsNeeded.length === 0 ? ' and no training at all' : ''}
            </strong>
            {selected.levelsNeeded.length > 0 && (
              <>
                {' — plus '}
                {selected.levelsNeeded
                  .map(
                    (g) =>
                      `${skillName(g.skill)} ${g.need}${g.boostable ? ' (boostable)' : ''}`
                  )
                  .join(', ')}
                .
              </>
            )}
          </p>
        )}

        <ol className="ul-steps">
          {selected.steps.map((s) => (
            <StepRow key={s.quest.id} step={s} />
          ))}
        </ol>

        {selected.unlock.alsoNeeds && (
          <p className="ul-also">
            <strong>Also needed:</strong> {selected.unlock.alsoNeeds.join('; ')}
          </p>
        )}

        <p className="subtle">
          Requirements read from the{' '}
          <a
            href={selected.unlock.source}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            OSRS Wiki
          </a>
          . Levels from your hiscores
          {progress.syncedAt
            ? `, synced ${ago((Date.now() - progress.syncedAt.getTime()) / 60_000)} ago`
            : ''}
          .
        </p>
      </section>

      <section className="card">
        <h2>What have you done?</h2>
        <p className="subtle">
          Tick what {progress.rsn} has finished. The official hiscores do not report quests, and the
          wiki asks third parties not to use the API that does — so this is set by hand rather than
          quietly scraped.
        </p>
        <QuestTicks
          accountId={accountId}
          quests={QUESTS.map((q) => ({ id: q.id, name: q.name }))}
          done={[...progress.done]}
        />
      </section>
    </AppShell>
  );
}
