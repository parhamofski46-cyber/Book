/* ===========================================================================
   Front end for the arbitrage paper-trading lab.
   No frameworks, no network beyond this app's own localhost API.
   =========================================================================== */
'use strict';

const TOKEN = document.body.dataset.token;
const POLL_MS = 1000;

/* --------------------------------------------------------------- API layer */

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: { 'X-Auth-Token': TOKEN, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const get = (p) => api(p);
const post = (p, body) => api(p, { method: 'POST', body: JSON.stringify(body || {}) });

/* -------------------------------------------------------------- formatting */

const state = { unit: 'auto', status: null, report: null, pollTimer: null, charts: {} };

/** Nobitex quotes IRT markets in rial; people count in toman. */
function divisor() { return state.unit === 'toman' ? 1 : 10; }

function toman(rial, digits = 0) {
  if (rial === null || rial === undefined || !isFinite(rial)) return '—';
  return (rial / divisor()).toLocaleString('en-US', {
    minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}
function signedToman(rial) {
  if (rial === null || !isFinite(rial)) return '—';
  const s = toman(Math.abs(rial));
  return (rial > 0 ? '+' : rial < 0 ? '−' : '') + s;
}
/** Avoids printing "−0.00": a rounded-away sign reads as a real one. */
function signedFixed(v, digits) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  const r = Number(v.toFixed(digits));
  if (r === 0) return (0).toFixed(digits);
  return (r > 0 ? '+' : '−') + Math.abs(r).toFixed(digits);
}

function bps(v, digits = 1) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits);
}
function pct(v, digits = 3) {
  if (v === null || !isFinite(v)) return '—';
  return (v >= 0 ? '+' : '−') + Math.abs(v).toFixed(digits) + '٪';
}
function num(v, digits = 0) {
  if (v === null || v === undefined || !isFinite(v)) return '—';
  return v.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
}
/** Axis labels must fit the gutter; the tooltip carries the exact figure. */
function compact(v, decimals) {
  const a = Math.abs(v);
  const d = (fallback) => (decimals === undefined ? fallback : decimals);
  if (a >= 1e9) return (v / 1e9).toFixed(d(a >= 1e10 ? 0 : 1)) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(d(a >= 1e7 ? 0 : 1)) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(d(a >= 1e4 ? 0 : 1)) + 'K';
  return v.toFixed(d(a < 10 && a > 0 ? 1 : 0));
}

/**
 * Build a compact formatter that keeps every tick on this axis distinct.
 * A narrow range around 10.7M would otherwise print "11M" twice.
 */
function compactAxis(values, scale = 1) {
  for (let decimals = 0; decimals <= 2; decimals++) {
    const labels = values.map((v) => compact(v / scale, decimals));
    if (new Set(labels).size === labels.length) {
      return (v) => compact(v / scale, decimals);
    }
  }
  return (v) => compact(v / scale, 2);
}

function compactToman(rial) { return compact(rial / divisor()); }

function clockTime(ts) {
  return new Date(ts * 1000).toLocaleTimeString('en-GB', { hour12: false });
}
function dateTime(ts) {
  return new Date(ts * 1000).toLocaleString('en-GB', { hour12: false }).replace(',', '');
}
function duration(seconds) {
  if (!isFinite(seconds) || seconds < 0) return '—';
  const h = Math.floor(seconds / 3600), m = Math.floor((seconds % 3600) / 60), s = Math.floor(seconds % 60);
  return h > 0 ? `${h} ساعت و ${m} دقیقه` : m > 0 ? `${m} دقیقه و ${s} ثانیه` : `${s} ثانیه`;
}
const esc = (s) => String(s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ------------------------------------------------------------------ charts */

const SVG_NS = 'http://www.w3.org/2000/svg';
const el = (name, attrs = {}) => {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
};
const cssVar = (name) => getComputedStyle(document.body).getPropertyValue(name).trim();

/** Pick ~4 round tick values covering [lo, hi]. */
function ticks(lo, hi, count = 4) {
  if (!isFinite(lo) || !isFinite(hi)) return [0];
  if (hi === lo) return [lo];
  const raw = (hi - lo) / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) || mag * 10;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + step * 1e-9; v += step) out.push(v);
  return out.length ? out : [lo, hi];
}

/**
 * Time-series line chart. One series, so no legend -- the card title names it.
 * Recessive grid, 2px round-capped line, crosshair + tooltip on hover.
 */
function lineChart(host, points, opts = {}) {
  const { format = (v) => v.toFixed(1), zeroLine = false, threshold = null, label = '' } = opts;
  const tipFormat = opts.tipFormat || format;
  host.textContent = '';
  const clean = points.filter((p) => p.v !== null && p.v !== undefined && isFinite(p.v));
  if (clean.length < 2) { host.dataset.state = 'empty'; return; }
  delete host.dataset.state;

  const W = Math.max(320, host.clientWidth || 560);
  const H = 200;
  // Time always runs left -> right, RTL page or not: a financial time series
  // read the other way looks like it is falling when it is rising. Only the
  // value labels follow the page direction, sitting on the right.
  const padT = 12, padB = 24, padL = 12, padR = 52;

  let lo = Math.min(...clean.map((p) => p.v));
  let hi = Math.max(...clean.map((p) => p.v));
  if (zeroLine) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
  if (threshold !== null) hi = Math.max(hi, threshold);
  if (hi === lo) { hi += 1; lo -= 1; }
  const span = hi - lo;
  lo -= span * 0.12; hi += span * 0.12;

  const t0 = points[0].t, t1 = points[points.length - 1].t;
  const spanT = Math.max(1e-6, t1 - t0);
  const x = (t) => padL + (W - padL - padR) * ((t - t0) / spanT);
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

  const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': label });

  const tickValues = ticks(lo, hi);
  const axisFormat = opts.axisFormat ? opts.axisFormat(tickValues) : format;

  for (const tv of tickValues) {
    const yy = y(tv);
    if (yy < padT - 1 || yy > H - padB + 1) continue;
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR, y1: yy, y2: yy,
      stroke: cssVar('--grid'), 'stroke-width': 1,
    }));
    const t = el('text', {
      x: W - padR + 8, y: yy + 3.5, 'text-anchor': 'start', direction: 'ltr',
      fill: cssVar('--muted'), 'font-size': 10.5, 'font-variant-numeric': 'tabular-nums',
    });
    t.textContent = axisFormat(tv);
    svg.appendChild(t);
  }

  if (zeroLine && lo < 0 && hi > 0) {
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR, y1: y(0), y2: y(0),
      stroke: cssVar('--axis'), 'stroke-width': 1.5,
    }));
  }
  if (threshold !== null && threshold > lo && threshold < hi) {
    svg.appendChild(el('line', {
      x1: padL, x2: W - padR, y1: y(threshold), y2: y(threshold),
      stroke: cssVar('--muted'), 'stroke-width': 1.5, 'stroke-dasharray': '4 4', opacity: .8,
    }));
  }

  // Break the path wherever the engine had no readable book, rather than
  // drawing a straight line across a gap that never happened.
  let d = '', pen = false;
  for (const p of points) {
    if (p.v === null || p.v === undefined || !isFinite(p.v)) { pen = false; continue; }
    d += `${pen ? 'L' : 'M'}${x(p.t).toFixed(2)},${y(p.v).toFixed(2)}`;
    pen = true;
  }
  svg.appendChild(el('path', {
    d, fill: 'none', stroke: cssVar('--series-1'), 'stroke-width': 2,
    'stroke-linejoin': 'round', 'stroke-linecap': 'round',
  }));

  const last = clean[clean.length - 1];
  svg.appendChild(el('circle', {
    cx: x(points[points.length - 1].t), cy: y(last.v), r: 3.5,
    fill: cssVar('--series-1'), stroke: cssVar('--surface'), 'stroke-width': 2,
  }));

  for (const tt of [t0, t1]) {
    const t = el('text', {
      x: x(tt), y: H - 7, 'text-anchor': tt === t0 ? 'start' : 'end', direction: 'ltr',
      fill: cssVar('--muted'), 'font-size': 10.5,
    });
    t.textContent = clockTime(tt);
    svg.appendChild(t);
  }

  const crosshair = el('line', {
    y1: padT, y2: H - padB, stroke: cssVar('--axis'), 'stroke-width': 1, opacity: 0,
  });
  const marker = el('circle', {
    r: 4, fill: cssVar('--series-1'), stroke: cssVar('--surface'), 'stroke-width': 2, opacity: 0,
  });
  svg.appendChild(crosshair); svg.appendChild(marker);

  const tip = document.getElementById('tooltip');
  svg.addEventListener('mousemove', (ev) => {
    const box = svg.getBoundingClientRect();
    const px = ev.clientX - box.left;
    let best = null, bestD = Infinity;
    for (const p of clean) {
      const dx = Math.abs(x(p.t) - px);
      if (dx < bestD) { bestD = dx; best = p; }
    }
    if (!best) return;
    crosshair.setAttribute('x1', x(best.t)); crosshair.setAttribute('x2', x(best.t));
    crosshair.setAttribute('opacity', .9);
    marker.setAttribute('cx', x(best.t)); marker.setAttribute('cy', y(best.v));
    marker.setAttribute('opacity', 1);
    tip.hidden = false;
    tip.innerHTML = `<b>${esc(tipFormat(best.v))}</b> &nbsp;<span class="muted">${clockTime(best.t)}</span>`;
    tip.style.left = `${Math.min(window.innerWidth - tip.offsetWidth - 12, ev.clientX + 14)}px`;
    tip.style.top = `${ev.clientY - tip.offsetHeight - 12}px`;
  });
  svg.addEventListener('mouseleave', () => {
    crosshair.setAttribute('opacity', 0);
    marker.setAttribute('opacity', 0);
    document.getElementById('tooltip').hidden = true;
  });

  host.appendChild(svg);
}

/** Vertical bars anchored to the baseline, 4px rounded tops, 2px surface gap. */
function barChart(host, bars, opts = {}) {
  const { format = (v) => num(v), highlight = -1, label = '' } = opts;
  const tipFormat = opts.tipFormat || format;
  host.textContent = '';
  if (!bars.length) { host.dataset.state = 'empty'; return; }
  delete host.dataset.state;

  const W = Math.max(320, host.clientWidth || 560);
  const H = 220;
  const padT = 14, padB = 42, padL = 12, padR = 52;
  const values = bars.map((b) => b.v);
  let lo = Math.min(0, ...values), hi = Math.max(0, ...values);
  if (hi === lo) hi = lo + 1;
  const pad = (hi - lo) * 0.12; hi += pad; lo -= pad;
  const y = (v) => padT + (H - padT - padB) * (1 - (v - lo) / (hi - lo));

  const svg = el('svg', { width: W, height: H, role: 'img', 'aria-label': label });
  const tickValues = ticks(lo, hi);
  const axisFormat = opts.axisFormat ? opts.axisFormat(tickValues) : format;
  for (const tv of tickValues) {
    const yy = y(tv);
    if (yy < padT - 1 || yy > H - padB + 1) continue;
    svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: yy, y2: yy,
      stroke: cssVar('--grid'), 'stroke-width': 1 }));
    const t = el('text', { x: W - padR + 8, y: yy + 3.5, 'text-anchor': 'start',
      direction: 'ltr', fill: cssVar('--muted'), 'font-size': 10.5 });
    t.textContent = axisFormat(tv);
    svg.appendChild(t);
  }

  const zeroY = y(0);
  svg.appendChild(el('line', { x1: padL, x2: W - padR, y1: zeroY, y2: zeroY,
    stroke: cssVar('--axis'), 'stroke-width': 1.5 }));

  const inner = W - padL - padR;
  const slot = inner / bars.length;
  const bw = Math.max(6, slot - 2);   // 2px surface gap between adjacent bars
  const r = 4;

  bars.forEach((b, i) => {
    const cx = padL + (i + 0.5) * slot;   // an ordered fee scale, so it ascends rightward
    const x0 = cx - bw / 2;
    const yv = y(b.v);
    const up = b.v >= 0;
    const top = up ? yv : zeroY;
    const h = Math.max(1.5, Math.abs(zeroY - yv));
    const rr = Math.min(r, h, bw / 2);
    // rounded data-end, square where it meets the baseline
    const d = up
      ? `M${x0},${top + h} L${x0},${top + rr} Q${x0},${top} ${x0 + rr},${top}
         L${x0 + bw - rr},${top} Q${x0 + bw},${top} ${x0 + bw},${top + rr} L${x0 + bw},${top + h} Z`
      : `M${x0},${top} L${x0},${top + h - rr} Q${x0},${top + h} ${x0 + rr},${top + h}
         L${x0 + bw - rr},${top + h} Q${x0 + bw},${top + h} ${x0 + bw},${top + h - rr} L${x0 + bw},${top} Z`;
    const path = el('path', {
      d, fill: i === highlight ? cssVar('--series-1') : cssVar('--series-1'),
      opacity: highlight >= 0 && i !== highlight ? .42 : 1,
    });
    svg.appendChild(path);

    const lbl = el('text', { x: cx, y: H - 24, 'text-anchor': 'middle', direction: 'ltr',
      fill: i === highlight ? cssVar('--ink') : cssVar('--muted'),
      'font-size': 10.5, 'font-weight': i === highlight ? 600 : 400 });
    lbl.textContent = b.label;
    svg.appendChild(lbl);

    if (i === highlight) {
      const tag = el('text', { x: cx, y: H - 9, 'text-anchor': 'middle',
        fill: cssVar('--series-1'), 'font-size': 10, 'font-weight': 600 });
      tag.textContent = 'کارمزد شما';
      svg.appendChild(tag);
    }

    const tip = document.getElementById('tooltip');
    path.addEventListener('mouseenter', (ev) => {
      tip.hidden = false;
      tip.innerHTML = `<b>${esc(tipFormat(b.v))}</b> &nbsp;<span class="muted">${esc(b.label)}</span>`;
      tip.style.left = `${Math.min(window.innerWidth - 160, ev.clientX + 14)}px`;
      tip.style.top = `${ev.clientY - 42}px`;
    });
    path.addEventListener('mouseleave', () => { document.getElementById('tooltip').hidden = true; });
  });

  host.appendChild(svg);
}

/* ---------------------------------------------------------------- feed row */

const EVENT_ICONS = {
  fill:   '<path d="M4 12.5 9.5 18 20 6.5"/>',
  loss:   '<path d="M6 6l12 12M18 6 6 18"/>',
  signal: '<circle cx="12" cy="12" r="3.4"/><path d="M4.5 12a7.5 7.5 0 0 1 15 0"/>',
  vanish: '<path d="M3 12h4l3-7 4 14 3-7h4"/>',
  skip:   '<path d="M5 12h14"/>',
  error:  '<path d="M12 7v6"/><circle cx="12" cy="16.5" r=".9" fill="currentColor"/><circle cx="12" cy="12" r="9"/>',
  run:    '<circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/>',
};
const EVENT_TAGS = {
  fill: 'اجرا', loss: 'ضرر', signal: 'سیگنال', vanish: 'پرید',
  skip: 'رد شد', error: 'خطا', run: 'وضعیت',
};

function renderFeed(events) {
  const host = document.getElementById('feed');
  if (!events.length) { host.innerHTML = '<li class="empty">هنوز رویدادی ثبت نشده</li>'; return; }
  host.innerHTML = events.slice(0, 12).map((e) => {
    // A fill that lost money is its own kind, so the icon and the word -- not
    // just the colour -- tell a red/green-blind reader what happened.
    const kind = e.kind === 'fill' && e.pnl < 0 ? 'loss' : e.kind;
    const icon = EVENT_ICONS[kind] || EVENT_ICONS.run;
    const tag = EVENT_TAGS[kind] || 'رویداد';
    const extra = e.kind === 'fill'
      ? ` <span class="num">(${signedToman(e.pnl)} تومان)</span>` : '';
    return `<li class="ev-${kind}">
      <svg class="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor"
           stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      <span class="ev-body">
        <span class="ev-msg"><span class="ev-tag">${tag}</span> · ${esc(e.message)}${extra}</span>
        <span class="ev-time">${clockTime(e.ts)}</span>
      </span></li>`;
  }).join('');
}

/* --------------------------------------------------------------- dashboard */

function renderStatus(s) {
  state.status = s;
  state.unit = s.irt_unit || 'auto';

  const live = !!s.running;
  const pill = document.getElementById('run-pill');
  pill.classList.toggle('is-live', live);
  document.getElementById('run-label').textContent = live ? 'در حال اجرا' : 'متوقف';
  document.getElementById('btn-start').hidden = live;
  document.getElementById('btn-stop').hidden = !live;

  const meta = document.getElementById('run-meta');
  if (live) {
    const secs = s.started_at ? (Date.now() / 1000 - s.started_at) : 0;
    meta.textContent = `اجرای #${s.run_id} · ${duration(secs)} · ${num(s.polls)} بار خواندن دفتر`;
  } else {
    meta.textContent = s.polls ? `متوقف شد بعد از ${num(s.polls)} بار خواندن` : 'آماده‌ی شروع';
  }

  const conn = document.getElementById('conn');
  conn.classList.toggle('is-ok', live && s.feed_ok);
  conn.classList.toggle('is-fail', live && !s.feed_ok);
  document.getElementById('conn-text').textContent = !live
    ? 'غیرفعال'
    : s.feed_ok ? `متصل · ${(s.feed_success_rate * 100).toFixed(0)}٪ موفق` : 'قطع ارتباط';

  const pnlEl = document.getElementById('t-pnl');
  pnlEl.textContent = signedToman(s.pnl);
  pnlEl.classList.toggle('is-up', s.pnl > 0);
  pnlEl.classList.toggle('is-down', s.pnl < 0);
  document.getElementById('t-pnl-pct').textContent = pct(s.pnl_pct, 4);
  document.getElementById('t-trades').textContent = num(s.trades);
  document.getElementById('t-wins').textContent = num(s.wins);
  document.getElementById('t-opps').textContent = num(s.opportunities);
  document.getElementById('t-vanished').textContent = num(s.vanished);

  const edgeEl = document.getElementById('t-edge');
  if (s.best_edge_bps === null || s.best_edge_bps === undefined) {
    edgeEl.textContent = '—';
    edgeEl.className = 'tile-v';
    document.getElementById('t-edge-tri').textContent = live ? 'در حال اسکن…' : 'متوقف';
  } else {
    edgeEl.textContent = `${bps(s.best_edge_bps)} bps`;
    edgeEl.className = 'tile-v ' + (s.best_edge_bps > 0 ? 'is-up' : 'is-down');
    document.getElementById('t-edge-tri').textContent = s.best_triangle || '—';
  }

  lineChart(document.getElementById('chart-edge'),
    s.edges.map(([t, v]) => ({ t, v })),
    { format: (v) => v.toFixed(0), tipFormat: (v) => `${bps(v)} bps`, zeroLine: true,
      threshold: s.config ? s.config.min_profit_bps : null,
      label: 'نمودار لبه‌ی سود خالص بر حسب bps' });

  lineChart(document.getElementById('chart-equity'),
    s.equity.map(([t, v]) => ({ t, v })),
    { format: compactToman, axisFormat: (tv) => compactAxis(tv, divisor()),
      tipFormat: (v) => `${toman(v)} تومان`, label: 'نمودار منحنی سرمایه' });

  renderTriangles(s.triangles);
  renderMarkets(s.markets);
  renderFeed(s.events);
}

function renderTriangles(tris) {
  const body = document.querySelector('#tbl-triangles tbody');
  const rows = Object.entries(tris || {});
  if (!rows.length) { body.innerHTML = '<tr class="empty"><td colspan="4">در انتظار شروع</td></tr>'; return; }
  rows.sort((a, b) => (b[1].net_bps ?? -1e9) - (a[1].net_bps ?? -1e9));
  body.innerHTML = rows.map(([name, t]) => {
    if (t.net_bps === null || t.net_bps === undefined) {
      return `<tr><td>${esc(t.path || name)}</td><td colspan="3" class="muted">${esc(t.note || 'عمق کافی نیست')}</td></tr>`;
    }
    const cls = t.net_bps > 0 ? 'pos' : 'neg';
    return `<tr>
      <td>${esc(t.path || name)}</td>
      <td class="num">${bps(t.gross_bps)}</td>
      <td class="num ${cls}">${bps(t.net_bps)}</td>
      <td class="num">${toman(t.size)}</td></tr>`;
  }).join('');
}

function renderMarkets(markets) {
  const body = document.querySelector('#tbl-markets tbody');
  const rows = Object.entries(markets || {});
  if (!rows.length) {
    body.innerHTML = '<tr class="empty"><td colspan="6">در انتظار شروع یا تست اتصال</td></tr>';
    return;
  }
  body.innerHTML = rows.sort().map(([sym, m]) => `<tr>
    <td><strong>${esc(sym)}</strong></td>
    <td class="num">${num(m.bid)}</td>
    <td class="num">${num(m.ask)}</td>
    <td class="num">${m.spread_bps.toFixed(1)} bps</td>
    <td class="num">${signedFixed(m.obi, 2)}</td>
    <td class="num">${m.sigma_bps.toFixed(1)} bps</td></tr>`).join('');
}

/* ------------------------------------------------------------------ report */

const VERDICT_STYLE = {
  'EDGE PRESENT IN SAMPLE': ['v-good', 'در این نمونه لبه‌ی سود وجود دارد',
    '<path d="M4 12.5 9.5 18 20 6.5"/>'],
  'FRAGILE EDGE': ['v-warning', 'لبه‌ی سود شکننده است',
    '<path d="M12 8v5"/><circle cx="12" cy="16.4" r=".9" fill="currentColor"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>'],
  'NOT STATISTICALLY SIGNIFICANT': ['v-critical', 'از نظر آماری معنادار نیست',
    '<circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><circle cx="12" cy="16.5" r=".9" fill="currentColor"/>'],
  'NO EDGE FOUND': ['v-critical', 'هیچ لبه‌ی سودی پیدا نشد',
    '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'],
  'INSUFFICIENT SAMPLE': ['v-neutral', 'نمونه هنوز کافی نیست',
    '<circle cx="12" cy="12" r="9"/><path d="M12 8v4l3 2"/>'],
  'NO DATA': ['v-neutral', 'داده‌ای جمع نشده', '<circle cx="12" cy="12" r="9"/><path d="M8 12h8"/>'],
};

const VERDICT_BODY = {
  'EDGE PRESENT IN SAMPLE': 'میانگین سود هر معامله مثبت است و بازه‌ی اطمینان صفر را در بر نمی‌گیرد، و تا خط کارمزد فاصله دارد. این هنوز اثبات سود آینده نیست؛ با یک اجرای طولانی‌تر تأییدش کنید.',
  'FRAGILE EDGE': 'در این نمونه سود واقعی بود ولی خیلی نزدیک به خط کارمزد است. یک افزایش کوچک کارمزد، اینترنت کندتر، یا دفتر سفارش نازک‌تر آن را از بین می‌برد.',
  'NOT STATISTICALLY SIGNIFICANT': 'بازه‌ی اطمینان ۹۵٪ برای میانگین سود هر معامله شامل صفر است، یعنی سود مشاهده‌شده با نوسان تصادفی سازگار است. روی این پول نگذارید.',
  'NO EDGE FOUND': 'حتی یک چرخه هم کارمزد را پوشش نداد. یعنی یک ربات آربیتراژ روی این بازارها هیچ معامله‌ای نمی‌کرد و هیچ سودی نمی‌ساخت. این نتیجه‌ی مفیدی است: بدون هزینه فهمیدید.',
  'INSUFFICIENT SAMPLE': 'کمتر از ۳۰ معامله. زیر این تعداد، تفکیک لبه‌ی واقعی از شانس ممکن نیست، هر عددی که سود نشان بدهد. جمع‌آوری داده را ادامه بدهید.',
  'NO DATA': 'این اجرا هیچ داده‌ای جمع نکرده. اتصال و تنظیمات را بررسی کنید.',
};

function renderReport(r) {
  const host = document.getElementById('report-body');
  if (!r || r.empty) {
    host.innerHTML = `<div class="placeholder"><p>هنوز گزارشی نیست.</p>
      <p class="muted">اول پیپر تریدینگ را اجرا کنید تا داده جمع شود.</p></div>`;
    return;
  }
  state.report = r;
  state.unit = r.unit || state.unit;

  const [cls, title, icon] = VERDICT_STYLE[r.verdict.head] || VERDICT_STYLE['NO DATA'];
  const body = VERDICT_BODY[r.verdict.head] || r.verdict.body;

  const tile = (k, v, sub, mod = '') =>
    `<article class="tile"><p class="tile-k">${k}</p>
     <p class="tile-v ${mod}">${v}</p><p class="tile-sub">${sub || '&nbsp;'}</p></article>`;

  const significant = r.ci_low > 0;
  const feeMargin = r.break_even_fee > r.fee_rate;

  host.innerHTML = `
    <div class="verdict ${cls}">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
           stroke-linecap="round" stroke-linejoin="round">${icon}</svg>
      <div><h2>${esc(title)}</h2><p>${esc(body)}</p></div>
    </div>

    <div class="tiles">
      ${tile('سود / زیان خالص', signedToman(r.total_pnl),
             pct(r.total_return_pct, 4) + ' از سرمایه',
             r.total_pnl > 0 ? 'is-up' : r.total_pnl < 0 ? 'is-down' : '')}
      ${tile('معاملات', num(r.fills), `${num(r.wins)} سودده · ${r.hit_rate.toFixed(1)}٪`)}
      ${tile('اسنپ‌شات دفتر سفارش', num(r.snapshot_count), `${r.hours.toFixed(2)} ساعت اجرا`)}
      ${tile('فرصت‌ها', num(r.opportunity_count), `${num(r.vanished_count)} قبل از اجرا پرید`)}
    </div>

    <p class="section-title">آیا این سود واقعی است یا شانس؟</p>
    <section class="card"><div class="table-wrap"><table class="table">
      <thead><tr><th>سنجه</th><th>مقدار</th><th>تفسیر</th></tr></thead>
      <tbody>
        <tr><td>بازه‌ی اطمینان ۹۵٪ میانگین سود هر معامله</td>
            <td class="num">${signedToman(r.ci_low)} … ${signedToman(r.ci_high)}</td>
            <td class="${significant ? 'pos' : 'neg'}">${significant
              ? '✔ صفر را در بر نمی‌گیرد' : '✘ شامل صفر است — معنادار نیست'}</td></tr>
        <tr><td>احتمال مثبت بودن میانگین واقعی</td>
            <td class="num">${r.p_positive.toFixed(1)}٪</td>
            <td class="muted">بازنمونه‌گیری بوت‌استرپ</td></tr>
        <tr><td>هزینه‌ی تأخیر (از سیگنال تا اجرا)</td>
            <td class="num">${r.latency_cost_bps.toFixed(2)} bps</td>
            <td class="muted">لبه‌ای که بین دیدن و اجرا از بین رفت</td></tr>
        <tr><td>کارمزد سربه‌سر (میانه)</td>
            <td class="num">${(r.break_even_fee * 100).toFixed(4)}٪</td>
            <td class="${feeMargin ? 'pos' : 'neg'}">${feeMargin ? '✔' : '✘'} کارمزد شما ${(r.fee_rate * 100).toFixed(4)}٪</td></tr>
        <tr><td>نسبت شارپ سالانه‌شده</td>
            <td class="num">${r.can_annualise ? r.sharpe.toFixed(2) : '—'}</td>
            <td class="muted">${r.can_annualise ? 'بر پایه‌ی سری سود هر معامله' : 'اجرا کوتاه‌تر از ۶ ساعت است'}</td></tr>
        <tr><td>بیشترین افت سرمایه</td>
            <td class="num">${toman(r.drawdown_abs)} (${r.drawdown_pct.toFixed(3)}٪)</td>
            <td class="muted">از قله تا دره</td></tr>
        <tr><td>همبستگی عدم تعادل دفتر با سود</td>
            <td class="num">${signedFixed(r.obi_corr, 3)}</td>
            <td class="muted">قدر مطلق کمتر از ۰.۲ یعنی سیگنال قابل استفاده‌ای نیست</td></tr>
      </tbody></table></div></section>

    <div class="grid-2" style="margin-top:16px">
      <section class="card chart-card">
        <header class="card-head"><div><h2>حساسیت به کارمزد</h2>
        <p class="card-sub">سود کل اگر کارمزد هر پا این مقدار بود</p></div></header>
        <div class="chart" id="chart-fee" data-empty="معامله‌ای انجام نشد"></div>
      </section>
      <section class="card chart-card">
        <header class="card-head"><div><h2>منحنی سرمایه</h2>
        <p class="card-sub">موجودی شبیه‌سازی‌شده در طول اجرا</p></div></header>
        <div class="chart" id="chart-report-equity" data-empty="معامله‌ای انجام نشد"></div>
      </section>
    </div>

    <div class="grid-2">
      <section class="card">
        <header class="card-head"><div><h2>به تفکیک مثلث</h2></div></header>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>حلقه</th><th>تعداد</th><th>سود</th></tr></thead>
          <tbody>${r.triangles.length ? r.triangles.map((t) => `<tr>
            <td>${esc(t.name)}</td><td class="num">${num(t.n)}</td>
            <td class="num ${t.pnl > 0 ? 'pos' : t.pnl < 0 ? 'neg' : ''}">${signedToman(t.pnl)}</td>
          </tr>`).join('') : '<tr class="empty"><td colspan="3">معامله‌ای انجام نشد</td></tr>'}</tbody>
        </table></div>
      </section>
      <section class="card">
        <header class="card-head"><div><h2>دلیل رد شدن سیگنال‌ها</h2></div></header>
        <div class="table-wrap"><table class="table">
          <thead><tr><th>دلیل</th><th>تعداد</th></tr></thead>
          <tbody>${r.skip_reasons.length ? r.skip_reasons.map((s) => `<tr>
            <td>${esc(s.reason)}</td><td class="num">${num(s.count)}</td></tr>`).join('')
            : '<tr class="empty"><td colspan="2">هیچ سیگنالی رد نشد</td></tr>'}</tbody>
        </table></div>
      </section>
    </div>

    <section class="card">
      <header class="card-head"><div><h2>برون‌یابی</h2>
      <p class="card-sub">این عدد یک محاسبه‌ی حسابی است، نه پیش‌بینی</p></div></header>
      <div class="callout callout-warning" style="margin-top:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 8v5"/><circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <div><strong>سود ۳۰ روزه با فرض تکرار همین اجرا: ${esc(r.projection)}</strong>
        این عدد فرض می‌کند همین نرخ فرصت شبانه‌روز ادامه دارد، عمق بازار نامحدود است،
        هیچ رقیبی زودتر از شما سفارش نمی‌گذارد، ریت‌لیمیت و قطعی وجود ندارد، و اجرا دقیقاً
        مثل شبیه‌سازی انجام می‌شود. با پول واقعی هر کدام از این فرض‌ها می‌شکند. این را سقفی
        بدانید که واقعیت به آن نمی‌رسد.</div>
      </div>
    </section>`;

  const feeHost = document.getElementById('chart-fee');
  const bars = (r.sensitivity || []).map((s) => ({
    label: (s.fee * 100).toFixed(2) + '٪', v: s.pnl / divisor(), fee: s.fee,
  }));
  const hi = bars.findIndex((b) => Math.abs(b.fee - r.fee_rate) < 1e-9);
  barChart(feeHost, bars, { format: compact, axisFormat: (tv) => compactAxis(tv),
    tipFormat: (v) => `${num(v)} تومان`, highlight: hi,
    label: 'نمودار میله‌ای حساسیت سود به کارمزد' });

  const eqHost = document.getElementById('chart-report-equity');
  const eq = (r.equity || []).map((v, i) => ({ t: i, v }));
  if (eq.length > 1) {
    lineChart(eqHost, eq, { format: compactToman,
      axisFormat: (tv) => compactAxis(tv, divisor()),
      tipFormat: (v) => `${toman(v)} تومان`, label: 'منحنی سرمایه' });
    // index-based x axis: hide the clock labels, they would be meaningless
    eqHost.querySelectorAll('text').forEach((t) => {
      if (/^\d{2}:\d{2}:\d{2}$/.test(t.textContent)) t.remove();
    });
  } else {
    eqHost.dataset.state = 'empty';
  }
}

async function loadRuns() {
  const { runs } = await get('/api/runs');
  const sel = document.getElementById('run-select');
  const previous = sel.value;
  sel.innerHTML = runs.length
    ? runs.map((r) => `<option value="${r.id}">#${r.id} · ${dateTime(r.started_at)} · ${num(r.trades)} معامله</option>`).join('')
    : '<option value="">هیچ اجرایی ثبت نشده</option>';
  if (previous && runs.some((r) => String(r.id) === previous)) sel.value = previous;
  return runs;
}

async function loadReport() {
  const sel = document.getElementById('run-select');
  const host = document.getElementById('report-body');
  const run = sel.value ? `?run=${encodeURIComponent(sel.value)}` : '';
  // Building the report resamples the trade series thousands of times, which
  // takes a moment on a long run -- say so rather than showing a blank page.
  host.innerHTML = `<div class="placeholder"><p class="muted">در حال ساخت گزارش…</p>
    <p class="muted">محاسبه‌ی بازه‌ی اطمینان روی هزاران بازنمونه</p></div>`;
  try {
    renderReport(await get(`/api/report${run}`));
  } catch (err) {
    host.innerHTML = `<div class="placeholder"><p class="neg">${esc(err.message)}</p></div>`;
    toast(`گزارش ساخته نشد: ${err.message}`, 'err');
  }
}

/* ---------------------------------------------------------------- settings */

async function loadSettings() {
  const cfg = await get('/api/config');
  const d = divisor();
  document.getElementById('f-fee').value = (cfg.fee_rate * 100).toFixed(3);
  document.getElementById('f-capital').value = Math.round(cfg.capital_irt / d);
  document.getElementById('f-min-order').value = Math.round(cfg.min_order_irt / d);
  document.getElementById('f-max-order').value = Math.round(cfg.max_order_irt / d);
  document.getElementById('f-min-bps').value = cfg.min_profit_bps;
  document.getElementById('f-poll').value = cfg.poll_interval_sec;
  bindEchoes();
}

/** Spell the amount back out: a dropped zero in a money field is a 10x error. */
const SCALES = [[1e9, 'میلیارد'], [1e6, 'میلیون'], [1e3, 'هزار']];
function spellAmount(v) {
  if (!isFinite(v) || v <= 0) return '\u00a0';
  for (const [size, word] of SCALES) {
    if (v >= size) {
      const q = v / size;
      return `${Number(q.toFixed(2)).toLocaleString('en-US')} ${word} تومان`;
    }
  }
  return `${num(v)} تومان`;
}

function bindEchoes() {
  document.querySelectorAll('.echo').forEach((echo) => {
    const input = document.getElementById(echo.dataset.for);
    if (!input) return;
    const update = () => { echo.textContent = spellAmount(Number(input.value)); };
    input.addEventListener('input', update);
    update();
  });
}

async function saveSettings() {
  const d = divisor();
  const msg = document.getElementById('save-msg');
  const patch = {
    fee_rate: Number(document.getElementById('f-fee').value) / 100,
    capital_irt: Number(document.getElementById('f-capital').value) * d,
    min_order_irt: Number(document.getElementById('f-min-order').value) * d,
    max_order_irt: Number(document.getElementById('f-max-order').value) * d,
    min_profit_bps: Number(document.getElementById('f-min-bps').value),
    poll_interval_sec: Number(document.getElementById('f-poll').value),
  };
  for (const [k, v] of Object.entries(patch)) {
    if (!isFinite(v)) { msg.textContent = 'مقدار نامعتبر'; msg.className = 'form-msg err'; return; }
    patch[k] = v;
  }
  try {
    const res = await post('/api/config', patch);
    if (!res.ok) throw new Error(res.error || 'ذخیره نشد');
    msg.textContent = '✔ ذخیره شد';
    msg.className = 'form-msg ok';
    toast('تنظیمات ذخیره شد', 'ok');
  } catch (err) {
    msg.textContent = `✘ ${err.message}`;
    msg.className = 'form-msg err';
  }
  setTimeout(() => { msg.textContent = ''; }, 5000);
}

function lockSettings(locked) {
  document.querySelectorAll('#view-settings input').forEach((i) => { i.disabled = locked; });
  document.getElementById('btn-save').disabled = locked;
}

/* ------------------------------------------------------------------ doctor */

async function runDoctor() {
  const btn = document.getElementById('btn-doctor');
  const card = document.getElementById('doctor-card');
  const out = document.getElementById('doctor-out');
  btn.disabled = true;
  card.hidden = false;
  out.innerHTML = '<div class="placeholder"><p class="muted">در حال تست…</p></div>';
  try {
    const d = await get('/api/doctor');
    if (!d.ok) {
      out.innerHTML = `<div class="callout callout-warning" style="margin:0 16px 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 8v5"/><circle cx="12" cy="16.4" r=".9" fill="currentColor" stroke="none"/><path d="M10.3 3.9 2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>
        <div><strong>اتصال برقرار نشد.</strong>
        <span class="num">${esc(d.error || '')}</span><br>
        ۱. اینترنت را بررسی کنید و nobitex.ir را در مرورگر باز کنید.<br>
        ۲. اگر VPN یا پروکسی روشن است خاموشش کنید.<br>
        ۳. اگر باز هم نشد، ممکن است آدرس API عوض شده باشد.</div></div>`;
      return;
    }
    if (d.markets.length) {
      state.unit = d.unit === 'unknown' ? state.unit : d.unit;
      renderMarkets(Object.fromEntries(d.markets.map((m) => [m.symbol, {
        bid: m.bid, ask: m.ask, spread_bps: m.spread_bps, obi: 0, sigma_bps: 0,
      }])));
    }
    const anyPositive = d.triangles.some((t) => t.net_bps !== null && t.net_bps > 0);
    out.innerHTML = `
      <div class="table-wrap"><table class="table">
        <thead><tr><th>حلقه</th><th>ناخالص</th><th>خالص</th><th>حجم بهینه</th><th>وضعیت</th></tr></thead>
        <tbody>${d.triangles.map((t) => t.net_bps === null
          ? `<tr><td>${esc(t.path)}</td><td colspan="4" class="muted">${esc(t.note)}</td></tr>`
          : `<tr><td>${esc(t.path)}</td>
             <td class="num">${bps(t.gross_bps)}</td>
             <td class="num ${t.net_bps > 0 ? 'pos' : 'neg'}">${bps(t.net_bps)}</td>
             <td class="num">${toman(t.size)}</td>
             <td>${t.net_bps > 0 ? '<span class="pos">✔ سودده</span>' : '<span class="muted">زیر خط هزینه</span>'}</td>
             </tr>`).join('')}</tbody></table></div>
      <div class="callout" style="margin:14px 16px 16px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><circle cx="12" cy="8" r=".9" fill="currentColor" stroke="none"/></svg>
        <div>${anyPositive
          ? 'همین لحظه دست‌کم یک حلقه هزینه‌ها را پوشش می‌دهد. یک لحظه هیچ چیزی را ثابت نمی‌کند — چند روز پیپر تریدینگ اجرا کنید.'
          : 'همین لحظه هیچ حلقه‌ای هزینه‌ها را پوشش نمی‌دهد. کاملاً عادی است: پنجره‌های سودده نادر و کوتاه‌اند. اندازه‌گیری دقیقاً برای همین است.'}</div>
      </div>`;
  } catch (err) {
    out.innerHTML = `<div class="placeholder"><p class="neg">${esc(err.message)}</p></div>`;
  } finally {
    btn.disabled = false;
  }
}

/* ------------------------------------------------------------------- shell */

let toastTimer = null;
function toast(message, kind = '') {
  const t = document.getElementById('toast');
  t.textContent = message;
  t.className = `toast ${kind ? 'is-' + kind : ''}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, 5200);
}

function switchView(name) {
  document.querySelectorAll('.nav-item').forEach((b) => {
    const on = b.dataset.view === name;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll('.view').forEach((v) => {
    v.classList.toggle('is-active', v.id === `view-${name}`);
  });
  if (name === 'report') { loadRuns().then(loadReport); }
  if (name === 'settings') { loadSettings(); }
  // charts measure their host, so they must be drawn while it is visible
  if (name === 'dashboard' && state.status) renderStatus(state.status);
}

async function poll() {
  try {
    const s = await get('/api/status');
    if (document.getElementById('view-dashboard').classList.contains('is-active')
        || document.getElementById('view-markets').classList.contains('is-active')) {
      renderStatus(s);
    } else {
      state.status = s;
      state.unit = s.irt_unit || state.unit;
    }
    lockSettings(!!s.running);
    if (s.last_error && s.last_error !== state.lastShownError) {
      state.lastShownError = s.last_error;
      toast(s.last_error, 'err');
    }
  } catch (err) {
    document.getElementById('conn-text').textContent = 'ارتباط با برنامه قطع شد';
    document.getElementById('conn').className = 'conn is-fail';
  }
}

function applyTheme(theme) {
  if (theme) document.documentElement.setAttribute('data-theme', theme);
  else document.documentElement.removeAttribute('data-theme');
  if (state.status) renderStatus(state.status);
  if (state.report) renderReport(state.report);
}

function initTheme() {
  let saved = null;
  try { saved = localStorage.getItem('theme'); } catch (_) { /* private mode */ }
  applyTheme(saved);
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const current = document.documentElement.getAttribute('data-theme');
    const isDark = current
      ? current === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    const next = isDark ? 'light' : 'dark';
    try { localStorage.setItem('theme', next); } catch (_) { /* ignore */ }
    applyTheme(next);
  });
}

function init() {
  initTheme();

  document.querySelectorAll('.nav-item').forEach((b) => {
    b.addEventListener('click', () => switchView(b.dataset.view));
  });

  document.getElementById('btn-start').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      const res = await post('/api/start');
      if (!res.ok) throw new Error(res.error);
      toast('پیپر تریدینگ شروع شد — با پول شبیه‌سازی‌شده', 'ok');
    } catch (err) { toast(`شروع نشد: ${err.message}`, 'err'); }
    finally { ev.currentTarget.disabled = false; poll(); }
  });

  document.getElementById('btn-stop').addEventListener('click', async (ev) => {
    ev.currentTarget.disabled = true;
    try {
      await post('/api/stop');
      toast('متوقف شد. برای دیدن نتیجه به تب گزارش بروید.', 'ok');
    } catch (err) { toast(err.message, 'err'); }
    finally { ev.currentTarget.disabled = false; poll(); }
  });

  document.getElementById('btn-doctor').addEventListener('click', runDoctor);
  document.getElementById('btn-save').addEventListener('click', saveSettings);
  document.getElementById('btn-refresh-report').addEventListener('click', () => loadRuns().then(loadReport));
  document.getElementById('run-select').addEventListener('change', loadReport);

  document.getElementById('btn-export').addEventListener('click', async () => {
    const sel = document.getElementById('run-select');
    try {
      const res = await post('/api/export', sel.value ? { run: Number(sel.value) } : {});
      if (!res.ok) throw new Error(res.error);
      toast(`ذخیره شد: ${res.html}`, 'ok');
    } catch (err) { toast(`خروجی گرفته نشد: ${err.message}`, 'err'); }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (state.status) renderStatus(state.status);
      if (state.report && document.getElementById('view-report').classList.contains('is-active')) {
        renderReport(state.report);
      }
    }, 160);
  });

  poll();
  state.pollTimer = setInterval(poll, POLL_MS);
  loadRuns().catch(() => {});
}

document.addEventListener('DOMContentLoaded', init);
