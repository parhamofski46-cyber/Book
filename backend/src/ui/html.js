// Escaping and small formatting helpers. Every value that reaches a page goes
// through esc(): resource names arrive from other people's servers.
const MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => MAP[c]);

export const fmtMs = (ms) => {
  if (ms == null) return '--';
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.round(ms)}ms`;
};

export const fmtPct = (v, digits = 2) => (v == null ? '--' : `${v.toFixed(digits)}%`);

export function fmtAgo(seconds) {
  if (seconds == null) return 'never';
  if (seconds < 60) return `${Math.round(seconds)}s ago`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h ago`;
  return `${Math.round(seconds / 86400)}d ago`;
}

export const fmtClock = (unixS) =>
  new Date(unixS * 1000).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
