// Alert rules.
//
// The bar for firing is high on purpose. An operator who is pinged about
// nothing mutes the channel, and a muted channel is worse than no alerting at
// all -- it converts a real outage into one nobody sees.
//
// Every rule therefore carries a dedupe key and a cooldown: the same condition
// says its piece once, not every fifteen seconds until someone fixes it.

import { healthScore } from '../analysis/health.js';

export const RULES = {
  regression: { cooldownS: 6 * 3600, minScore: 0.6 },
  // A server that is briefly bad during a firefight is not an incident;
  // sustained is what matters.
  unhealthy: { cooldownS: 3 * 3600, threshold: 55, minSamples: 40 },
  silent: { cooldownS: 6 * 3600, afterS: 15 * 60 },
  agentTrouble: { cooldownS: 12 * 3600 },
};

const fresh = (store, serverId, kind, key, now, cooldownS) => {
  const last = store.lastAlert(serverId, kind, key);
  return !last || now - last.fired_s >= cooldownS;
};

/**
 * Decide what, if anything, is worth telling this server's operator right now.
 * Pure with respect to delivery: it reads state and returns intents.
 */
export function evaluateAlerts(store, server, { now, rules = RULES } = {}) {
  const out = [];

  // The agent has stopped reporting. Either the server is down or the
  // collector is, and the operator wants to know which.
  const lastSeen = server.last_seen_s ?? 0;
  if (lastSeen > 0 && now - lastSeen >= rules.silent.afterS) {
    const key = `since:${Math.floor(lastSeen / 3600)}`;
    if (fresh(store, server.id, 'silent', key, now, rules.silent.cooldownS)) {
      out.push({
        kind: 'silent',
        key,
        severity: 'warning',
        title: 'Collector has gone quiet',
        detail: `No telemetry for ${Math.round((now - lastSeen) / 60)} minutes.`,
      });
    }
    // Nothing else can be judged without data.
    return out;
  }

  const recent = store.samplesBetween(server.id, now - 3600, now + 1);

  if (recent.length >= rules.unhealthy.minSamples) {
    const health = healthScore(recent);
    if (health.score !== null && health.score < rules.unhealthy.threshold) {
      // Keyed by grade so a slide from C to F speaks again, while a server
      // sitting steadily at C does not.
      const key = `grade:${health.grade}`;
      if (fresh(store, server.id, 'unhealthy', key, now, rules.unhealthy.cooldownS)) {
        out.push({
          kind: 'unhealthy',
          key,
          severity: health.score < 35 ? 'critical' : 'warning',
          title: `Server health ${health.score}/100 (${health.grade})`,
          detail: `Main thread blocked ${health.blockedPct}% of the last hour, ` +
                  `p95 drift ${health.p95DriftMs}ms, ${health.hitchesPerHour} hitches/hour.`,
          health,
        });
      }
    }
  }

  for (const r of store.unnotifiedRegressions(server.id, rules.regression.minScore)) {
    if (r.confidence === 'low') continue;
    const key = `${r.resource}@${r.changed_s}`;
    if (!fresh(store, server.id, 'regression', key, now, rules.regression.cooldownS)) continue;
    out.push({
      kind: 'regression',
      key,
      regressionId: r.id,
      severity: r.confidence === 'high' ? 'critical' : 'warning',
      title: `${r.resource} looks responsible for a slowdown`,
      detail: `Since it restarted, stall time per window went ` +
              `${r.before_stall_ratio.toFixed(0)}ms to ${r.after_stall_ratio.toFixed(0)}ms ` +
              `at comparable player counts (${r.confidence} confidence, ${r.method}).`,
      changedS: r.changed_s,
    });
  }

  // The collector policing itself is a signal too: if it had to throttle, its
  // numbers are coarser than usual and the operator should know why.
  const health = store.latestHealth(server.id);
  if (health && (health.degraded || health.dropped > 0)) {
    const key = `agent:${health.version}:${health.degraded ? 'degraded' : 'dropping'}`;
    if (fresh(store, server.id, 'agentTrouble', key, now, rules.agentTrouble.cooldownS)) {
      out.push({
        kind: 'agentTrouble',
        key,
        severity: 'info',
        title: 'Collector is not running cleanly',
        detail: health.degraded
          ? 'It exceeded its CPU budget and halved its own sampling rate.'
          : `It has dropped ${health.dropped} samples, most likely because this backend was unreachable.`,
      });
    }
  }

  return out;
}
