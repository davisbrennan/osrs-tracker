#!/usr/bin/env node
/*
 * Two structural checks the build is slow to tell you about.
 *
 * 1. Every page must set the page column. The gutter lives on `.page-wrap`,
 *    which AppShell applies for you. A page that renders its own root element
 *    — the legal pages do, because they want a narrower measure and no tabs —
 *    has to say `page-wrap` itself. Forget it and content sits flush against
 *    the viewport edge on a phone while every other check passes.
 *
 * 2. A file marked 'use server' may only export async functions. Turbopack
 *    enforces this, but only during a full build: four minutes to be told a
 *    constant is in the wrong file, and the error names the constant rather
 *    than the rule. This catches it in a second.
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

const files = walk('src');
let failed = false;

// ---------------------------------------------------------------- 1. column

/** Any one of these means the page has a column of its own. */
const COLUMN_CLASSES = ['page-wrap', 'plain-page', 'notice-page', 'authwrap'];

/** Components that bring their own `.page-wrap`. */
const SHELLS = ['AppShell', 'AdminShell'];

const noColumn = [];
for (const file of files) {
  if (basename(file) !== 'page.tsx') continue;
  const src = readFileSync(file, 'utf8');

  if (SHELLS.some((s) => new RegExp(`<${s}[\\s>]`).test(src))) continue;
  if (COLUMN_CLASSES.some((c) => src.includes(c))) continue;

  // A page that only redirects or 404s renders nothing, so it needs no column.
  if (!/<(main|div|section|article|form|h1)[\s>]/.test(src)) continue;

  noColumn.push(file);
}

if (noColumn.length > 0) {
  failed = true;
  console.error(`check:layout — ${noColumn.length} page(s) with no page column:\n`);
  for (const p of noColumn) {
    console.error(`  ${p}`);
    console.error(
      `      renders markup without AppShell and without one of: ${COLUMN_CLASSES.join(', ')}`
    );
    console.error('      content will touch the viewport edge on a narrow screen\n');
  }
}

// --------------------------------------------------------- 2. server actions

const strayExports = [];
for (const file of files) {
  if (!file.endsWith('.ts') && !file.endsWith('.tsx')) continue;
  const src = readFileSync(file, 'utf8');
  if (!/^\s*['"]use server['"]/m.test(src)) continue;

  for (const m of src.matchAll(/^export\s+(?!async\s+function\b|type\b|interface\b|\{)(\S+)/gm)) {
    strayExports.push({ file, what: m[0].trim() });
  }
}

if (strayExports.length > 0) {
  failed = true;
  console.error(
    `check:layout — ${strayExports.length} non-async export(s) in a 'use server' file:\n`
  );
  for (const p of strayExports) {
    console.error(`  ${p.file}`);
    console.error(`      ${p.what} …`);
    console.error("      move it to a plain module — 'use server' allows only async functions\n");
  }
}

if (failed) process.exit(1);

console.log('check:layout — pages have a column, server actions export only async functions');
