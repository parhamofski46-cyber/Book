// Health scoring.
//
// One number an operator can act on, plus the components it came from -- a
// score nobody can decompose is a score nobody trusts. The headline figure is
// the share of wall time the main thread was unavailable, because that is what
// players actually experience as rubber-banding and frozen NPCs.

import { windowSeconds } from './compare.js';

const sum = (xs, f) => xs.reduce((a, s) => a + f(s), 0);

// Exponential decay rather than a linear scale: the difference between 0.1%
// and 1% blocked matters far more than between 20% and 21%, by which point the
// server is unplayable either way.
const decay = (value, scale) => 100 * Math.exp(-value / scale);

export function gradeFor(score) {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  if (score >= 30) return 'D';
  return 'F';
}

export function healthScore(samples) {
  if (!samples.length) {
    return { score: null, grade: null, samples: 0, reason: 'no data in range' };
  }

  const windowS = windowSeconds(samples);
  const totalMs = samples.length * windowS * 1000;
  const stallMs = sum(samples, (s) => s.stall_ms);
  const blocked = totalMs > 0 ? stallMs / totalMs : 0;
  const p95 = sum(samples, (s) => s.p95_drift) / samples.length;
  const hitchesPerHour = (sum(samples, (s) => s.hitches) / (samples.length * windowS)) * 3600;
  const worstMs = samples.reduce((m, s) => Math.max(m, s.max_drift), 0);

  // Blocked time carries most of the weight; p95 catches a server that is
  // never badly stuck but is permanently sluggish.
  const blockedScore = decay(blocked, 0.06);
  const p95Score = decay(p95, 80);
  const score = Math.round(0.7 * blockedScore + 0.3 * p95Score);

  return {
    score,
    grade: gradeFor(score),
    samples: samples.length,
    windowSeconds: windowS,
    blockedPct: Number((blocked * 100).toFixed(3)),
    p95DriftMs: Number(p95.toFixed(1)),
    hitchesPerHour: Number(hitchesPerHour.toFixed(1)),
    worstStallMs: Math.round(worstMs),
    components: { blockedScore: Math.round(blockedScore), p95Score: Math.round(p95Score) },
  };
}
