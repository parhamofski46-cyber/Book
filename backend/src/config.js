// Configuration, entirely from the environment so the same image runs as a
// hosted service and as somebody's self-hosted container.

/**
 * Plan limits. Retention is the product: a free tier that keeps a week is
 * genuinely useful for "what happened last night", and useless for "we got
 * slower after last month's update" -- which is the question worth paying for.
 *
 * Raw windows are dense (one per 15s). Older data is folded into hourly
 * buckets, which stay far longer because they cost almost nothing.
 */
export const PLANS = {
  free: { rawDays: 7,  hourlyDays: 30,  maxServers: 1,  alerts: false, fleet: false },
  pro:  { rawDays: 30, hourlyDays: 400, maxServers: 3,  alerts: true,  fleet: true  },
  team: { rawDays: 90, hourlyDays: 400, maxServers: 25, alerts: true,  fleet: true  },
};

const num = (key, fallback) => {
  const v = process.env[key];
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export function loadConfig(env = process.env) {
  const publicUrl = (env.PULSE_PUBLIC_URL || '').replace(/\/$/, '');
  return {
    port: num('PULSE_PORT', 8787),
    host: env.PULSE_HOST || '0.0.0.0',
    dbPath: env.PULSE_DB || './data/pulse.db',
    // Guards the provisioning endpoints. Without one set, they are refused
    // outright rather than left open.
    adminToken: env.PULSE_ADMIN_TOKEN || '',
    // Plan assigned to servers created without one. Self-hosters run
    // everything on 'team'; the hosted service overrides per customer.
    defaultPlan: env.PULSE_DEFAULT_PLAN || 'team',
    // A single collector should never send more than a couple of batches a
    // minute. This is protection against a broken agent, not a business limit.
    ingestPerMinute: num('PULSE_INGEST_RATE', 60),
    // Reject samples claiming a wall clock this far from ours; a server with a
    // badly wrong clock would otherwise corrupt every timeline it touches.
    maxClockSkewSeconds: num('PULSE_MAX_SKEW', 86400),
    maintenanceIntervalMs: num('PULSE_MAINTENANCE_MS', 15 * 60 * 1000),
    // Absolute URL used in Discord links, when the backend knows its own name.
    publicUrl,
    // Set automatically when the service knows it is served over https; a
    // self-hoster on plain http would be locked out by a Secure cookie.
    cookieSecure: env.PULSE_COOKIE_SECURE === '1' || publicUrl.startsWith('https://'),
    // Opens the dashboard to anyone who can reach the port. Only sane behind a
    // private network or a reverse proxy that authenticates in front of it.
    openDashboard: env.PULSE_OPEN_DASHBOARD === '1',
  };
}

export function planFor(name) {
  return PLANS[name] || PLANS.free;
}
