// Charts, drawn as SVG on the server.
//
// Two panels stacked on one shared time axis: stall time on top, population
// below. They are emphatically not one chart with two y-scales -- a dual axis
// lets the author put the crossing wherever the story needs it, and here the
// whole point is that population is the confounder the reader must be able to
// discount by eye.
//
// Stall buckets take the maximum, not the mean. A 900ms freeze inside a
// six-minute bucket is the event worth seeing; averaging it away leaves a flat
// line under a server nobody can play on.

import { esc } from './html.js';

const PAD_L = 46, PAD_R = 12, W = 960;
const TOP_H = 150, GAP = 22, BOT_H = 58, AXIS_H = 26;
const TOP_Y = 12, BOT_Y = TOP_Y + TOP_H + GAP;
const H = BOT_Y + BOT_H + AXIS_H;
const PLOT_W = W - PAD_L - PAD_R;

const niceMax = (v) => {
  if (!(v > 0)) return 10;
  const mag = 10 ** Math.floor(Math.log10(v));
  for (const step of [1, 1.5, 2, 3, 5, 7.5, 10]) {
    if (v <= step * mag) return step * mag;
  }
  return 10 * mag;
};

/** Fold raw windows into at most `count` buckets across the visible range. */
function bucket(samples, from, to, count) {
  const span = Math.max(1, to - from);
  const out = Array.from({ length: count }, () => null);
  for (const s of samples) {
    const i = Math.min(count - 1, Math.floor(((s.wall_s - from) / span) * count));
    if (i < 0) continue;
    const b = out[i] ?? (out[i] = { t: from + (span * (i + 0.5)) / count, stall: 0, players: 0, n: 0, worst: 0 });
    b.stall = Math.max(b.stall, s.stall_ms);
    b.worst = Math.max(b.worst, s.max_drift);
    b.players += s.players;
    b.n += 1;
  }
  for (const b of out) if (b) b.players = Math.round(b.players / b.n);
  return out;
}

const hhmm = (unixS) => new Date(unixS * 1000).toISOString().slice(11, 16);
const dayLabel = (unixS) => new Date(unixS * 1000).toISOString().slice(5, 10);

function pathFor(points, yOf, xOf, baseline) {
  let line = '', area = '';
  let open = false;
  for (const p of points) {
    if (!p) { open = false; continue; }
    const x = xOf(p.t).toFixed(1), y = yOf(p.v).toFixed(1);
    line += `${open ? 'L' : 'M'}${x} ${y}`;
    if (!open) area += `M${x} ${baseline.toFixed(1)}L${x} ${y}`;
    else area += `L${x} ${y}`;
    open = true;
  }
  // Close the area back down to the baseline under the final point.
  const last = [...points].reverse().find(Boolean);
  if (last) area += `L${xOf(last.t).toFixed(1)} ${baseline.toFixed(1)}Z`;
  return { line, area };
}

/**
 * @param {object[]} samples raw collector windows, ordered by wall_s
 * @param {object[]} changes resource restarts to mark on the axis
 * @param {Set<string>} flagged resource names a regression was attributed to
 */
export function timelineChart({ samples, changes = [], flagged = new Set(), from, to, buckets = 200 }) {
  if (!samples.length) {
    return `<div class="card empty">No telemetry in this range yet.</div>`;
  }

  const start = from ?? samples[0].wall_s;
  const end = to ?? samples[samples.length - 1].wall_s;
  const rows = bucket(samples, start, end, buckets);
  const present = rows.filter(Boolean);

  const stallMax = niceMax(Math.max(...present.map((b) => b.stall), 1));
  const playerMax = niceMax(Math.max(...present.map((b) => b.players), 1));

  const xOf = (t) => PAD_L + ((t - start) / Math.max(1, end - start)) * PLOT_W;
  const yStall = (v) => TOP_Y + TOP_H - (Math.min(v, stallMax) / stallMax) * TOP_H;
  const yPlayers = (v) => BOT_Y + BOT_H - (Math.min(v, playerMax) / playerMax) * BOT_H;

  const stall = pathFor(present.map((b) => ({ t: b.t, v: b.stall })), yStall, xOf, TOP_Y + TOP_H);
  const players = pathFor(present.map((b) => ({ t: b.t, v: b.players })), yPlayers, xOf, BOT_Y + BOT_H);

  // Gridlines stay recessive: hairlines behind the data, labelled only at the
  // values a reader needs to anchor the scale.
  let grid = '';
  for (const frac of [0, 0.5, 1]) {
    const y = TOP_Y + TOP_H - frac * TOP_H;
    grid += `<line x1="${PAD_L}" y1="${y}" x2="${W - PAD_R}" y2="${y}" stroke="var(--grid)" stroke-width="1"/>`;
    grid += `<text x="${PAD_L - 8}" y="${y + 4}" text-anchor="end" fill="var(--muted)" font-size="11">${Math.round(frac * stallMax)}</text>`;
  }
  grid += `<line x1="${PAD_L}" y1="${BOT_Y + BOT_H}" x2="${W - PAD_R}" y2="${BOT_Y + BOT_H}" stroke="var(--axis)" stroke-width="1"/>`;
  grid += `<text x="${PAD_L - 8}" y="${BOT_Y + 10}" text-anchor="end" fill="var(--muted)" font-size="11">${playerMax}</text>`;

  // Time ticks. Six is enough to orient without crowding the axis.
  let ticks = '';
  const spanH = (end - start) / 3600;
  for (let i = 0; i <= 6; i++) {
    const t = start + ((end - start) * i) / 6;
    const x = xOf(t);
    const label = spanH > 30 ? dayLabel(t) : hhmm(t);
    ticks += `<text x="${x.toFixed(1)}" y="${H - 8}" text-anchor="middle" fill="var(--muted)" font-size="11">${label}</text>`;
  }

  // Restart markers. An accused resource gets a solid coloured rule; routine
  // restarts stay hairlines so they give context without competing.
  let marks = '';
  const shown = changes.filter((c) => c.change === 'started').slice(0, 120);
  for (const c of shown) {
    if (c.wall_s < start || c.wall_s > end) continue;
    const x = xOf(c.wall_s).toFixed(1);
    const isFlagged = flagged.has(c.resource);
    marks += `<line x1="${x}" y1="${TOP_Y}" x2="${x}" y2="${BOT_Y + BOT_H}" ` +
      `stroke="${isFlagged ? 'var(--event)' : 'var(--axis)'}" stroke-width="${isFlagged ? 2 : 1}"` +
      `${isFlagged ? '' : ' stroke-dasharray="2 4"'} opacity="${isFlagged ? 1 : 0.8}">` +
      `<title>${esc(c.resource)} restarted at ${hhmm(c.wall_s)}</title></line>`;
  }

  const series = present.map((b) => ({ t: b.t, s: Math.round(b.stall), w: Math.round(b.worst), p: b.players }));

  return `
<figure class="card chartbox" data-series='${esc(JSON.stringify(series))}'
        data-geo='${esc(JSON.stringify({ padL: PAD_L, plotW: PLOT_W, w: W, h: H, top: TOP_Y, topH: TOP_H, botY: BOT_Y, botH: BOT_H }))}'>
  <div class="legend">
    <span><span class="sw" style="background:var(--series)"></span>Stall time per window (peak)</span>
    <span><span class="sw" style="background:var(--muted)"></span>Players</span>
    <span><span class="sw" style="background:var(--event)"></span>Restart linked to a regression</span>
  </div>
  <svg viewBox="0 0 ${W} ${H}" width="100%" height="${H}" role="img"
       aria-label="Stall time per window and player count over the selected range">
    ${grid}${marks}
    <path d="${players.area}" fill="var(--muted)" opacity="0.16"/>
    <path d="${players.line}" fill="none" stroke="var(--muted)" stroke-width="1.5"
          stroke-linejoin="round" stroke-linecap="round"/>
    <path d="${stall.area}" fill="var(--series-soft)"/>
    <path d="${stall.line}" fill="none" stroke="var(--series)" stroke-width="2"
          stroke-linejoin="round" stroke-linecap="round"/>
    <line class="cursor" x1="0" y1="${TOP_Y}" x2="0" y2="${BOT_Y + BOT_H}"
          stroke="var(--axis)" stroke-width="1" opacity="0"/>
    <circle class="dot" r="4" fill="var(--series)" stroke="var(--surface)" stroke-width="2" opacity="0"/>
    ${ticks}
  </svg>
  <div class="tip"></div>
  <figcaption>Peak stall time per 15s window, milliseconds. Population is shown separately below
    rather than on a second axis, so a busy evening is not mistaken for a fault.</figcaption>
</figure>`;
}

// Hover layer. Pinned by hash in the CSP rather than allowed wholesale, so the
// dashboard still refuses every script but this one.
export const HOVER_SCRIPT = `
for (const box of document.querySelectorAll('.chartbox')) {
  const svg = box.querySelector('svg');
  const tip = box.querySelector('.tip');
  const cursor = svg.querySelector('.cursor');
  const dot = svg.querySelector('.dot');
  const data = JSON.parse(box.dataset.series);
  const geo = JSON.parse(box.dataset.geo);
  if (!data.length) continue;
  const fmt = (ms) => ms >= 1000 ? (ms / 1000).toFixed(1) + 's' : Math.round(ms) + 'ms';
  const move = (ev) => {
    const rect = svg.getBoundingClientRect();
    const scale = geo.w / rect.width;
    const vx = (ev.clientX - rect.left) * scale;
    const frac = (vx - geo.padL) / geo.plotW;
    if (frac < 0 || frac > 1) return hide();
    const i = Math.max(0, Math.min(data.length - 1, Math.round(frac * (data.length - 1))));
    const d = data[i];
    const x = geo.padL + (i / Math.max(1, data.length - 1)) * geo.plotW;
    cursor.setAttribute('x1', x); cursor.setAttribute('x2', x); cursor.setAttribute('opacity', '1');
    const maxS = Math.max.apply(null, data.map(p => p.s)) || 1;
    const y = geo.top + geo.topH - (Math.min(d.s, maxS) / maxS) * geo.topH;
    dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('opacity', '1');
    const when = new Date(d.t * 1000).toISOString().slice(5, 16).replace('T', ' ');
    tip.innerHTML = '<b>' + when + 'Z</b><br>stall ' + fmt(d.s) + ' &middot; worst ' + fmt(d.w) +
                    '<br>' + d.p + ' players';
    tip.style.opacity = '1';
    const px = (x / scale) + rect.left - box.getBoundingClientRect().left;
    tip.style.left = Math.max(4, Math.min(px + 12, box.clientWidth - tip.offsetWidth - 4)) + 'px';
    tip.style.top = '34px';
  };
  const hide = () => {
    tip.style.opacity = '0';
    cursor.setAttribute('opacity', '0');
    dot.setAttribute('opacity', '0');
  };
  svg.addEventListener('pointermove', move);
  svg.addEventListener('pointerleave', hide);
}
`;
