#!/usr/bin/env node
/*
 * Every className the components use should have a rule somewhere.
 *
 * This exists because a stylesheet rewrite silently deleted the styles for
 * whole sections of the site — the build passed, types passed, and the pages
 * rendered as unstyled text. Nothing else catches that.
 *
 * Run: npm run check:css
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const root = 'src';

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const files = walk(root);
const css = files
  .filter((f) => extname(f) === '.css')
  .map((f) => readFileSync(f, 'utf8'))
  .join('\n');

const defined = new Set([...css.matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

// Ternaries and template literals produce fragments that aren't class names.
const noise = /^[^a-zA-Z]|[^\w-]|^(?:on|done|over|ghost|booked|self|settings|center)$/;


/*
 * Second check: the same class defined in two stylesheets.
 *
 * Two rules with the same selector and the same specificity means whichever
 * file is imported last wins — but only for the properties it actually sets.
 * The rest leak through from the other file. That is how a masthead form
 * written as `display: flex` ended up laid out as a column: base.css already
 * owned `.stack` and set flex-direction there, and nothing anywhere failed.
 *
 * Renaming is the fix, not raising specificity.
 */
function crossFileCollisions() {
  const cssFiles = files.filter((f) => extname(f) === '.css');
  const owners = new Map();
  for (const f of cssFiles) {
    const body = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    // Top-level rules only; a nested or compound selector is a deliberate
    // override rather than an accidental redefinition.
    const declared = new Set([...body.matchAll(/^\s*\.([a-zA-Z][\w-]*)[^{,]*\{/gm)].map((m) => m[1]));
    for (const c of declared) {
      if (!owners.has(c)) owners.set(c, []);
      owners.get(c).push(f);
    }
  }
  return [...owners].filter(([, fs]) => fs.length > 1);
}

const collisions = crossFileCollisions();
if (collisions.length > 0) {
  console.error(`check:css — ${collisions.length} class(es) defined in more than one stylesheet:\n`);
  for (const [c, fs] of collisions) {
    console.error(`  .${c}`);
    console.error(`      ${fs.join('  and  ')}`);
    console.error('      rename one — the loser silently keeps whatever the winner does not set\n');
  }
  process.exit(1);
}

const used = new Map();
for (const f of files.filter((f) => extname(f) === '.tsx')) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/className="([^"{}]*)"/g)) {
    for (const c of m[1].split(/\s+/)) {
      if (!c || noise.test(c)) continue;
      if (!used.has(c)) used.set(c, new Set());
      used.get(c).add(f);
    }
  }
}

const missing = [...used.entries()].filter(([c]) => !defined.has(c));

if (missing.length === 0) {
  console.log(`check:css — ${used.size} classes, all styled`);
  process.exit(0);
}

console.error(`check:css — ${missing.length} class(es) used with no CSS rule:\n`);
for (const [c, where] of missing.sort()) {
  console.error(`  .${c}`);
  for (const f of where) console.error(`      ${f}`);
}
process.exit(1);
