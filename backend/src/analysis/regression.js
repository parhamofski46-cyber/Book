// Attributing a slowdown to the change that caused it.
//
// This is the question no existing FiveM tool answers, and the reason history
// is worth storing: resmon can tell an operator the server is slow now, but not
// that it has been slow since Tuesday's update to qb-inventory.
//
// The method is deliberately conservative. It would rather stay silent than
// name the wrong resource, because a tool that cries wolf gets uninstalled --
// and on a 200-resource server there is always something that restarted
// recently to blame.

import { stratifiedCompare } from './compare.js';

export const DEFAULTS = {
  // How much of the day either side of a restart is compared.
  windowS: 3 * 3600,
  // Adjacent comparison widens when the two sides barely overlap in
  // population; stratification is what makes the wider window safe.
  maxWindowMultiple: 4,
  // Matched windows beyond which widening buys nothing.
  targetWeight: 80,
  // Minimum matched windows before an accusation is allowed at all.
  minWeight: 20,
  // How many previous days a day-over-day baseline may draw on.
  baselineDays: 3,
  // Restarts closer together than this are one event with several suspects.
  clusterS: 300,
  // A change needs to be both meaningfully large and meaningfully relative:
  // +5ms per window is noise even if it is a doubling, and +50% of an already
  // terrible baseline is not news.
  minAbsoluteDeltaMs: 40,
  minRelativeDelta: 0.4,
  // Guards the ratio when the baseline is near zero.
  relativeFloorMs: 25,
  // A local step is noisier than a day-over-day one, so corroboration is held
  // to a softer bar -- it only has to show the change happened *here*.
  corroborationFactor: 0.5,
};

const DAY = 86400;

/** Collapse the event and poll records of one restart into a single change. */
function dedupeChanges(changes) {
  const seen = new Set();
  const out = [];
  for (const c of changes) {
    if (c.change !== 'started') continue;
    const key = `${c.resource}:${Math.floor(c.wall_s / 60)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out.sort((a, b) => a.wall_s - b.wall_s);
}

/** Group restarts that happened close enough together to be indistinguishable. */
function cluster(changes, clusterS) {
  const clusters = [];
  for (const c of changes) {
    const last = clusters[clusters.length - 1];
    if (last && c.wall_s - last.at <= clusterS) {
      if (!last.resources.includes(c.resource)) last.resources.push(c.resource);
    } else {
      clusters.push({ at: c.wall_s, resources: [c.resource] });
    }
  }
  return clusters;
}

/**
 * Preferred comparison: the hours after the change against the same hours on
 * previous days.
 *
 * Population is the dominant confounder and it follows the clock -- a server is
 * busier at 21:00 than at 09:00 every single day. Comparing like hour against
 * like hour removes that almost entirely, where an adjacent before/after split
 * runs straight into it: when a change lands during the evening climb, the two
 * sides of it barely share a population range at all.
 */
function dayOverDay(store, serverId, at, opts, now) {
  const after = store.samplesBetween(serverId, at, at + opts.windowS);
  if (after.length < opts.minWeight) return null;

  const before = [];
  for (let d = 1; d <= opts.baselineDays; d++) {
    const start = at - d * DAY;
    before.push(...store.samplesBetween(serverId, start, start + opts.windowS));
  }
  if (before.length < opts.minWeight) return null;

  const comparison = stratifiedCompare(before, after);
  if (!comparison.comparable || comparison.weight < opts.minWeight) return null;
  return { comparison, method: 'day-over-day', windowS: opts.windowS };
}

/**
 * Local step across the change itself, at matched population.
 *
 * On its own this is the weaker signal, but it answers a question
 * day-over-day cannot: *when* the level actually shifted. An unfixed
 * regression poisons tomorrow's baseline, so every restart on the following
 * days looks guilty against yesterday -- while showing no step of its own.
 * Requiring both is what keeps the nightly restart cycle out of the results.
 */
function adjacent(store, serverId, at, opts, now) {
  let best = null;
  for (let mult = 1; mult <= opts.maxWindowMultiple; mult++) {
    const w = opts.windowS * mult;
    if (at + w > now) break;
    const before = store.samplesBetween(serverId, at - w, at);
    const after = store.samplesBetween(serverId, at, at + w);
    if (before.length < opts.minWeight || after.length < opts.minWeight) continue;

    const candidate = stratifiedCompare(before, after);
    if (!candidate.comparable) continue;
    if (!best || candidate.weight > best.comparison.weight) {
      best = { comparison: candidate, method: 'adjacent', windowS: w };
    }
    if (candidate.weight >= opts.targetWeight) break;
  }
  return best && best.comparison.weight >= opts.minWeight ? best : null;
}

// Confidence is about how much matched evidence stands behind the claim, not
// how large the slowdown is. A huge jump seen across one population bucket is
// weaker than a moderate one seen consistently across five.
function confidenceOf(comparison, relative, ambiguous) {
  if (ambiguous) return 'ambiguous';
  if (comparison.weight >= 80 && comparison.matchedBuckets.length >= 3 && relative >= 1.0) return 'high';
  if (comparison.weight >= 40 && comparison.matchedBuckets.length >= 2 && relative >= 0.6) return 'medium';
  return 'low';
}

/**
 * Examine every restart in the lookback window and return the ones followed by
 * a real, population-adjusted slowdown.
 */
export function detectRegressions(store, serverId, { now, lookbackS = 7 * DAY, options = {} } = {}) {
  const opts = { ...DEFAULTS, ...options };
  const changes = dedupeChanges(store.changesBetween(serverId, now - lookbackS, now));
  const clusters = cluster(changes, opts.clusterS);
  const findings = [];

  const measure = (picked) => {
    if (!picked) return null;
    const c = picked.comparison;
    const delta = c.afterStallPerWindow - c.beforeStallPerWindow;
    return { ...picked, delta, relative: delta / Math.max(c.beforeStallPerWindow, opts.relativeFloorMs) };
  };

  for (const group of clusters) {
    // Only judge a change once the window after it is fully observed,
    // otherwise a restart five minutes ago looks like an improvement.
    if (group.at + opts.windowS > now) continue;

    const seasonal = measure(dayOverDay(store, serverId, group.at, opts, now));
    const local = measure(adjacent(store, serverId, group.at, opts, now));

    const primary = seasonal ?? local;
    if (!primary) continue;
    if (primary.delta < opts.minAbsoluteDeltaMs || primary.relative < opts.minRelativeDelta) continue;

    let method = primary.method;
    let corroborated = true;
    if (seasonal && local) {
      corroborated = local.delta >= opts.minAbsoluteDeltaMs * opts.corroborationFactor
                  && local.relative >= opts.minRelativeDelta * opts.corroborationFactor;
      // Worse than yesterday but no step here means the damage was done
      // earlier and something else is already carrying the blame.
      if (!corroborated) continue;
      method = 'day-over-day+local';
    } else if (seasonal && !local) {
      method = 'day-over-day (uncorroborated)';
      corroborated = false;
    }

    const { comparison, windowS } = primary;
    const relative = primary.relative;
    const ambiguous = group.resources.length > 1;
    let confidence = confidenceOf(comparison, relative, ambiguous);
    // A claim nothing could second is never presented as certain.
    if (!corroborated && confidence === 'high') confidence = 'medium';

    for (const resource of group.resources) {
      findings.push({
        serverId,
        resource,
        changedS: group.at,
        detectedS: now,
        beforeHitchRate: comparison.beforeHitchPerWindow,
        afterHitchRate: comparison.afterHitchPerWindow,
        beforeP95: comparison.beforeP95,
        afterP95: comparison.afterP95,
        beforeStallRatio: comparison.beforeStallPerWindow,
        afterStallRatio: comparison.afterStallPerWindow,
        score: Number(relative.toFixed(4)),
        confidence,
        method,
        windowS,
        suspects: group.resources.slice(),
        matchedBuckets: comparison.matchedBuckets.length,
        weight: comparison.weight,
      });
    }
  }

  return findings.sort((a, b) => b.score - a.score);
}

/** Detect and persist, so alerting has something stable to deduplicate on. */
export function runRegressionAnalysis(store, serverId, opts = {}) {
  const findings = detectRegressions(store, serverId, opts);
  for (const f of findings) store.saveRegression(f);
  return findings;
}
