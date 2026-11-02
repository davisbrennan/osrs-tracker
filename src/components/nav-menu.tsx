'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

export type MenuItem = {
  key: string;
  href: string;
  label: string;
  icon: React.ReactElement | null;
};

/**
 * One grouped nav menu.
 *
 * A disclosure rather than a hover menu: hover menus are unusable on a
 * touchscreen and awkward for anyone navigating by keyboard, and this nav
 * has to work on a phone because that is where half of it gets read.
 *
 * The behaviours that make a menu feel finished rather than merely present:
 * Escape closes it and returns focus to the button, clicking outside closes
 * it, arrow keys move through the items, and the button reports its state so
 * a screen reader announces it. None of that is optional — a menu you cannot
 * dismiss with Escape is the kind of thing people notice without being able
 * to say why it feels wrong.
 */
export default function NavMenu({
  label,
  items,
  activeKey,
}: {
  label: string;
  items: MenuItem[];
  activeKey: string;
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const containsActive = items.some((i) => i.key === activeKey);

  useEffect(() => {
    if (!open) return;

    const onPointer = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };

    document.addEventListener('mousedown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  /** Arrow keys walk the open menu; Home and End jump to its ends. */
  function onListKeyDown(e: React.KeyboardEvent) {
    const links = Array.from(list.current?.querySelectorAll('a') ?? []);
    if (links.length === 0) return;
    const index = links.indexOf(document.activeElement as HTMLAnchorElement);

    const go = (next: number) => {
      e.preventDefault();
      links[(next + links.length) % links.length]?.focus();
    };

    if (e.key === 'ArrowDown') go(index + 1);
    else if (e.key === 'ArrowUp') go(index - 1);
    else if (e.key === 'Home') go(0);
    else if (e.key === 'End') go(links.length - 1);
  }

  return (
    <div className="navmenu" ref={wrap}>
      <button
        type="button"
        ref={button}
        className={`navmenu-btn${containsActive ? ' on' : ''}`}
        aria-expanded={open}
        aria-haspopup="true"
        onClick={() => setOpen((v) => !v)}
        onKeyDown={(e) => {
          // Opening with a down arrow should land you on the first item,
          // which is what every other menu on the web does.
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
            requestAnimationFrame(() => list.current?.querySelector('a')?.focus());
          }
        }}
      >
        {label}
        <svg
          viewBox="0 0 10 6"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          aria-hidden="true"
          className="navmenu-caret"
        >
          <path d="m1 1 4 4 4-4" />
        </svg>
      </button>

      {open && (
        <div className="navmenu-list" ref={list} onKeyDown={onListKeyDown}>
          {items.map((item) => (
            <Link
              key={item.key}
              href={item.href}
              aria-current={item.key === activeKey ? 'page' : undefined}
              onClick={() => setOpen(false)}
            >
              {item.icon}
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
