'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createPost } from '@/app/actions/news';

/**
 * Writing a post.
 *
 * Publish is a deliberate tick rather than the default, so a half-written
 * thought does not reach the overview of everyone signed in the moment
 * you hit save.
 */
export default function PostForm() {
  const router = useRouter();
  const form = useRef<HTMLFormElement>(null);
  const [note, setNote] = useState<{ text: string; ok: boolean } | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      ref={form}
      className="flip-form"
      action={(data) =>
        start(async () => {
          const result = await createPost(data);
          setNote({ text: result.ok ? result.message : result.error, ok: result.ok });
          if (result.ok) {
            form.current?.reset();
            router.refresh();
          }
        })
      }
    >
      <div className="flip-field wide">
        <label htmlFor="news-title">Title</label>
        <input id="news-title" name="title" maxLength={140} required autoComplete="off" />
      </div>

      <div className="flip-field wide">
        <label htmlFor="news-body">What changed</label>
        <textarea id="news-body" name="body" rows={5} maxLength={4000} />
      </div>

      <div className="flip-field">
        <label htmlFor="news-publish" className="news-check">
          <input id="news-publish" name="publish" type="checkbox" defaultChecked />
          <span>Publish now</span>
        </label>
      </div>

      <div className="flip-field">
        <button type="submit" disabled={pending}>
          {pending ? 'Saving…' : 'Save post'}
        </button>
      </div>

      {note && (
        <p className={note.ok ? 'ok' : 'error'} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}
