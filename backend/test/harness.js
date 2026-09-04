// Assertions, matching the collector suite's shape so both halves of the
// project report the same way.
export const T = { passed: 0, failed: 0, failures: [], current: '' };

export async function suite(name, fn) {
  T.current = name;
  console.log(`\n${name}`);
  await fn();
}

export async function test(name, fn) {
  try {
    await fn();
    T.passed++;
    console.log(`  pass  ${name}`);
  } catch (err) {
    T.failed++;
    T.failures.push(`${T.current} / ${name}: ${err.message}`);
    console.log(`  FAIL  ${name}\n        ${err.message}`);
  }
}

const fail = (msg) => { throw new Error(msg); };

export const ok = (cond, msg = 'expected truthy') => { if (!cond) fail(msg); };
export const eq = (a, b, msg = 'not equal') => {
  if (a !== b) fail(`${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`);
};
export const gt = (a, b, msg = 'not greater') => { if (!(a > b)) fail(`${msg} (got ${a}, want > ${b})`); };
export const gte = (a, b, msg = 'not >=') => { if (!(a >= b)) fail(`${msg} (got ${a}, want >= ${b})`); };
export const lte = (a, b, msg = 'not <=') => { if (!(a <= b)) fail(`${msg} (got ${a}, want <= ${b})`); };
export const within = (v, lo, hi, msg = 'out of range') => {
  if (v < lo || v > hi) fail(`${msg} (got ${v}, want ${lo}..${hi})`);
};
export const contains = (haystack, needle, msg = 'missing substring') => {
  if (!String(haystack).includes(needle)) fail(`${msg}: ${JSON.stringify(needle)}`);
};

export function report() {
  console.log(`\n${T.passed} passed, ${T.failed} failed`);
  for (const f of T.failures) console.log(`  ${f}`);
  return T.failed === 0;
}
