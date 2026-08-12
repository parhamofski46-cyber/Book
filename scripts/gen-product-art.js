/**
 * تصویرسازی اختصاصی برای هر محصول.
 * قبلاً همه‌ی محصولات یک دسته یک تصویر یکسان داشتند؛ حالا هر محصول
 * تصویر خودش را دارد که تفاوت واقعی‌اش را نشان می‌دهد (سایز مقطع،
 * تراکم شبکه، تعداد شاخه و ...). بدون متن، چون فونت داخل <img> لود نمی‌شود.
 */
const fs = require('fs'), path = require('path');
const OUT = '/home/user/Book/public/img/prod';
fs.mkdirSync(OUT, { recursive: true });

const RUST = '#A8431A', COPPER = '#C0763C', BG = '#FBF7F3';

const frame = (body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img">
  <defs>
    <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M20 0H0v20" fill="none" stroke="${RUST}" stroke-width=".5" opacity=".07"/>
    </pattern>
    <radialGradient id="glow" cx="78%" cy="18%" r="70%">
      <stop offset="0" stop-color="${COPPER}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${COPPER}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="300" fill="${BG}"/>
  <rect width="400" height="300" fill="url(#g)"/>
  <rect width="400" height="300" fill="url(#glow)"/>
  <g fill="none" stroke="${RUST}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;

const r1 = (n) => Math.round(n * 10) / 10;

/* ══════════ قوطی: مقطع مربعی توخالی، اندازه‌ی نسبی واقعی ══════════ */
function qooti(size) {                       // size: 20 | 40 | 60
  const s = { 20: 84, 40: 118, 60: 150 }[size];
  const wall = { 20: 12, 40: 18, 60: 22 }[size];
  const cx = 178, cy = { 20: 176, 40: 172, 60: 162 }[size], d = s * 0.46;    // عمق ایزومتریک
  const x = cx - s / 2, y = cy - s / 2;
  return frame(`
    <rect x="${r1(x)}" y="${r1(y)}" width="${s}" height="${s}" rx="3"/>
    <rect x="${r1(x + wall)}" y="${r1(y + wall)}" width="${r1(s - wall * 2)}" height="${r1(s - wall * 2)}" rx="2" stroke="${COPPER}"/>
    <path d="M${r1(x)} ${r1(y)} L${r1(x + d)} ${r1(y - d * 0.78)} H${r1(x + s + d)} L${r1(x + s)} ${r1(y)}"/>
    <path d="M${r1(x + s)} ${r1(y)} L${r1(x + s + d)} ${r1(y - d * 0.78)} V${r1(y + s - d * 0.78)} L${r1(x + s)} ${r1(y + s)}"/>
    <path d="M${r1(x + wall)} ${r1(y + wall)} L${r1(x + wall + d)} ${r1(y + wall - d * 0.78)} H${r1(x + s - wall + d)}" stroke="${COPPER}" stroke-width="2"/>
    <path d="M${r1(x + s - wall)} ${r1(y + wall)} L${r1(x + s - wall + d)} ${r1(y + wall - d * 0.78)}" stroke="${COPPER}" stroke-width="2"/>
    <path d="M${r1(x)} 252 H${r1(x + s)}" stroke="#8C5A3C" stroke-width="1.6" opacity=".6"/>
    <path d="M${r1(x)} 246v12M${r1(x + s)} 246v12" stroke="#8C5A3C" stroke-width="1.6" opacity=".6"/>`);
}

/* ══════════ نبشی: مقطع L ══════════ */
function nabshi(size) {                       // 3 | 4 | frame
  if (size === 'frame') {                     // پروفیل چهارچوبی ۵۰۷
    return frame(`
      <path d="M96 92 h60 v18 h-24 v92 h116 v26 H96 Z"/>
      <path d="M96 92 L146 58 h60 L156 92"/>
      <path d="M248 202 L298 168 v26 L248 228"/>
      <path d="M206 58 v34 h-24 v92 h116" stroke="${COPPER}" stroke-width="2"/>
      <path d="M132 110 v92" stroke="${COPPER}" stroke-width="2"/>`);
  }
  const L = size === 3 ? 108 : 132, t = size === 3 ? 22 : 28;
  const x = 120, y = 220;
  return frame(`
    <path d="M${x} ${y - L} h${t} v${L - t} h${L - t} v${t} H${x} Z"/>
    <path d="M${x} ${y - L} L${x + 48} ${y - L - 34} h${t} L${x + t} ${y - L}"/>
    <path d="M${x + L} ${y - t} L${x + L + 48} ${y - t - 34} v${t} L${x + L} ${y}"/>
    <path d="M${x + t + 48} ${y - L - 34} v${L - t} h${L - t}" stroke="${COPPER}" stroke-width="2"/>`);
}

/* ══════════ رابیس: شبکه‌ی رومبی با تراکم متفاوت ══════════ */
function rabis(cols, heavy) {
  const step = cols === 9 ? 34 : 24, sw = heavy ? 2.6 : 1.9;
  let mesh = '';
  for (let i = 0; i < Math.ceil(240 / step) + 1; i++)
    for (let j = 0; j < Math.ceil(190 / step) + 1; j++) {
      const x = 86 + i * step, y = 70 + j * step + (i % 2 ? step / 2 : 0);
      mesh += `    <path d="M${x} ${y} l${step / 2} ${step / 3} l${-step / 2} ${step / 3} l${-step / 2} ${-step / 3} Z" stroke="${i % 2 ? COPPER : RUST}" stroke-width="${sw}"/>\n`;
    }
  return frame(`
    <clipPath id="c"><rect x="82" y="62" width="236" height="176" rx="6"/></clipPath>
    <g clip-path="url(#c)">\n${mesh}    </g>
    <rect x="82" y="62" width="236" height="176" rx="6" stroke-width="${heavy ? 4 : 3}"/>
    <path d="M282 62 q36 26 36 58" stroke="${COPPER}" stroke-width="2.2"/>`);
}

/* ══════════ شاخ گوزنی: تعداد شاخه متفاوت ══════════ */
function shakh(prongs, galv) {
  const spike = (bx, by, tx, ty, hw) => {
    const dx = tx - bx, dy = ty - by, L = Math.hypot(dx, dy);
    const px = (-dy / L) * hw, py = (dx / L) * hw;
    return `<path d="M${r1(tx)} ${r1(ty)} L${r1(bx + px)} ${r1(by + py)} L${r1(bx - px)} ${r1(by - py)} Z" fill="${RUST}" stroke="none"/>`;
  };
  let g = '';
  [126, 200, 274].forEach((x, i) => {
    const h = i === 1 ? 118 : 130;
    g += `    <path d="M${x} 200 V${h + 14}" stroke-width="4"/>\n`;
    g += '    ' + spike(x, h + 30, x - 27, h - 6, 5) + '\n';
    g += '    ' + spike(x, h + 30, x + 27, h - 6, 5) + '\n';
    if (prongs === 3) g += '    ' + spike(x, h + 26, x, h - 18, 5) + '\n';
  });
  // نسخه‌ی گالوانیزه با جرقه‌های مشخصه‌ی روی (spangle) از ساده متمایز می‌شود
  const spark = (x, y, r) =>
    `<path d="M${x} ${y - r} q${r * 0.2} ${r * 0.8} ${r} ${r} q${-r * 0.8} ${r * 0.2} ${-r} ${r} q${-r * 0.2} ${-r * 0.8} ${-r} ${-r} q${r * 0.8} ${-r * 0.2} ${r} ${-r} Z" fill="${COPPER}" stroke="none"/>`;
  const shine = galv
    ? `    <g opacity=".95">
      ${spark(112, 166, 9)}${spark(200, 152, 7)}${spark(288, 168, 8)}
      ${spark(160, 214, 7)}${spark(246, 242, 8)}
    </g>\n`
    : '';
  return frame(`
    <path d="M74 200 h252 v58 H74 Z"/>
    <path d="M74 229 h252" stroke-width="1.8" opacity=".8"/>
    <path d="M126 200v29M200 200v29M274 200v29M100 229v29M164 229v29M236 229v29M300 229v29"
          stroke-width="1.6" opacity=".55"/>
${g}${shine}`);
}

/* ══════════ فنس / توری ══════════ */
function fence(kind) {
  if (kind === 'hex') {                                // تور مرغی
    let hexes = '';
    const w = 26, h = 22;
    for (let j = 0; j < 9; j++)
      for (let i = 0; i < 11; i++) {
        const x = 78 + i * w + (j % 2 ? w / 2 : 0), y = 58 + j * h;
        hexes += `    <path d="M${x} ${y} l${w / 2} ${h / 4} v${h / 2} l${-w / 2} ${h / 4} l${-w / 2} ${-h / 4} v${-h / 2} Z" stroke="${j % 2 ? COPPER : RUST}" stroke-width="1.6"/>\n`;
      }
    return frame(`
      <clipPath id="ch"><rect x="80" y="60" width="240" height="180" rx="8"/></clipPath>
      <g clip-path="url(#ch)">\n${hexes}      </g>
      <rect x="80" y="60" width="240" height="180" rx="8" stroke-width="3"/>`);
  }
  const step = kind === 'fine' ? 22 : 32, sw = kind === 'pvc' ? 3.4 : 1.9;
  let net = '';
  for (let i = -8; i <= 14; i++) net += `    <path d="M${88 + i * step} 66 L${88 + i * step + 174} 240"/>\n`;
  for (let i = -8; i <= 14; i++) net += `    <path d="M${88 + i * step} 240 L${88 + i * step + 174} 66"/>\n`;
  return frame(`
    <clipPath id="cf"><rect x="112" y="66" width="176" height="174"/></clipPath>
    <g clip-path="url(#cf)" stroke="${kind === 'pvc' ? COPPER : COPPER}" stroke-width="${sw}" opacity=".95">
${net}    </g>
    <path d="M100 54 v210M300 54 v210" stroke-width="4"/>
    <path d="M96 66 h208M96 240 h208" stroke-width="3"/>
    <path d="M100 54 q100 -14 200 0" stroke-width="2.4" stroke="${COPPER}"/>`);
}

/* ══════════ ورق گالوانیزه ══════════ */
function varagh(tile) {
  const x0 = 74, x1 = 326, y = 104, h = 132, step = 42;
  let top = `M${x0} ${y + 16}`, bot = `M${x0} ${y + h + 16}`, ribs = '';
  for (let x = x0; x < x1; x += step) {
    top += ` L${x + 11} ${y} L${x + 31} ${y} L${x + 42} ${y + 16}`;
    bot += ` L${x + 11} ${y + h} L${x + 31} ${y + h} L${x + 42} ${y + h + 16}`;
    ribs += `    <path d="M${x + 11} ${y} V${y + h}M${x + 31} ${y} V${y + h}" stroke="${COPPER}" stroke-width="2"/>\n`;
    ribs += `    <path d="M${x} ${y + 16} V${y + h + 16}" stroke="${COPPER}" stroke-width="1.6" opacity=".6"/>\n`;
  }
  // طرح سفال: پله‌های عرضی؛ طرح گالوانیزه: صاف
  const tiles = tile
    ? `    <path d="M${x0} ${y + 44} h${x1 - x0}M${x0} ${y + 88} h${x1 - x0}" stroke="${RUST}" stroke-width="2.4" opacity=".8"/>\n`
    : '';
  return frame(`
    <path d="${top}" stroke-width="3"/>
    <path d="${bot}" stroke-width="3"/>
    <path d="M${x0} ${y + 16} V${y + h + 16}M${x1} ${y + 16} V${y + h + 16}" stroke-width="3"/>
${ribs}${tiles}`);
}

/* ══════════ عایق‌ها ══════════ */
const rollArt = (foil) => frame(`
    <path d="M176 112 H340 V208 H176"/>
    <path d="M176 122 H340" stroke="${COPPER}" stroke-width="2" opacity=".8"/>
    <path d="M176 198 H340" stroke="${COPPER}" stroke-width="2" opacity=".8"/>
    ${foil ? `<path d="M196 132 l18 18 l-18 18M236 132 l18 18 l-18 18M276 132 l18 18 l-18 18" stroke="${COPPER}" stroke-width="2" opacity=".7"/>` : `<path d="M212 122 v76M252 122 v76M292 122 v76" stroke="${COPPER}" stroke-width="1.5" opacity=".55"/>`}
    <ellipse cx="130" cy="160" rx="30" ry="58" stroke-width="3"/>
    <path d="M130 102 h46M130 218 h46" stroke-width="3"/>
    <path d="M130 130 a16 30 0 1 0 0 60 a10 19 0 1 1 0 -38" stroke="${COPPER}" stroke-width="2.4"/>`);

const woolArt = () => frame(`
    <path d="M170 116 H336 V204 H170"/>
    <path d="M170 116 q14 12 0 24 q14 12 0 24 q14 12 0 24 q14 12 0 20" stroke="${COPPER}" stroke-width="2.2"/>
    <path d="M200 116 q14 22 0 44 q-14 22 0 44M244 116 q14 22 0 44 q-14 22 0 44M288 116 q14 22 0 44 q-14 22 0 44"
          stroke="${COPPER}" stroke-width="1.8" opacity=".7"/>
    <ellipse cx="126" cy="160" rx="28" ry="52" stroke-width="3"/>
    <path d="M126 108 h44M126 212 h44" stroke-width="3"/>
    <path d="M126 134 a14 26 0 1 0 0 52" stroke="${COPPER}" stroke-width="2.2"/>
    <g stroke="${COPPER}" stroke-width="2" opacity=".85">
      <path d="M226 84 q10 -10 0 -20M266 84 q10 -10 0 -20M306 84 q10 -10 0 -20"/>
    </g>`);

const foamArt = () => frame(`
    <path d="M88 168 h180 l44 -34 H132 Z"/>
    <path d="M88 168 v34 h180 v-34M268 168 l44 -34 v34 l-44 34"/>
    <path d="M88 202 v22 h180 v-22M268 202 l44-34v22l-44 34" opacity=".75"/>
    <path d="M118 168 v34M158 168 v34M198 168 v34M238 168 v34" stroke="${COPPER}" stroke-width="1.6" opacity=".6"/>
    <g stroke="${COPPER}" stroke-width="2" opacity=".8">
      <path d="M150 108 q10 -12 0 -24M200 100 q10 -12 0 -24M250 108 q10 -12 0 -24"/>
    </g>`);

const bitumenArt = () => frame(`
    <path d="M138 122 h124 v122 a10 10 0 0 1 -10 10 H148 a10 10 0 0 1 -10 -10 Z"/>
    <path d="M130 108 h140 v14 H130 Z"/>
    <path d="M176 108 v-18 h48 v18" stroke="${COPPER}" stroke-width="2.4"/>
    <path d="M160 160 h80M160 190 h80" stroke="${COPPER}" stroke-width="2" opacity=".6"/>
    <path d="M286 128 q-14 -20 0 -34 q14 14 0 34" stroke="${COPPER}" stroke-width="2.4"/>
    <path d="M312 160 q-11 -16 0 -27 q11 11 0 27" stroke="${COPPER}" stroke-width="2.2"/>`);

/* ══════════ پیچ و یراق ══════════ */
const screwArt = () => frame(`
    <g transform="rotate(-16 200 150)">
      <path d="M172 62 h56 v22 h-56 Z"/>
      <path d="M180 84 h40 v128 h-40 Z" stroke="${COPPER}" stroke-width="2"/>
      <path d="M180 100 l40 12M180 124 l40 12M180 148 l40 12M180 172 l40 12M180 196 l40 12"
            stroke="${COPPER}" stroke-width="2.2"/>
      <path d="M200 212 l17 32 l-34 0 Z" fill="${RUST}" stroke="none"/>
      <path d="M178 66 h44" stroke-width="2.2"/>
    </g>`);

const lockArt = () => frame(`
    <rect x="128" y="140" width="144" height="112" rx="14" stroke-width="3"/>
    <path d="M156 140 v-30 a44 44 0 0 1 88 0 v30" stroke-width="4"/>
    <circle cx="200" cy="186" r="15" stroke="${COPPER}" stroke-width="2.6"/>
    <path d="M200 201 v26" stroke="${COPPER}" stroke-width="2.6"/>
    <g stroke="${COPPER}" stroke-width="2.6" opacity=".9">
      <circle cx="308" cy="128" r="13"/>
      <path d="M308 141 v54M308 172 h12M308 186 h9"/>
    </g>`);

const hingeArt = () => frame(`
    <path d="M92 84 h94 v132 h-94 Z"/>
    <path d="M214 84 h94 v132 h-94 Z"/>
    <rect x="186" y="84" width="28" height="42" rx="14" stroke-width="3"/>
    <rect x="186" y="129" width="28" height="42" rx="14" stroke-width="3" stroke="${COPPER}"/>
    <rect x="186" y="174" width="28" height="42" rx="14" stroke-width="3"/>
    <g fill="${COPPER}" stroke="none">
      <circle cx="126" cy="118" r="6"/><circle cx="126" cy="182" r="6"/>
      <circle cx="274" cy="118" r="6"/><circle cx="274" cy="182" r="6"/>
    </g>
    <path d="M200 70 v160" stroke="${COPPER}" stroke-width="1.8" opacity=".6" stroke-dasharray="6 6"/>`);

/* ══════════ نگاشت محصول → تصویر ══════════ */
const MAP = {
  'قوطی ۲۰×۲۰': () => qooti(20),
  'قوطی ۴۰×۴۰': () => qooti(40),
  'قوطی ۶۰×۶۰': () => qooti(60),
  'نبشی ۳': () => nabshi(3),
  'نبشی ۴': () => nabshi(4),
  'پروفیل چهارچوبی ۵۰۷': () => nabshi('frame'),
  'رابیس ۹ ستون': () => rabis(9, false),
  'رابیس ۱۳ ستون ۷۰۰ گرم': () => rabis(13, false),
  'رابیس ۱۳ ستون ۹۰۰ گرم': () => rabis(13, true),
  'شاخ گوزنی سه‌شاخه': () => shakh(3, false),
  'شاخ گوزنی گالوانیزه': () => shakh(3, true),
  'شاخ گوزنی دوشاخه': () => shakh(2, false),
  'تور مرغی': () => fence('hex'),
  'فنس گالوانیزه ۲.۵ میل': () => fence('std'),
  'فنس چشمه ۶': () => fence('fine'),
  'فنس روکش‌دار (PVC)': () => fence('pvc'),
  'ورق گالوانیزه طرح سفال': () => varagh(true),
  'ورق گالوانیزه طرح گالوانیزه': () => varagh(false),
  'پشم شیشه': woolArt,
  'فوم عایق': foamArt,
  'ایزوگام فویل‌دار': () => rollArt(true),
  'ایزوگام پشم‌شیشه': () => rollArt(false),
  'قیر و قیرگونی': bitumenArt,
  'پیچ سرمته': screwArt,
  'قفل درب': lockArt,
  'لولای درب': hingeArt,
};

const { db } = require('/home/user/Book/src/db');
const { slugify } = require('/home/user/Book/src/utils/slug');
const rows = db.prepare('SELECT name, slug FROM products').all();

let made = 0, total = 0;
for (const row of rows) {
  const fn = MAP[row.name];
  if (!fn) continue;
  const svg = fn();
  fs.writeFileSync(path.join(OUT, row.slug + '.svg'), svg);
  total += Buffer.byteLength(svg);
  made++;
}
console.log(`${made} تصویر محصول ساخته شد، ${Math.round(total / 1024)}KB`);
console.log('بدون تصویر اختصاصی (تصویر دسته می‌گیرند):');
rows.filter((r) => !MAP[r.name]).forEach((r) => console.log('  •', r.name));
