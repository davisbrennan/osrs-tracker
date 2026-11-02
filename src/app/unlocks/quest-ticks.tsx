'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setQuestDone } from '@/app/actions/quests';

/**
 * Ticking off quests.
 *
 * Optimistic, because the plan above redraws from these and a half-second
 * of nothing happening makes people click twice. On failure the tick goes
 * back and says why — silently reverting would read as the click having
 * missed.
 */
export default function QuestTicks({
  accountId,
  quests,
  done,
}: {
  accountId: string;
  quests: { id: string; name: string }[];
  done: string[];
}) {
  const router = useRouter();
  const [ticked, setTicked] = useState<Set<string>>(new Set(done));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function toggle(id: string) {
    const next = new Set(ticked);
    const nowDone = !next.has(id);
    if (nowDone) next.add(id);
    else next.delete(id);
    setTicked(next);
    setError(null);

    start(async () => {
      const result = await setQuestDone(accountId, id, nowDone);
      if (!result.ok) {
        // Put it back exactly as it was.
        setTicked((current) => {
          const reverted = new Set(current);
          if (nowDone) reverted.delete(id);
          else reverted.add(id);
          return reverted;
        });
        setError(result.error);
        return;
      }
      router.refresh();
    });
  }

  return (
    <>
      <ul className="ul-ticks">
        {quests.map((q) => {
          const isDone = ticked.has(q.id);
          return (
            <li key={q.id}>
              <label className={isDone ? 'on' : undefined}>
                <input
                  type="checkbox"
                  checked={isDone}
                  onChange={() => toggle(q.id)}
                  disabled={pending}
                />
                <span>{q.name}</span>
              </label>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="status">
          {error}
        </p>
      )}
    </>
  );
}
