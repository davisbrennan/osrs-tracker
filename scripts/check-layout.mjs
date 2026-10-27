#!/usr/bin/env node
/*
 * Every page must set the page column.
 *
 * The gutter lives on `.page-wrap`, which AppShell applies for you. A page
 * that renders its own root element instead — the legal pages do, because
 * they want a narrower measure and no tabs — has to say `page-wrap` itself.
 * Forget it and the content sits flush against the viewport edge on a phone
 * while the build passes, the types pass and every other check is happy.
 *
 * This replaces an earlier version that checked the wedding site's
 * band/wrap convention. Same class of bug, different structure.
 *
 * Run: npm run check:layout
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Any one of these means the page has a column of its own. */
const COLUMN_CLASSES = ['page-wrap', 'plain-page', 'authwrap', 'auth-wrap'];

/** Components that bring their own `.page-wrap`. */
const SHELLS = ['AppShell', 'AdminShell'];

const problems = [];

for (const file of walk('src/app')) {
  if (basename(file) !== 'page.tsx') continue;
  const src = readFileSync(file, 'utf8');

  if (SHELLS.some((s) => new RegExp(`<${s}[\\s>]`).test(src))) continue;
  if (COLUMN_CLASSES.some((c) => src.includes(c))) continue;

  // A page that only redirects or 404s renders nothing, so it needs no column.
  const rendersMarkup = /<(main|div|section|article|form|h1)[\s>]/.test(src);
  if (!rendersMarkup) continue;

  problems.push(file);
}

if (problems.length === 0) {
  console.log('check:layout — every page sets its own column');
  process.exit(0);
}

console.error(`check:layout — ${problems.length} page(s) with no page column:\n`);
for (const p of problems) {
  console.error(`  ${p}`);
  console.error(
    `      renders markup without AppShell and without one of: ${COLUMN_CLASSES.join(', ')}`
  );
  console.error('      content will touch the viewport edge on a narrow screen\n');
}
process.exit(1);
