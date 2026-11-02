'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setPostPublished, deletePost } from '@/app/actions/news';

export default function RowActions({ id, published }: { id: string; published: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  return (
    <span className="news-actions">
      <button
        type="button"
        className="link"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await setPostPublished(id, !published);
            router.refresh();
          })
        }
      >
        {published ? 'Hide' : 'Publish'}
      </button>
      {confirming ? (
        <>
          <button
            type="button"
            className="link"
            disabled={pending}
            onClick={() =>
              start(async () => {
                await deletePost(id);
                router.refresh();
              })
            }
          >
            Really delete
          </button>
          <button type="button" className="link" onClick={() => setConfirming(false)}>
            Cancel
          </button>
        </>
      ) : (
        <button type="button" className="link" onClick={() => setConfirming(true)}>
          Delete
        </button>
      )}
    </span>
  );
}
