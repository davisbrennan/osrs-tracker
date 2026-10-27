'use client';

import { useState } from 'react';
import { signIn } from '@/lib/auth-client';
import { signupAllowed } from '@/app/actions/signup-gate';

export default function SignInForm({
  callbackURL = '/dashboard',
  prefill = '',
}: {
  callbackURL?: string;
  prefill?: string;
}) {
  const [email, setEmail] = useState(prefill);
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [message, setMessage] = useState('');

  async function submit() {
    if (!email.includes('@')) {
      setState('error');
      setMessage('That doesn’t look like an email address.');
      return;
    }
    setState('sending');
    // callbackURL is where the magic link lands. For invites that’s the invite
    // page itself, so the token isn’t lost between email and sign-in.
    // Sign-ups can be paused from the admin panel; existing accounts still work.
    const gate = await signupAllowed(email);
    if (!gate.ok) {
      setState('error');
      setMessage(gate.reason);
      return;
    }

    const { error } = await signIn.magicLink({ email, callbackURL });
    if (error) {
      setState('error');
      setMessage(error.message ?? 'Something went wrong. Try again.');
    } else {
      setState('sent');
    }
  }

  if (state === 'sent') {
    return (
      <div className="notice">
        <strong>Check your email.</strong>
        <p>
          We sent a sign-in link to {email}. It expires in 15 minutes and works once. Open it in
          this same browser.
        </p>
      </div>
    );
  }

  return (
    <div className="stack">
      <label htmlFor="email">Email address</label>
      <input
        id="email"
        type="email"
        autoComplete="email"
        value={email}
        placeholder="you@example.com"
        onChange={(e) => setEmail(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
      />
      <button onClick={submit} disabled={state === 'sending'}>
        {state === 'sending' ? 'Sending\u2026' : 'Email me a link'}
      </button>
      {state === 'error' && <p className="error">{message}</p>}
    </div>
  );
}
