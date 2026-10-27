'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { addGoal, removeGoal } from '@/app/actions/goals';

export type GoalView = {
  id: string;
  skillName: string;
  targetLevel: number;
  currentLevel: number;
  xpRemaining: number;
  xpLabel: string;
  eta: string | null;
  note: string | null;
  achieved: boolean;
};

export default function Goals({
  accountId,
  goals,
  skills,
  hasRate,
}: {
  accountId: string;
  goals: GoalView[];
  skills: { key: string; name: string }[];
  hasRate: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <section className="card">
      <h2>Goals</h2>

      {goals.length === 0 ? (
        <p className="muted">
          No goals yet. Set one and it works out what&rsquo;s left and how long that takes{' '}
          <em>at your own measured rate</em> — not a guide&rsquo;s optimal number from someone
          playing perfectly.
        </p>
      ) : (
        <ul className="goal-list">
          {goals.map((g) => (
            <li key={g.id} className={g.achieved ? 'done' : undefined}>
              <div className="goal-main">
                <strong>
                  {g.skillName} {g.targetLevel}
                </strong>
                {g.achieved ? (
                  <span className="ok"> reached</span>
                ) : (
                  <span className="subtle">
                    {' '}
                    from {g.currentLevel} · {g.xpLabel} to go
                    {g.eta ? ` · ${g.eta} at your rate` : ''}
                  </span>
                )}
                {g.note && <span className="subtle"> · {g.note}</span>}
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await removeGoal(g.id);
                    if (!r.ok) setError(r.error);
                    router.refresh();
                  })
                }
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {!hasRate && goals.length > 0 && (
        <p className="subtle">
          Time estimates need two snapshots at least half an hour apart. They&rsquo;ll appear once
          there&rsquo;s a second reading.
        </p>
      )}

      <form
        className="row-form"
        action={(formData) =>
          start(async () => {
            setError(null);
            const r = await addGoal(formData);
            if (r.ok) router.refresh();
            else setError(r.error);
          })
        }
      >
        <input type="hidden" name="accountId" value={accountId} />
        <select name="skill" aria-label="Skill" required defaultValue="">
          <option value="" disabled>
            Skill
          </option>
          {skills.map((s) => (
            <option key={s.key} value={s.key}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          name="targetLevel"
          inputMode="numeric"
          defaultValue="99"
          aria-label="Target level"
          required
        />
        <input name="note" maxLength={120} placeholder="note (optional)" autoComplete="off" />
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Add goal'}
        </button>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </form>
    </section>
  );
}
