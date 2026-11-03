/**
 * The shared-work cache.
 *
 * Small enough that the tests are mostly about the edges: that it expires,
 * that a thrown error is not cached as if it were an answer, and that it
 * does not grow without limit in a process that runs for weeks.
 */

const { memo, forget, size } = await import('@/lib/memo');

let fail = 0;
let checks = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  checks++;
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fail++;
  console.log(
    `  ${ok ? '✓' : '✗'} ${label}: ${JSON.stringify(got)}${ok ? '' : ` WANT ${JSON.stringify(want)}`}`
  );
};
const ok = (label: string, cond: boolean, detail = '') => {
  checks++;
  if (!cond) fail++;
  console.log(`  ${cond ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

console.log('\nThe work happens once');
{
  forget();
  let runs = 0;
  const fn = async () => {
    runs++;
    return 'value';
  };
  eq('first call computes', await memo('k', 5_000, fn), 'value');
  eq('second call does not', await memo('k', 5_000, fn), 'value');
  await memo('k', 5_000, fn);
  eq('ran exactly once', runs, 1);
}

console.log('\nAnd again once it expires');
{
  forget();
  let runs = 0;
  const fn = async () => {
    runs++;
    return runs;
  };
  eq('first', await memo('k', 40, fn), 1);
  eq('cached', await memo('k', 40, fn), 1);
  await sleep(60);
  eq('recomputed after the ttl', await memo('k', 40, fn), 2);
}

console.log('\nAn error is not an answer');
{
  // The tempting optimisation is to store the promise and share it between
  // concurrent callers. A stored rejected promise then poisons the key for
  // everyone until it expires, turning one blip into five minutes of
  // errors. This deliberately does not do that.
  forget();
  let runs = 0;
  const flaky = async () => {
    runs++;
    if (runs === 1) throw new Error('db down');
    return 'recovered';
  };

  let threw = false;
  try {
    await memo('k', 5_000, flaky);
  } catch {
    threw = true;
  }
  ok('the error reaches the caller', threw);
  eq('and the next call retries rather than replaying it', await memo('k', 5_000, flaky), 'recovered');
  eq('now it is cached', await memo('k', 5_000, flaky), 'recovered');
  eq('so it ran twice in total', runs, 2);
}

console.log('\nKeys do not collide');
{
  forget();
  eq('a', await memo('a', 5_000, async () => 'A'), 'A');
  eq('b', await memo('b', 5_000, async () => 'B'), 'B');
  eq('a is still a', await memo('a', 5_000, async () => 'changed'), 'A');
}

console.log('\nForgetting');
{
  forget();
  let runs = 0;
  const fn = async () => ++runs;
  await memo('k', 5_000, fn);
  forget('k');
  eq('a forgotten key recomputes', await memo('k', 5_000, fn), 2);

  await memo('other', 5_000, fn);
  forget();
  eq('forgetting everything clears the lot', size(), 0);
}

console.log('\nIt does not grow forever');
{
  // This lives in a process that runs for weeks. An unbounded map keyed by
  // anything request-derived would be a slow leak.
  forget();
  for (let i = 0; i < 260; i++) {
    await memo(`key-${i}`, 60_000, async () => i);
  }
  ok('bounded', size() <= 200, String(size()));
}

console.log('\nFalsy values are values');
{
  forget();
  let runs = 0;
  const zero = async () => {
    runs++;
    return 0;
  };
  eq('zero is returned', await memo('z', 5_000, zero), 0);
  await memo('z', 5_000, zero);
  // A `if (!cached)` check would recompute zero, null and '' forever —
  // and 0 is exactly what a coverage count returns on a new install.
  eq('and cached, not treated as a miss', runs, 1);

  forget();
  let nullRuns = 0;
  const nothing = async () => {
    nullRuns++;
    return null;
  };
  await memo('n', 5_000, nothing);
  await memo('n', 5_000, nothing);
  eq('null is cached too', nullRuns, 1);
}

console.log(`\n${checks - fail}/${checks} checks passed`);
if (fail) process.exit(1);
