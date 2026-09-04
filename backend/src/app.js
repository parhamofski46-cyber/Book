// Application wiring: routes, the post-ingest pipeline, and maintenance.

import { createServer } from 'node:http';
import { createRouter, sendJson, sendHtml, sendRedirect, bearer, cookie, readJson } from './http/router.js';
import { createIngestHandler } from './http/ingest.js';
import { serverListPage, serverDetailPage, seriesForRange, rangeFor, CSP } from './http/pages.js';
import { runRegressionAnalysis } from './analysis/regression.js';
import { healthScore } from './analysis/health.js';
import { fleetComparison } from './analysis/fleet.js';
import { evaluateAlerts } from './alerts/rules.js';
import { dispatchAlerts } from './alerts/discord.js';
import { bundleCollector } from './collector-bundle.js';
import { nowS, newToken } from './db/store.js';
import { planFor, PLANS } from './config.js';

// Analysis is comparatively expensive and its answer does not change between
// two batches thirty seconds apart.
const ANALYSIS_INTERVAL_S = 600;

export function createApp({ store, config, clock = nowS, fetchImpl = fetch, logger = console }) {
  const lastAnalysis = new Map();

  async function analyseServer(server, now) {
    const previous = lastAnalysis.get(server.id) ?? 0;
    if (now - previous < ANALYSIS_INTERVAL_S) return null;
    lastAnalysis.set(server.id, now);

    const findings = runRegressionAnalysis(store, server.id, { now });
    const plan = planFor(server.plan);
    if (!plan.alerts) return { findings, alerts: [] };

    const alerts = evaluateAlerts(store, store.getServer(server.id), { now });
    const delivered = await dispatchAlerts(store, store.getServer(server.id), alerts,
      { now, publicUrl: config.publicUrl, fetchImpl });
    return { findings, alerts: delivered };
  }

  const ingest = createIngestHandler({
    store, config, clock,
    onServerData: (server, now) => {
      analyseServer(server, now).catch((err) => logger.error('[pulse] analysis failed:', err.message));
    },
  });

  const requireAdmin = (req, res) => {
    // An unset admin token closes the endpoint rather than opening it.
    if (!config.adminToken) {
      sendJson(res, 503, { error: 'admin API disabled: set PULSE_ADMIN_TOKEN' });
      return false;
    }
    if (bearer(req) !== config.adminToken) {
      sendJson(res, 401, { error: 'unauthorised' });
      return false;
    }
    return true;
  };

  /**
   * Who is asking, and what may they see.
   *
   * Server ids are small integers, so an unauthenticated dashboard is an
   * invitation to read every customer's telemetry by counting upwards. A reader
   * presents either the admin token, which sees every server, or one server's
   * own collector token, which sees only that server.
   *
   * The token may arrive as a bearer header (API), a query parameter (the link
   * an operator is given once), or a cookie (every navigation after that).
   */
  const tokenFrom = (req) => bearer(req) || req.query?.get('token') || cookie(req, 'pulse_token');

  const readerFromToken = (token) => {
    if (!token) return null;
    if (config.adminToken && token === config.adminToken) return { admin: true, via: 'admin' };
    const server = store.findServerByToken(token);
    return server ? { admin: false, serverId: server.id, via: 'server' } : null;
  };

  const readerFor = (req) => {
    if (config.openDashboard) return { admin: true, via: 'open' };
    return readerFromToken(tokenFrom(req));
  };

  const mayRead = (reader, serverId) => Boolean(reader && (reader.admin || reader.serverId === serverId));

  const cookieAttrs = `Path=/; HttpOnly; SameSite=Lax${config.cookieSecure ? '; Secure' : ''}`;

  /**
   * Promote a token supplied in the URL to an HttpOnly cookie and send the
   * reader on to a clean address, so the secret stops appearing in history, in
   * referrers, and in whatever they paste into a support channel.
   *
   * Only a token that actually names a reader is remembered. An unvalidated
   * stash would let anyone who can get a link clicked pin an identity of their
   * choosing into the victim's browser for a month: the victim would see the
   * attacker's server instead of their own, be refused their real ones, and
   * have no way to clear a cookie their own scripts cannot touch. Since the
   * README teaches operators to share `?token=` links, that link is entirely
   * plausible, and SameSite=Lax does not stop a top-level navigation.
   */
  const stashToken = (req, res, pathname) => {
    if (!req.query?.has('token')) return false;
    const supplied = req.query.get('token');
    // An empty ?token= is how someone signs out of a shared browser.
    if (!supplied) {
      sendRedirect(res, pathname, `pulse_token=; ${cookieAttrs}; Max-Age=0`);
      return true;
    }
    if (!readerFromToken(supplied)) return false;
    sendRedirect(res, pathname,
      `pulse_token=${encodeURIComponent(supplied)}; ${cookieAttrs}; Max-Age=2592000`);
    return true;
  };

  const denied = (res) => sendHtml(res, 401,
    `<!doctype html><meta charset="utf-8"><title>Pulse</title>` +
    `<body style="font:14px system-ui;margin:40px;max-width:34em">` +
    `<h1 style="font-size:18px">Not authorised</h1>` +
    `<p>Append <code>?token=&lt;your token&gt;</code> once and it will be remembered, ` +
    `or send it as a bearer header. Use the admin token to see every server, ` +
    `or a server's own collector token to see just that one.</p>` +
    `<p style="color:#666">Self-hosting on a private network? Set ` +
    `<code>PULSE_OPEN_DASHBOARD=1</code> to drop this check.</p></body>`, CSP);

  const router = createRouter();

  router.get('/healthz', (req, res) => sendJson(res, 200, {
    ok: true, servers: store.listServers().length, time: clock(),
  }));

  router.post('/v1/ingest', ingest);

  router.post('/v1/admin/servers', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    let body;
    try { body = await readJson(req); }
    catch (err) { return sendJson(res, err.status ?? 400, { error: err.message }); }

    const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
    if (!name) return sendJson(res, 400, { error: 'name is required' });
    const plan = Object.hasOwn(PLANS, body.plan) ? body.plan : config.defaultPlan;
    const token = newToken();
    const created = store.createServer({
      name, plan, token,
      webhook: typeof body.discordWebhook === 'string' ? body.discordWebhook : null,
      createdS: clock(),
    });
    // The token is shown exactly once; only its hash is stored.
    return sendJson(res, 201, { id: created.id, name, plan, token });
  });

  router.get('/v1/servers/:id/summary', (req, res) => {
    const id = Number(req.params.id);
    const server = store.getServer(id);
    // Answering 404 for a missing server and 401 for someone else's would let
    // the id space be mapped from outside; both give the same reply.
    if (!server || !mayRead(readerFor(req), id)) return sendJson(res, 401, { error: 'unauthorised' });
    const now = clock();
    const plan = planFor(server.plan);
    return sendJson(res, 200, {
      server: { id: server.id, name: server.name, plan: server.plan, lastSeenS: server.last_seen_s },
      health: healthScore(store.samplesBetween(server.id, now - 3600, now + 1)),
      fleet: plan.fleet ? fleetComparison(store, server.id, { now }) : { available: false, reason: 'not on this plan' },
      regressions: store.listRegressions(server.id, now - 30 * 86400, 25),
      agent: store.latestHealth(server.id),
    });
  });

  router.get('/v1/servers/:id/series', (req, res) => {
    const id = Number(req.params.id);
    const server = store.getServer(id);
    if (!server || !mayRead(readerFor(req), id)) return sendJson(res, 401, { error: 'unauthorised' });
    const now = clock();
    const range = rangeFor(req.query?.get('range'));
    const { rows, resolution } = seriesForRange(store, server.id, now - range.seconds, now + 1);
    return sendJson(res, 200, { resolution, range: range.key, count: rows.length, rows });
  });

  router.get('/', (req, res) => {
    if (stashToken(req, res, '/')) return;
    const reader = readerFor(req);
    if (!reader) return denied(res);
    // A single-server reader has no use for a list of one.
    if (!reader.admin) return sendRedirect(res, `/s/${reader.serverId}`);
    return sendHtml(res, 200, serverListPage(store, { now: clock() }), CSP);
  });

  /**
   * The collector, packaged with this server's settings already in it.
   *
   * The token can only be baked in when the *collector token itself* is what
   * authenticated the request: the database keeps a hash, so the backend
   * genuinely cannot recover it otherwise. That is the right trade -- it means
   * a stolen admin token still does not yield anyone's collector tokens -- and
   * it costs nothing, because the download link add-server.js prints already
   * carries that token.
   */
  router.get('/s/:id/collector.zip', (req, res) => {
    const id = Number(req.params.id);
    const reader = readerFor(req);
    const server = store.getServer(id);
    if (!server || !mayRead(reader, id)) return denied(res);

    const token = reader.via === 'server' ? tokenFrom(req) : '';
    const endpoint = `${config.publicUrl || `http://127.0.0.1:${config.port}`}/v1/ingest`;

    let zip;
    try {
      zip = bundleCollector({ endpoint, token, serverName: server.name });
    } catch (err) {
      return sendJson(res, err.status ?? 500, { error: err.message });
    }

    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zip.length,
      'content-disposition': `attachment; filename="pulse_collector-${id}.zip"`,
      // It contains a token: never cached, never stored by a proxy.
      'cache-control': 'no-store, private',
      'x-content-type-options': 'nosniff',
    });
    res.end(zip);
  });

  router.get('/s/:id', (req, res) => {
    const id = Number(req.params.id);
    if (stashToken(req, res, `/s/${id}`)) return;
    const reader = readerFor(req);
    if (!reader) return denied(res);
    const server = store.getServer(id);
    // Same answer whether the server does not exist or is not theirs, so ids
    // cannot be enumerated by watching which ones give a different error.
    if (!server || !mayRead(reader, id)) return denied(res);
    return sendHtml(res, 200,
      serverDetailPage(store, server, {
        now: clock(),
        rangeKey: req.query?.get('range') ?? '24h',
        publicUrl: config.publicUrl,
        canBundle: reader.via === 'server',
      }), CSP);
  });

  async function handleRequest(req, res) {
    try {
      let url;
      try { url = new URL(req.url, 'http://localhost'); }
      catch { return sendJson(res, 400, { error: 'bad request' }); }

      // Matching is inside the guard too: it parses the path, so it can throw,
      // and an exception escaping an async handler ends the process in Node.
      const route = router.match(req.method, url.pathname);
      if (!route) return sendJson(res, 404, { error: 'not found' });
      req.params = route.params;
      req.query = url.searchParams;
      await route.handler(req, res);
    } catch (err) {
      logger.error('[pulse] request failed:', err.stack ?? err.message);
      if (!res.headersSent) sendJson(res, 500, { error: 'internal error' });
    }
  }

  return {
    router,
    handleRequest,
    analyseServer,
    listen(port = config.port, host = config.host) {
      const server = createServer(handleRequest);
      // Maintenance folds raw windows into hourly buckets and applies each
      // plan's retention. unref so it never keeps the process alive by itself.
      const timer = setInterval(() => {
        try { store.maintain(clock()); }
        catch (err) { logger.error('[pulse] maintenance failed:', err.message); }
      }, config.maintenanceIntervalMs);
      timer.unref();
      return new Promise((resolve) => server.listen(port, host, () => resolve(server)));
    },
  };
}
