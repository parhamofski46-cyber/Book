// Stratified before/after comparison.
//
// The whole difficulty of blaming a restart for a slowdown is that population
// is a confounder. A roleplay server is genuinely worse at 21:00 than at 09:00
// because there are five times as many players on it, so a naive before/after
// split accuses whatever happened to restart during the evening climb.
//
// So we never compare aggregates directly. Samples are bucketed by player
// count, only buckets present on both sides are used, and each bucket's
// contribution is weighted by how much evidence it has. What comes out is
// "at the same population, did this get worse" -- which is the question.

// Bucketing removes most of the confounding, not all of it: within a single
// bucket the mix of player counts can still differ between the two sides, and
// the leftover bias is bounded by how steeply stall time rises across the
// bucket's width. Ten is where that residual stops mattering against the
// detection thresholds without starving each bucket of samples -- at twenty a
// synthetic case still showed a 17% phantom increase.
export const PLAYER_BUCKET = 10;
export const MIN_PER_BUCKET = 3;

const bucketOf = (players) => Math.floor(players / PLAYER_BUCKET);
const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

function group(samples) {
  const buckets = new Map();
  for (const s of samples) {
    const key = bucketOf(s.players);
    let b = buckets.get(key);
    if (!b) buckets.set(key, (b = { stall: [], hitches: [], p95: [] }));
    b.stall.push(s.stall_ms);
    b.hitches.push(s.hitches);
    b.p95.push(s.p95_drift);
  }
  return buckets;
}

/**
 * Compare two sets of collector windows at matched population.
 * Metrics are per-window means, so no assumption is made about window length
 * beyond it being the same on both sides -- which it is, unless the operator
 * reconfigured the agent in between.
 */
export function stratifiedCompare(before, after) {
  const a = group(before);
  const b = group(after);

  let weightTotal = 0;
  let beforeStall = 0, afterStall = 0;
  let beforeHitch = 0, afterHitch = 0;
  let beforeP95 = 0, afterP95 = 0;
  const matchedBuckets = [];

  for (const [key, ba] of a) {
    const bb = b.get(key);
    if (!bb) continue;
    if (ba.stall.length < MIN_PER_BUCKET || bb.stall.length < MIN_PER_BUCKET) continue;

    // Weighted by the smaller side: a bucket with 200 windows before and 4
    // after carries the evidence of 4, not 200.
    const weight = Math.min(ba.stall.length, bb.stall.length);
    weightTotal += weight;
    beforeStall += mean(ba.stall) * weight;
    afterStall += mean(bb.stall) * weight;
    beforeHitch += mean(ba.hitches) * weight;
    afterHitch += mean(bb.hitches) * weight;
    beforeP95 += mean(ba.p95) * weight;
    afterP95 += mean(bb.p95) * weight;

    matchedBuckets.push({
      players: key * PLAYER_BUCKET,
      beforeWindows: ba.stall.length,
      afterWindows: bb.stall.length,
      beforeStall: mean(ba.stall),
      afterStall: mean(bb.stall),
    });
  }

  if (weightTotal === 0) {
    return { comparable: false, reason: 'no overlapping population', matchedBuckets: [], weight: 0 };
  }

  return {
    comparable: true,
    weight: weightTotal,
    matchedBuckets,
    beforeStallPerWindow: beforeStall / weightTotal,
    afterStallPerWindow: afterStall / weightTotal,
    beforeHitchPerWindow: beforeHitch / weightTotal,
    afterHitchPerWindow: afterHitch / weightTotal,
    beforeP95: beforeP95 / weightTotal,
    afterP95: afterP95 / weightTotal,
  };
}

/** Median gap between consecutive windows, in seconds. */
export function windowSeconds(samples, fallback = 15) {
  if (samples.length < 3) return fallback;
  const gaps = [];
  for (let i = 1; i < samples.length; i++) {
    const d = samples[i].wall_s - samples[i - 1].wall_s;
    if (d > 0 && d < 3600) gaps.push(d);
  }
  if (!gaps.length) return fallback;
  gaps.sort((x, y) => x - y);
  return gaps[Math.floor(gaps.length / 2)];
}
