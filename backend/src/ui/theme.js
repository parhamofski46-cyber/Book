// Design tokens.
//
// Values come from the reference palette and were run through its validator in
// both modes before use, rather than picked by eye. Dark is declared under both
// the media query and the data-theme scope so an explicit choice wins either
// way.
export const CSS = `
:root {
  color-scheme: light;
  --plane:#f9f9f7; --surface:#fcfcfb;
  --ink:#0b0b0b; --ink-2:#52514e; --muted:#898781;
  --grid:#e1e0d9; --axis:#c3c2b7; --border:rgba(11,11,11,0.10);
  --series:#2a78d6; --series-soft:rgba(42,120,214,0.14);
  --event:#eb6834;
  --good:#0ca30c; --warning:#fab219; --serious:#ec835a; --critical:#d03b3b;
}
@media (prefers-color-scheme: dark) {
  :root:where(:not([data-theme="light"])) {
    color-scheme: dark;
    --plane:#0d0d0d; --surface:#1a1a19;
    --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
    --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
    --series:#3987e5; --series-soft:rgba(57,135,229,0.18);
    --event:#d95926;
  }
}
:root[data-theme="dark"] {
  color-scheme: dark;
  --plane:#0d0d0d; --surface:#1a1a19;
  --ink:#ffffff; --ink-2:#c3c2b7; --muted:#898781;
  --grid:#2c2c2a; --axis:#383835; --border:rgba(255,255,255,0.10);
  --series:#3987e5; --series-soft:rgba(57,135,229,0.18);
  --event:#d95926;
}

*{box-sizing:border-box}
body{margin:0;background:var(--plane);color:var(--ink);
  font:14px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;}
a{color:var(--series);text-decoration:none}
a:hover{text-decoration:underline}
.wrap{max-width:1040px;margin:0 auto;padding:28px 20px 64px}
header.top{display:flex;align-items:baseline;gap:12px;margin-bottom:4px;flex-wrap:wrap}
h1{font-size:20px;margin:0;font-weight:650;letter-spacing:-0.01em}
h2{font-size:15px;margin:32px 0 10px;font-weight:600}
.sub{color:var(--ink-2);margin:0 0 20px;font-size:13px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:10px;padding:16px}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:8px}
.tile .k{color:var(--muted);font-size:12px;margin-bottom:6px}
.tile .v{font-size:26px;font-weight:640;letter-spacing:-0.02em;line-height:1.1}
.tile .n{color:var(--ink-2);font-size:12px;margin-top:4px}
.chip{display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;
  padding:2px 10px;border-radius:999px;border:1px solid var(--border);white-space:nowrap}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--muted);font-weight:500;font-size:12px;
  padding:6px 10px 6px 0;border-bottom:1px solid var(--grid)}
td{padding:8px 10px 8px 0;border-bottom:1px solid var(--grid);vertical-align:top}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums;padding-right:18px}
th:last-child,td:last-child{padding-right:0}
tr:last-child td{border-bottom:none}
.empty{color:var(--ink-2);font-size:13px;padding:8px 0}
.scroll{overflow-x:auto}
figure{margin:0}
figcaption{color:var(--ink-2);font-size:12px;margin-top:8px}
.legend{display:flex;gap:14px;flex-wrap:wrap;color:var(--ink-2);font-size:12px;margin-bottom:10px}
.legend .sw{display:inline-block;width:10px;height:2px;vertical-align:middle;margin-right:5px}
details{margin-top:10px}
summary{cursor:pointer;color:var(--ink-2);font-size:12px}
.tip{position:absolute;pointer-events:none;opacity:0;transition:opacity .08s;
  background:var(--surface);border:1px solid var(--border);border-radius:7px;
  padding:7px 9px;font-size:12px;box-shadow:0 4px 14px rgba(0,0,0,.13);z-index:5;
  white-space:nowrap;font-variant-numeric:tabular-nums}
.tip b{font-weight:600}
.chartbox{position:relative}
code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;
  background:var(--plane);border:1px solid var(--border);border-radius:4px;padding:1px 5px}
pre{background:var(--plane);border:1px solid var(--border);border-radius:8px;
  padding:12px;overflow-x:auto;font-size:12px}
`;

export const STATUS = {
  A: { var: '--good', label: 'healthy', icon: '●' },
  B: { var: '--good', label: 'good', icon: '●' },
  C: { var: '--warning', label: 'strained', icon: '▲' },
  D: { var: '--serious', label: 'degraded', icon: '▲' },
  F: { var: '--critical', label: 'critical', icon: '■' },
};
