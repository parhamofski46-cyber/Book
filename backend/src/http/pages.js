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
  // Icon and label always accompany the colour: status is never carried by
  // hue alone, and two of these steps are sub-3:1 on the light surface.
  return `<span class="chip"><span class="dot" style="background:var(${s.var})"></span>` +
         `${s.icon} ${esc(grade)} &middot; ${esc(s.label)}</span>`;
}

const tile = (k, v, note = '') =>
  `<div class="card tile"><div class="k">${esc(k)}</div><div class="v">${v}</div>` +
  (note ? `<div class="n">${note}</div>` : '') + `</div>`;

/**
 * Raw windows where they still exist, hourly rollups beyond that. The switch is
 * what a longer retention plan actually buys, so it is stated on the page
 * rather than hidden.
 */
export function seriesForRange(store, serverId, from, to) {
  const raw = store.samplesBetween(serverId, from, to);
  const expected = (to - from) / 15;
  if (raw.length >= Math.min(expected * 0.4, 200) || raw.length > 0 && to - from <= 2 * 86400) {
    return { rows: raw, resolution: 'raw' };
  }
  const hourly = store.hourlyBetween(serverId, from, to).map((h) => ({
    wall_s: h.hour_s,
    stall_ms: h.stall_ms,
    hitches: h.hitches,
    players: h.players_max,
    max_drift: h.max_drift,
    p95_drift: h.p95_max,
    probes: h.probes,
  }));
  return { rows: hourly.length ? hourly : raw, resolution: hourly.length ? 'hourly' : 'raw' };
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

export function serverDetailPage(store, server, { now, rangeKey = '24h' }) {
  const range = rangeFor(rangeKey);
  const from = now - range.seconds;
  const { rows, resolution } = seriesForRange(store, server.id, from, now + 1);
  const changes = store.changesBetween(server.id, from, now + 1);
  const health = healthScore(store.samplesBetween(server.id, now - 3600, now + 1));
  const plan = planFor(server.plan);
  const agent = store.latestHealth(server.id);

  const flagged = new Set(store.listRegressions(server.id, from, 50).map((r) => r.resource));
  const fleet = plan.fleet ? fleetComparison(store, server.id, { now }) : { available: false, reason: 'not on this plan' };

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
    <p class="sub">Range: ${nav}${resolution === 'hourly' ? ' &middot; <b>hourly resolution</b> (raw windows aged out)' : ''}</p>

    <div class="tiles">${tiles}</div>

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
