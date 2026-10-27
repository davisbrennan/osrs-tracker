import Link from 'next/link';
import { ADMIN_NAV } from '@/lib/admin-nav';

export default function AdminShell({
  current,
  children,
}: {
  current: string;
  children: React.ReactNode;
}) {
  return (
    <div className="admin">
      <header className="admin-bar">
        <div className="admin-bar-inner">
          <span className="admin-mark">RSpill admin</span>
          <nav>
            {ADMIN_NAV.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                aria-current={current === n.href ? 'page' : undefined}
              >
                {n.label}
              </Link>
            ))}
          </nav>
          <Link href="/flips" className="admin-exit">
            Back to the app
          </Link>
        </div>
      </header>
      <main className="admin-main">{children}</main>
    </div>
  );
}
