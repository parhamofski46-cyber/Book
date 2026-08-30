'use strict';
/**
 * ساخت تصویرسازی خطی برای مدل‌های گل فرفورژه.
 *
 * چرا لازم شد: همه‌ی محصولات فرفورژه به تصویر دسته برمی‌گشتند، یعنی ۹ کارت
 * با یک عکس یکسان. برای بخشی که ادعای «بیش از ۱۰۰۰ مدل» دارد، بدترین حالت
 * ممکن بود. هر مدل حالا طرح مخصوص خودش را دارد.
 *
 * سبک عمداً با بقیه‌ی تصویرسازی‌های سایت یکی است: قاب ۴۰۰×۳۰۰، پس‌زمینه‌ی
 * کرم، شبکه‌ی کم‌رنگ، خطوط مسی.
 */

const fs = require('fs');
const path = require('path');

const W = 400;
const H = 300;
const CX = W / 2;
const MAIN = '#A8431A';
const SOFT = '#C0763C';

const f = (n) => Number(n).toFixed(1);

/** مارپیچ (حلزونی) — پایه‌ای‌ترین المان فرفورژه */
function spiral(cx, cy, rStart, rEnd, turns, a0, dir = 1, steps = 70) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = a0 + dir * turns * 2 * Math.PI * t;
    const r = rStart + (rEnd - rStart) * t;
    pts.push(`${f(cx + r * Math.cos(ang))} ${f(cy + r * Math.sin(ang))}`);
  }
  return 'M' + pts.join(' L');
}

/** برگ: دو کمان قرینه از پایه تا نوک */
function leaf(x, y, len, ang, wide = 0.36) {
  const dx = Math.cos(ang) * len;
  const dy = Math.sin(ang) * len;
  const tipX = x + dx;
  const tipY = y + dy;
  const nx = -Math.sin(ang) * len * wide;
  const ny = Math.cos(ang) * len * wide;
  const mx = x + dx / 2;
  const my = y + dy / 2;
  return (
    `M${f(x)} ${f(y)} Q${f(mx + nx)} ${f(my + ny)} ${f(tipX)} ${f(tipY)}` +
    ` Q${f(mx - nx)} ${f(my - ny)} ${f(x)} ${f(y)} Z`
  );
}

/** میله‌های نگه‌دارنده‌ی بالا و پایین — حس «قطعه‌ی آماده‌ی نصب» را می‌دهد */
const rails = `
    <path d="M70 54 H330" stroke="${SOFT}" stroke-width="3" opacity=".5"/>
    <path d="M70 246 H330" stroke="${SOFT}" stroke-width="3" opacity=".5"/>`;

const DESIGNS = {
  // ۱۰۱ — حلزونی ساده (دو حلزونی قرینه، جدا از هم)
  101: () => `
    ${rails}
    <path d="M200 54 V246"/>
    ${arc(spiral(166, 108, 3, 32, 1.25, 0, -1))}
    ${arc(spiral(234, 192, 3, 32, 1.25, Math.PI, -1))}
    <path d="M200 108 H166" stroke="${SOFT}" stroke-width="2"/>
    <path d="M200 192 H234" stroke="${SOFT}" stroke-width="2"/>`,

  // ۱۰۲ — حلزونی S شکل
  102: () => `
    ${rails}
    <path d="M200 54 V78"/>
    <path d="M200 246 V222"/>
    ${arc(spiral(168, 116, 3, 38, 1.25, Math.PI / 2, -1))}
    ${arc(spiral(232, 184, 3, 38, 1.25, -Math.PI / 2, -1))}
    <path d="M168 154 Q200 150 232 146" stroke="${SOFT}" stroke-width="2"/>`,

  // ۱۰۳ — قلبی
  103: () => `
    ${rails}
    <path d="M200 60 V88"/>
    <path d="M200 246 V232"/>
    <path d="M200 232 C120 186 128 108 172 108 C192 108 200 124 200 140
             C200 124 208 108 228 108 C272 108 280 186 200 232 Z"/>
    ${arc(spiral(172, 132, 3, 22, 1.1, -Math.PI / 2, -1), SOFT, 2)}
    ${arc(spiral(228, 132, 3, 22, 1.1, -Math.PI / 2, 1), SOFT, 2)}`,

  // ۱۰۴ — شاخه و برگ
  104: () => `
    ${rails}
    <path d="M200 246 C196 200 204 150 200 54"/>
    ${[
      [200, 210, 56, -0.9],
      [200, 190, 52, -2.25],
      [200, 162, 60, -0.75],
      [200, 140, 54, -2.4],
      [200, 112, 50, -1.0],
      [200, 92, 46, -2.1],
    ]
      .map(([x, y, l, a]) => `<path d="${leaf(x, y, l, a)}" stroke="${SOFT}" stroke-width="2"/>`)
      .join('\n    ')}`,

  // ۱۰۵ — لاله
  105: () => `
    ${rails}
    <path d="M200 246 V178"/>
    <path d="M200 178 C160 178 146 146 150 116 C168 128 186 132 200 130
             C214 132 232 128 250 116 C254 146 240 178 200 178 Z"/>
    <path d="M150 116 C168 96 186 88 200 86 C214 88 232 96 250 116" stroke="${SOFT}" stroke-width="2"/>
    <path d="M200 130 V86" stroke="${SOFT}" stroke-width="2"/>
    <path d="${leaf(200, 214, 54, -0.55)}" stroke="${SOFT}" stroke-width="2"/>
    <path d="${leaf(200, 206, 50, -2.6)}" stroke="${SOFT}" stroke-width="2"/>`,

  // ۱۰۶ — خورشیدی
  106: () => {
    const rays = [];
    for (let i = 0; i <= 8; i++) {
      const a = Math.PI + (i / 8) * Math.PI;
      rays.push(
        `<path d="M200 216 L${f(200 + 108 * Math.cos(a))} ${f(216 + 108 * Math.sin(a))}"/>`
      );
    }
    return `
    ${rails}
    <path d="M92 216 H308"/>
    ${rays.join('\n    ')}
    <path d="M128 216 A72 72 0 0 1 272 216" stroke="${SOFT}" stroke-width="2"/>
    <path d="M158 216 A42 42 0 0 1 242 216" stroke="${SOFT}" stroke-width="2"/>`;
  },

  // ۱۰۷ — پیچک
  107: () => `
    ${rails}
    <path d="M200 246 C150 214 250 186 200 154 C150 122 250 92 200 54"/>
    ${arc(spiral(238, 206, 3, 20, 1.1, Math.PI, 1), SOFT, 2)}
    ${arc(spiral(162, 132, 3, 20, 1.1, 0, 1), SOFT, 2)}
    <path d="${leaf(214, 200, 40, -0.5)}" stroke="${SOFT}" stroke-width="2"/>
    <path d="${leaf(186, 122, 40, -2.6)}" stroke="${SOFT}" stroke-width="2"/>`,

  // ۱۰۸ — سبدی (تاب‌خورده)
  108: () => `
    ${rails}
    <path d="M182 54 V246"/>
    <path d="M218 54 V246"/>
    <path d="M182 118 C182 100 218 100 218 118 C218 136 182 136 182 154
             C182 172 218 172 218 190 C218 208 182 208 182 226" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M218 118 C218 100 182 100 182 118 C182 136 218 136 218 154
             C218 172 182 172 182 190 C182 208 218 208 218 226" stroke="${SOFT}" stroke-width="2.2"/>`,

  // ۱۰۹ — نیزه‌ای
  109: () => `
    ${rails}
    <path d="M200 246 V126"/>
    <path d="M200 56 L228 126 H172 Z"/>
    <path d="M170 140 H230" stroke="${SOFT}" stroke-width="2.2"/>
    ${arc(spiral(170, 172, 3, 26, 1.15, -Math.PI / 2, -1), SOFT, 2)}
    ${arc(spiral(230, 172, 3, 26, 1.15, -Math.PI / 2, 1), SOFT, 2)}`,

  // ۱۱۰ — رزت (گل دایره‌ای)
  110: () => {
    const petals = [];
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * 2 * Math.PI - Math.PI / 2;
      petals.push(`<path d="${leaf(200, 150, 66, a, 0.42)}" stroke="${SOFT}" stroke-width="2"/>`);
    }
    return `
    ${rails}
    <path d="M200 54 V84"/>
    <path d="M200 246 V216"/>
    ${petals.join('\n    ')}
    <circle cx="200" cy="150" r="18" fill="none"/>
    <circle cx="200" cy="150" r="7" fill="none" stroke="${SOFT}" stroke-width="2"/>`;
  },

  // ۱۱۱ — قوس دوقلو
  111: () => `
    ${rails}
    <path d="M200 54 V246"/>
    <path d="M200 96 C136 108 130 176 176 204"/>
    <path d="M200 96 C264 108 270 176 224 204"/>
    ${arc(spiral(176, 204, 3, 22, 1.1, -Math.PI / 2, -1), SOFT, 2)}
    ${arc(spiral(224, 204, 3, 22, 1.1, -Math.PI / 2, 1), SOFT, 2)}
    <path d="M200 96 m-9 0 a9 9 0 1 0 18 0 a9 9 0 1 0 -18 0" stroke="${SOFT}" stroke-width="2"/>`,

  // ۱۱۲ — پروانه‌ای (چهار حلزونی که دُمشان در مرکز به هم می‌رسد)
  112: () => `
    ${rails}
    <path d="M200 74 V226"/>
    ${arc(spiral(166, 116, 3, 28, 1.15, Math.PI / 2, -1), MAIN, 2.4)}
    ${arc(spiral(234, 116, 3, 28, 1.15, Math.PI / 2, 1), MAIN, 2.4)}
    ${arc(spiral(166, 184, 3, 28, 1.15, -Math.PI / 2, 1), MAIN, 2.4)}
    ${arc(spiral(234, 184, 3, 28, 1.15, -Math.PI / 2, -1), MAIN, 2.4)}
    <path d="M200 150 L166 116 M200 150 L234 116 M200 150 L166 184 M200 150 L234 184"
          stroke="${SOFT}" stroke-width="2"/>`,
};

function arc(d, stroke, width) {
  const extra = stroke ? ` stroke="${stroke}" stroke-width="${width}"` : '';
  return `<path d="${d}"${extra}/>`;
}

function wrap(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img">
  <defs>
    <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M20 0H0v20" fill="none" stroke="#A8431A" stroke-width=".5" opacity=".07"/>
    </pattern>
    <radialGradient id="glow" cx="78%" cy="18%" r="70%">
      <stop offset="0" stop-color="#C0763C" stop-opacity=".16"/>
      <stop offset="1" stop-color="#C0763C" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="400" height="300" fill="#FBF7F3"/>
  <rect width="400" height="300" fill="url(#g)"/>
  <rect width="400" height="300" fill="url(#glow)"/>
  <g fill="none" stroke="${MAIN}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;
}

// ارقام فارسی، چون اسلاگ محصول‌ها فارسی است
const FA = '۰۱۲۳۴۵۶۷۸۹';
const toFa = (n) => String(n).replace(/\d/g, (d) => FA[+d]);

const outDir = process.argv[2] || path.join(__dirname, 'out');
fs.mkdirSync(outDir, { recursive: true });

let n = 0;
for (const [code, build] of Object.entries(DESIGNS)) {
  const file = path.join(outDir, `کد-${toFa(code)}.svg`);
  fs.writeFileSync(file, wrap(build()));
  n++;
}
console.log(`${n} طرح ساخته شد در ${outDir}`);
