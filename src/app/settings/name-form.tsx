'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { saveDisplayName } from '@/app/actions/settings';

export default function NameForm({ name }: { name: string }) {
  const router = useRouter();
  const [value, setValue] = useState(name);
  const [saved, setSaved] = useState(false);
  const [pending, start] = useTransition();

  return (
    <form
      className="row-form"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          await saveDisplayName(value);
          setSaved(true);
          router.refresh();
        });
      }}
    >
      <input
        value={value}
        maxLength={60}
        placeholder="What should we call you?"
        aria-label="Display name"
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
      />
      <button type="submit" disabled={pending || value === name}>
        {pending ? 'Saving…' : 'Save name'}
      </button>
      {saved && !pending && <span className="ok">Saved</span>}
    </form>
  );
}
