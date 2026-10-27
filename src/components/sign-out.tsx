'use client';

import { useRouter } from 'next/navigation';
import { signOut } from '@/lib/auth-client';

export default function SignOut() {
  const router = useRouter();
  return (
    <button
      className="signout"
      onClick={async () => {
        await signOut();
        router.push('/signin');
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
