/**
 * Is every page still reachable from the menu?
 *
 * Grouping the nav introduced one silent failure it could not have before:
 * a key left out of NAV_GROUPS still has a route, still works if you type
 * the URL, and simply stops appearing anywhere. Nothing breaks, no test
 * fails, and the page quietly ceases to exist for everyone who navigates by
 * clicking.
 *
 * So: every NAV key appears exactly once across the primary link and the
 * groups, and no group references a key that is not in NAV.
 */

const { NAV, NAV_GROUPS, NAV_DIRECT } = await import('@/lib/site');

let problems = 0;
const fail = (msg: string) => {
  problems++;
  console.error(`  ✗ ${msg}`);
};

const navKeys = NAV.map((t: { key: string }) => t.key);
const placed: string[] = [...NAV_DIRECT, ...NAV_GROUPS.flatMap((g: { items: readonly string[] }) => [...g.items])];

for (const key of navKeys) {
  const times = placed.filter((k) => k === key).length;
  if (times === 0) fail(`"${key}" is in NAV but appears in no group — unreachable from the menu`);
  if (times > 1) fail(`"${key}" appears ${times} times in the menu`);
}

for (const key of placed) {
  if (!navKeys.includes(key)) fail(`the menu references "${key}", which is not in NAV`);
}

for (const g of NAV_GROUPS) {
  if (g.items.length === 0) fail(`group "${g.key}" is empty`);
  if (!g.label.trim()) fail(`group "${g.key}" has no label`);
}

// A group whose items are all private renders only for signed-in users,
// which is fine — but a group with no PUBLIC items must not be the only way
// to reach a public page.
const publicKeys = NAV.filter((t: { public: boolean }) => t.public).map((t: { key: string }) => t.key);
for (const key of publicKeys) {
  if ((NAV_DIRECT as readonly string[]).includes(key)) continue;
  const group = NAV_GROUPS.find((g: { items: readonly string[] }) => g.items.includes(key));
  if (!group) fail(`public page "${key}" is in no group`);
}

if (problems) {
  console.error(`\ncheck:nav — ${problems} problem${problems === 1 ? '' : 's'}.`);
  process.exit(1);
}
console.log(
  `check:nav — ${navKeys.length} pages across ${NAV_GROUPS.length} groups plus ${NAV_DIRECT.length} direct links, each reachable exactly once`
);
