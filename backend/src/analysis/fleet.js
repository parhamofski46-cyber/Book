// Fleet comparison.
//
// This is the one thing a competitor cannot obtain by copying the code: it
// comes from having many servers reporting, not from the implementation. Every
// free install makes it sharper, which is why giving the collector away is a
// strategy rather than a concession.
//
// Servers are compared within a population cohort. Telling a 40-player server
// it is slower than a 200-player one says nothing useful.

const COHORTS = [
  { key: 'small', label: 'under 50 players', min: 0, max: 50 },
  { key: 'medium', label: '50-119 players', min: 50, max: 120 },
  { key: 'large', label: '120-199 players', min: 120, max: 200 },
  { key: 'xlarge', label: '200+ players', min: 200, max: Infinity },
];

export function cohortFor(playersAvg) {
  return COHORTS.find((c) => playersAvg >= c.min && playersAvg < c.max) ?? COHORTS[0];
}

/**
 * Where this server sits among comparable servers. Returns null when the
 * cohort is too small to say anything honest -- with three servers reporting,
 * "you are in the top third" is noise dressed as insight.
 */
export function fleetComparison(store, serverId, { now, spanS = 7 * 86400, minWindows = 100, minCohort = 5 } = {}) {
  const rows = store.fleetRows(now - spanS, minWindows);
  const scored = rows.map((r) => ({
    serverId: r.server_id,
    playersAvg: r.players_avg,
    stallPerWindow: r.windows > 0 ? r.stall_ms / r.windows : 0,
  }));

  const self = scored.find((r) => r.serverId === serverId);
  if (!self) return { available: false, reason: 'not enough of your own data yet' };

  const cohort = cohortFor(self.playersAvg);
  const peers = scored.filter((r) => cohortFor(r.playersAvg).key === cohort.key);
  if (peers.length < minCohort) {
    return { available: false, reason: 'cohort too small to compare', cohort: cohort.label, cohortSize: peers.length };
  }

  const values = peers.map((p) => p.stallPerWindow).sort((a, b) => a - b);
  const worseThanYou = values.filter((v) => v > self.stallPerWindow).length;
  const percentile = Math.round((worseThanYou / values.length) * 100);
  const median = values[Math.floor(values.length / 2)];

  return {
    available: true,
    cohort: cohort.label,
    cohortSize: peers.length,
    // Share of comparable servers doing worse than this one.
    betterThanPct: percentile,
    yourStallPerWindowMs: Number(self.stallPerWindow.toFixed(1)),
    cohortMedianMs: Number(median.toFixed(1)),
    ratioToMedian: median > 0 ? Number((self.stallPerWindow / median).toFixed(2)) : null,
  };
}
