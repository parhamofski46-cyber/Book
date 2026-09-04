// The dashboard, rendered on the server.
//
// No build step and no third-party origin: the page is HTML, inline CSS, and
// one hash-pinned script for the hover layer. A self-hosted operations panel
// that pulls nothing from a CDN is one fewer thing for its owner to audit.

import { createHash } from 'node:crypto';
import { CSS, STATUS } from '../ui/theme.js';
import { esc, fmtMs, fmtPct, fmtAgo, fmtClock } from '../ui/html.js';
import { timelineChart, HOVER_SCRIPT } from '../ui/chart.js';
import { healthScore } from '../analysis/health.js';
import { fleetComparison } from '../analysis/fleet.js';
import { planFor } from '../config.js';

const SCRIPT_HASH = 'sha256-' + createHash('sha256').update(HOVER_SCRIPT).digest('base64');

export const CSP = [
  "default-src 'none'",
  "style-src 'unsafe-inline'",
  `script-src '${SCRIPT_HASH}'`,
  "img-src data:",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join('; ');

const RANGES = [
  { key: '6h', label: '6 hours', seconds: 6 * 3600 },
  { key: '24h', label: '24 hours', seconds: 86400 },
  { key: '7d', label: '7 days', seconds: 7 * 86400 },
  { key: '30d', label: '30 days', seconds: 30 * 86400 },
];

export const rangeFor = (key) => RANGES.find((r) => r.key === key) ?? RANGES[1];

function layout(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><style>${CSS}</style></head>
<body><div class="wrap">${body}</div><script>${HOVER_SCRIPT}</script></body></html>`;
}

function chip(grade) {
  const s = STATUS[grade] ?? STATUS.F;
  // One coloured mark, not two. The glyph differs per grade, so shape carries
  // the state as well as hue does -- which matters because two of these steps
  // sit under 3:1 on the light surface, and because colour alone is never
  // allowed to be the signal.
  return `<span class="chip"><span style="color:var(${s.var})">${s.icon}</span> ` +
         `${esc(grade)} &middot; ${esc(s.label)}</span>`;
}

const tile = (k, v, note = '') =>
  `<div class="card tile"><div class="k">${esc(k)}</div><div class="v">${v}</div>` +
  (note ? `<div class="n">${note}</div>` : '') + `</div>`;

const HOUR_S = 3600;

// A 24-hour range is ~5,760 raw windows; a 30-day one would be 172,800, and
// the JSON API would stringify every one of them. Past this, the series is
// served hourly instead -- which is what the reader was going to see anyway,
// since the chart buckets to a couple of hundred points.
const MAX_RAW_ROWS = 8000;

// Raw has to reach most of the way back before it can stand for the whole
// range on its own. The previous test was a row count, which every server past
// its first hour satisfied -- so a 30-day view silently showed 7 days and said
// nothing about it.
const RAW_COVERAGE = 0.9;

/** Fold raw windows into the same shape the stored hourly buckets have. */
function foldToHours(rows) {
  const buckets = new Map();
  for (const r of rows) {
    const hour = Math.floor(r.wall_s / HOUR_S) * HOUR_S;
    let b = buckets.get(hour);
    if (!b) {
      buckets.set(hour, (b = {
        hour_s: hour, windows: 0, probes: 0, players_max: 0,
        stall_ms: 0, stall_max: 0, hitches: 0, max_drift: 0, p95_max: 0,
      }));
    }
    b.windows += 1;
    b.probes += r.probes;
    b.players_max = Math.max(b.players_max, r.players);
    b.stall_ms += r.stall_ms;
    b.stall_max = Math.max(b.stall_max, r.stall_ms);
    b.hitches += r.hitches;
    b.max_drift = Math.max(b.max_drift, r.max_drift);
    b.p95_max = Math.max(b.p95_max, r.p95_drift);
  }
  return [...buckets.values()].sort((a, b) => a.hour_s - b.hour_s);
}

/**
 * An hourly bucket presented as a sample.
 *
 * stall_ms carries the worst window in the hour, not the hour's total: it has
 * to mean the same thing the raw series means, or the chart's own legend
 * becomes a lie the moment the resolution changes under it.
 */
const asSample = (h) => ({
  wall_s: h.hour_s,
  stall_ms: h.stall_max ?? 0,
  hitches: h.hitches,
  players: h.players_max,
  max_drift: h.max_drift,
  p95_drift: h.p95_max,
  probes: h.probes,
});

/**
 * Raw windows where they still exist and there are not too many of them,
 * hourly beyond that. When it falls back to hourly, the recent windows that
 * have not been rolled up yet are folded on the fly, so the series covers the
 * whole range at one resolution instead of stopping where the rollup did.
 */
export function seriesForRange(store, serverId, from, to) {
  const span = Math.max(1, to - from);
  const raw = store.samplesBetween(serverId, from, to);
  const reachesBack = raw.length > 0 && (to - raw[0].wall_s) / span >= RAW_COVERAGE;

  if (reachesBack && raw.length <= MAX_RAW_ROWS) {
    return { rows: raw, resolution: 'raw' };
  }

  const stored = store.hourlyBetween(serverId, from, to);
  const after = stored.length ? stored[stored.length - 1].hour_s + HOUR_S : from;
  const rows = [...stored, ...foldToHours(raw.filter((r) => r.wall_s >= after))].map(asSample);

  // Nothing rolled up and nothing recent enough to fold: whatever raw there is
  // beats an empty chart.
  if (!rows.length) return { rows: raw, resolution: 'raw' };
  return { rows, resolution: 'hourly' };
}

export function serverListPage(store, { now }) {
  const servers = store.listServers();
  const rows = servers.map((s) => {
    const recent = store.samplesBetween(s.id, now - 3600, now + 1);
    const health = healthScore(recent);
    const seen = s.last_seen_s ? fmtAgo(now - s.last_seen_s) : 'never';
    const stale = s.last_seen_s && now - s.last_seen_s > 900;
    return `<tr>
      <td><a href="/s/${s.id}">${esc(s.name)}</a></td>
      <td>${health.score === null ? '<span class="empty">no data</span>' : chip(health.grade)}</td>
      <td class="num">${health.score ?? '--'}</td>
      <td class="num">${health.score === null ? '--' : fmtPct(health.blockedPct)}</td>
      <td class="num">${recent.length ? recent[recent.length - 1].players : '--'}</td>
      <td>${esc(s.plan)}</td>
      <td>${stale ? `<span style="color:var(--serious)">▲ ${esc(seen)}</span>` : esc(seen)}</td>
    </tr>`;
  }).join('');

  return layout('Pulse', `
    <header class="top"><h1>Pulse</h1></header>
    <p class="sub">${servers.length} server${servers.length === 1 ? '' : 's'} reporting.</p>
    <div class="card scroll">
      ${servers.length ? `<table>
        <thead><tr><th>Server</th><th>Health</th><th class="num">Score</th>
          <th class="num">Blocked</th><th class="num">Players</th><th>Plan</th><th>Last seen</th></tr></thead>
        <tbody>${rows}</tbody></table>` : `<div class="empty">
          No servers registered yet. Create one with the admin API, then point a collector at this backend.</div>`}
    </div>`);
}

function regressionRows(store, serverId, now) {
  const found = store.listRegressions(serverId, now - 30 * 86400, 25);
  if (!found.length) {
    return `<div class="card empty">Nothing has been linked to a slowdown in the last 30 days.
      That is the expected state for a healthy server.</div>`;
  }
  const rows = found.map((r) => {
    const delta = r.after_stall_ratio - r.before_stall_ratio;
    return `<tr>
      <td><code>${esc(r.resource)}</code></td>
      <td>${esc(fmtClock(r.changed_s))}</td>
      <td class="num">${fmtMs(r.before_stall_ratio)}</td>
      <td class="num">${fmtMs(r.after_stall_ratio)}</td>
      <td class="num" style="color:var(--${delta > 0 ? 'critical' : 'good'})">
        ${delta > 0 ? '+' : ''}${fmtMs(delta)}</td>
      <td>${esc(r.confidence)}</td>
      <td class="num">${esc(r.method)}</td>
    </tr>`;
  }).join('');
  return `<div class="card scroll"><table>
    <thead><tr><th>Resource</th><th>Restarted</th><th class="num">Stall before</th>
      <th class="num">Stall after</th><th class="num">Change</th><th>Confidence</th>
      <th class="num">Compared</th></tr></thead>
    <tbody>${rows}</tbody></table>
    <figcaption>Stall time per window at comparable player counts. "Compared" says whether the
      baseline was the same hours on previous days or the window either side of the restart.</figcaption>
  </div>`;
}

/**
 * What a server sees before its collector has ever reported.
 *
 * The honest empty state -- "no telemetry in this range" -- is useless at the
 * exact moment the operator most needs help: they have just installed this and
 * something is not connected. So the empty state is the setup instructions,
 * with the endpoint already filled in.
 */
function waitingForCollector(server, publicUrl, canBundle) {
  const endpoint = `${publicUrl || 'http://your-backend:8787'}/v1/ingest`;
  // With the server's own token in hand the download comes pre-configured, so
  // the install is one line. Viewed with the admin token it cannot be, because
  // only a hash of the collector token is stored.
  const step2 = canBundle
    ? `<li>Add one line to <code>server.cfg</code>:
<pre style="margin:8px 0">ensure pulse_collector</pre>
        That is all &mdash; the endpoint and token are already inside the download.</li>`
    : `<li>Add this to <code>server.cfg</code>:
<pre style="margin:8px 0">ensure pulse_collector

set pulse_endpoint    "${esc(endpoint)}"
set pulse_token       "the token you were given"
set pulse_server_name "${esc(server.name)}"</pre></li>`;

  return `
    <div class="card">
      <h3 style="margin:0 0 6px;font-size:15px">Waiting for ${esc(server.name)} to report</h3>
      <p class="n" style="color:var(--ink-2);margin:0 0 14px">
        Nothing has arrived yet. This page fills in within a minute of the collector starting.</p>
      ${canBundle ? `<p style="margin:0 0 16px">
        <a class="dl-btn" href="/s/${server.id}/collector.zip">Download the configured collector</a>
        <span style="color:var(--muted);font-size:12px;margin-left:10px">
          contains this server's token &mdash; keep it private</span></p>` : ''}
      <ol style="margin:0;padding-left:20px;color:var(--ink-2);font-size:13.5px;line-height:1.9">
        <li>Unzip it into your resources folder${canBundle ? '' :
          ' as <code>pulse_collector</code>'}</li>
        ${step2}
        <li>Restart the server, then run <code>pulse test</code> in its console</li>
      </ol>
      <p class="n" style="color:var(--ink-2);margin:14px 0 0">
        <code>pulse test</code> says in one line whether the endpoint and token are right.${
        canBundle ? '' : ' Open this page with the server\'s own token to get a pre-configured download instead.'}
        Lost the token? Register the server again &mdash; only its hash is stored.</p>
    </div>`;
}

export function serverDetailPage(store, server, { now, rangeKey = '24h', publicUrl = '', canBundle = false }) {
  const range = rangeFor(rangeKey);
  const from = now - range.seconds;
  const { rows, resolution } = seriesForRange(store, server.id, from, now + 1);
  const changes = store.changesBetween(server.id, from, now + 1);
  const health = healthScore(store.samplesBetween(server.id, now - 3600, now + 1));
  const plan = planFor(server.plan);
  const agent = store.latestHealth(server.id);

  const flagged = new Set(store.listRegressions(server.id, from, 50).map((r) => r.resource));
  const fleet = plan.fleet ? fleetComparison(store, server.id, { now }) : { available: false, reason: 'not on this plan' };

  // Never reported at all: the page's job is to help finish the install.
  const neverSeen = !server.last_seen_s && rows.length === 0;

  const nav = RANGES.map((r) =>
    r.key === range.key
      ? `<b>${esc(r.label)}</b>`
      : `<a href="/s/${server.id}?range=${r.key}">${esc(r.label)}</a>`).join(' &middot; ');

  const peakPlayers = rows.reduce((m, s) => Math.max(m, s.players), 0);

  const tiles = [
    tile('Health (last hour)',
      health.score === null ? '--' : `${health.score}`,
      health.score === null ? 'no data' : chip(health.grade)),
    tile('Main thread blocked', health.score === null ? '--' : fmtPct(health.blockedPct),
      'share of wall time unavailable'),
    tile('p95 drift', health.score === null ? '--' : `${health.p95DriftMs}ms`, 'typical worst case'),
    tile('Hitches', health.score === null ? '--' : `${health.hitchesPerHour}`, 'per hour, over 100ms'),
    tile('Worst stall', health.score === null ? '--' : fmtMs(health.worstStallMs), 'single freeze'),
    tile('Peak players', `${peakPlayers || '--'}`, `in the last ${esc(range.label)}`),
  ].join('');

  const fleetCard = fleet.available
    ? `<div class="card"><div class="k" style="color:var(--muted);font-size:12px">Against comparable servers</div>
        <div class="v" style="font-size:22px;font-weight:640;margin-top:6px">
          Better than ${fleet.betterThanPct}% of ${esc(fleet.cohort)}</div>
        <div class="n" style="color:var(--ink-2);font-size:12px;margin-top:6px">
          ${fmtMs(fleet.yourStallPerWindowMs)} stall per window against a cohort median of
          ${fmtMs(fleet.cohortMedianMs)}, across ${fleet.cohortSize} servers.</div></div>`
    : `<div class="card empty">Fleet comparison unavailable: ${esc(fleet.reason ?? 'unknown')}.</div>`;

  const changeRows = changes.filter((c) => c.change === 'started').slice(-20).reverse()
    .map((c) => `<tr><td><code>${esc(c.resource)}</code></td><td>${esc(fmtClock(c.wall_s))}</td>
                 <td>${esc(c.source)}</td></tr>`).join('');

  const dataRows = rows.slice(-200).map((s) =>
    `<tr><td>${esc(fmtClock(s.wall_s))}</td><td class="num">${fmtMs(s.stall_ms)}</td>
     <td class="num">${fmtMs(s.max_drift)}</td><td class="num">${s.players}</td></tr>`).join('');

  return layout(`${server.name} - Pulse`, `
    <header class="top"><h1>${esc(server.name)}</h1>${health.score === null ? '' : chip(health.grade)}</header>
    <p class="sub">Plan <b>${esc(server.plan)}</b> &middot; ${plan.rawDays}d full detail, ${plan.hourlyDays}d hourly
      &middot; agent ${esc(server.agent_version ?? 'unknown')}
      &middot; last seen ${esc(server.last_seen_s ? fmtAgo(now - server.last_seen_s) : 'never')}</p>
    <p class="sub">Range: ${nav}${resolution === 'hourly' ? ' &middot; <b>hourly resolution</b> (raw windows aged out)' : ''}${
      canBundle ? ` &middot; <a href="/s/${server.id}/collector.zip">download collector</a>` : ''}</p>

    ${neverSeen ? waitingForCollector(server, publicUrl, canBundle) : `<div class="tiles">${tiles}</div>`}

    <h2>Timeline</h2>
    ${timelineChart({ samples: rows, changes, flagged, from, to: now })}

    <h2>What changed</h2>
    ${regressionRows(store, server.id, now)}

    <h2>Fleet</h2>
    ${fleetCard}

    <h2>Recent restarts</h2>
    <div class="card scroll">${changeRows
      ? `<table><thead><tr><th>Resource</th><th>Started</th><th>Seen via</th></tr></thead><tbody>${changeRows}</tbody></table>`
      : '<div class="empty">No resource restarts recorded in this range.</div>'}</div>

    <h2>Collector</h2>
    <div class="card">${agent
      ? `<div class="n">Version ${esc(agent.version ?? '?')} &middot; costing
          <b>${(agent.cpu_ratio * 100).toFixed(4)}%</b> of one core &middot;
          ${agent.buffered} samples queued &middot; ${agent.dropped} dropped
          ${agent.degraded ? ' &middot; <span style="color:var(--serious)">▲ throttled itself</span>' : ''}</div>`
      : '<div class="empty">The collector has not reported its own health yet.</div>'}</div>

    <details><summary>Show the underlying numbers (${rows.length} rows, last 200)</summary>
      <div class="card scroll" style="margin-top:8px"><table>
        <thead><tr><th>Time</th><th class="num">Stall</th><th class="num">Worst</th><th class="num">Players</th></tr></thead>
        <tbody>${dataRows}</tbody></table></div></details>`);
}
