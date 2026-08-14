'use strict';
/**
 * تصویرسازی خطی محصولات تازه‌ی سایت.
 *
 * چرا لازم است: بدون تصویر اختصاصی، همه‌ی محصولات یک دسته به تصویر همان دسته
 * برمی‌گردند و کاربر ده کارت با عکس یکسان می‌بیند — همان مشکلی که در بخش
 * فرفورژه داشتیم. هر محصول باید از روی تصویرش قابل تشخیص باشد.
 *
 * سبک عمداً با بقیه‌ی تصویرسازی‌های سایت یکی است: قاب ۴۰۰×۳۰۰، پس‌زمینه‌ی
 * کرم، شبکه‌ی کم‌رنگ، خطوط مسی با ضخامت ۲٫۶.
 *
 * اجرا:  node scripts/gen-new-product-art.js
 */

const fs = require('fs');
const path = require('path');

const MAIN = '#A8431A';
const SOFT = '#C0763C';
const OUT = path.join(__dirname, '..', 'public', 'img', 'prod');

const f = (n) => Number(n).toFixed(1);

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

/** توری جوشی با چشمه‌ی دلخواه */
function mesh(step) {
  const x0 = 96, y0 = 74, w = 208, h = 152;
  const p = [];
  for (let x = x0; x <= x0 + w + 0.1; x += step) p.push(`M${f(x)} ${y0} V${y0 + h}`);
  for (let y = y0; y <= y0 + h + 0.1; y += step) p.push(`M${x0} ${f(y)} H${x0 + w}`);
  return `
    <path d="${p.join(' ')}" stroke="${SOFT}" stroke-width="1.9"/>
    <rect x="${x0}" y="${y0}" width="${w}" height="${h}" rx="2"/>
    <path d="M96 244 H304" stroke="${SOFT}" stroke-width="1.6" opacity=".55"/>
    <path d="M96 238v12M304 238v12" stroke="${SOFT}" stroke-width="1.6" opacity=".55"/>`;
}

/** ورق فوم با ضخامت مشخص (mm روی قاب) */
function foam(thick) {
  const t = thick;
  return `
    <path d="M92 ${188 - t} H288 L308 ${152 - t} H112 Z"/>
    <path d="M92 ${188 - t} V188 L112 152 V${152 - t}"/>
    <path d="M92 188 H288 L308 152" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M288 ${188 - t} V188"/>
    <path d="M128 ${170 - t} H272 M120 ${158 - t} H264" stroke="${SOFT}" stroke-width="1.6" opacity=".7"/>
    <path d="M330 ${152 - t} V188" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M324 ${152 - t} h12 M324 188 h12" stroke="${SOFT}" stroke-width="1.8"/>`;
}

/** صفحه‌ی برش/ساب — ضخامت با فاصله‌ی دو بیضی نشان داده می‌شود */
function disc(r, thick) {
  return `
    <ellipse cx="196" cy="150" rx="${r * 0.34}" ry="${r}"/>
    <ellipse cx="${196 + thick}" cy="150" rx="${r * 0.34}" ry="${r}"/>
    <path d="M196 ${150 - r} H${196 + thick} M196 ${150 + r} H${196 + thick}"/>
    <ellipse cx="196" cy="150" rx="${r * 0.1}" ry="${r * 0.3}" stroke="${SOFT}" stroke-width="2"/>
    <path d="M${196 - r * 0.2} 150 h${thick + r * 0.4}" stroke="${SOFT}" stroke-width="1.6" opacity=".6"/>`;
}

const ART = {
  // ---------------------------------------------------------- قفل و یراق
  'قفل حیاطی سپه کلید کامپیوتری': () => `
    <rect x="118" y="96" width="122" height="128" rx="8"/>
    <rect x="134" y="112" width="90" height="96" rx="5" stroke="${SOFT}" stroke-width="2"/>
    <circle cx="179" cy="146" r="15"/>
    <path d="M179 161 v26 M172 187 h14 M172 176 h10" stroke-width="2.4"/>
    <path d="M240 128 h44 v64 h-44" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M258 146 v28" stroke="${SOFT}" stroke-width="2"/>
    <path d="M118 116 h-18 M118 204 h-18" stroke="${SOFT}" stroke-width="2"/>`,

  'قفل سوییچی ۵.۵ آراد': () => `
    <rect x="132" y="118" width="136" height="72" rx="10"/>
    <circle cx="176" cy="154" r="17"/>
    <circle cx="176" cy="154" r="6" stroke="${SOFT}" stroke-width="2"/>
    <path d="M212 140 h40 M212 154 h40 M212 168 h28" stroke="${SOFT}" stroke-width="2"/>
    <path d="M132 154 h-28 M268 154 h20 l0 -14 l14 14 l-14 14 z" stroke-width="2.2"/>
    <path d="M150 190 v22 M250 190 v22" stroke="${SOFT}" stroke-width="2"/>`,

  'قفل سوییچی ۶.۵ میلاک': () => `
    <rect x="122" y="112" width="156" height="84" rx="10"/>
    <circle cx="170" cy="154" r="20"/>
    <circle cx="170" cy="154" r="7" stroke="${SOFT}" stroke-width="2"/>
    <path d="M206 136 h48 M206 154 h48 M206 172 h34" stroke="${SOFT}" stroke-width="2"/>
    <path d="M122 154 h-30 M278 154 h22 l0 -16 l16 16 l-16 16 z" stroke-width="2.2"/>
    <path d="M144 196 v20 M256 196 v20" stroke="${SOFT}" stroke-width="2"/>`,

  'لولای ساده دو پارچه': () => `
    <rect x="104" y="84" width="88" height="132" rx="4"/>
    <rect x="208" y="84" width="88" height="132" rx="4"/>
    <path d="M192 84 a14 14 0 0 1 0 28 a14 14 0 0 0 0 28 a14 14 0 0 1 0 28 a14 14 0 0 0 0 28 a14 14 0 0 1 0 20"/>
    <path d="M200 84 V216" stroke="${SOFT}" stroke-width="2"/>
    ${[112, 152, 192].map((y) => `<circle cx="140" cy="${y}" r="6" stroke="${SOFT}" stroke-width="2"/>`).join('\n    ')}
    ${[112, 152, 192].map((y) => `<circle cx="260" cy="${y}" r="6" stroke="${SOFT}" stroke-width="2"/>`).join('\n    ')}`,

  'لولای ۳ پارچه بلبرینگی': () => `
    <rect x="104" y="84" width="88" height="132" rx="4"/>
    <rect x="208" y="84" width="88" height="132" rx="4"/>
    <path d="M192 84 h16 v44 h-16 z M192 128 h16 v44 h-16 z M192 172 h16 v44 h-16 z"/>
    <circle cx="200" cy="128" r="11" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="200" cy="128" r="4.5" stroke="${SOFT}" stroke-width="2"/>
    <circle cx="200" cy="172" r="11" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="200" cy="172" r="4.5" stroke="${SOFT}" stroke-width="2"/>
    ${[110, 150, 190].map((y) => `<circle cx="140" cy="${y}" r="6" stroke="${SOFT}" stroke-width="2"/>`).join('\n    ')}
    ${[110, 150, 190].map((y) => `<circle cx="260" cy="${y}" r="6" stroke="${SOFT}" stroke-width="2"/>`).join('\n    ')}`,

  'کرپی': () => `
    <path d="M148 88 v54 a52 52 0 0 0 104 0 V88"/>
    <path d="M148 88 v-14 M252 88 v-14" stroke-width="2.4"/>
    <path d="M132 196 h136 v22 h-136 z" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M148 196 v-38 M252 196 v-38"/>
    <path d="M148 218 v18 M252 218 v18" stroke="${SOFT}" stroke-width="2"/>
    <path d="M138 226 h20 M242 226 h20" stroke="${SOFT}" stroke-width="2"/>`,

  'اسکوپ پروانه‌ای': () => `
    <path d="M200 108 v84"/>
    <path d="M200 128 c-38 -30 -74 -6 -58 22 c12 22 44 16 58 -6"/>
    <path d="M200 128 c38 -30 74 -6 58 22 c-12 22 -44 16 -58 -6"/>
    <circle cx="200" cy="150" r="9" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M200 192 l-12 22 h24 z" stroke="${SOFT}" stroke-width="2.2"/>`,

  'اسکوپ زد': () => `
    <path d="M120 106 h96 v44 h72 v44 h-96 v-44 h-72 z" stroke-width="2.8"/>
    <path d="M120 106 v-16 M288 194 v16" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="152" cy="128" r="7" stroke="${SOFT}" stroke-width="2"/>
    <circle cx="256" cy="172" r="7" stroke="${SOFT}" stroke-width="2"/>`,

  'اسپیسر ۵ سانتی‌متر': () => `
    <path d="M140 196 h120 l-18 -74 h-84 z"/>
    <path d="M158 122 h84" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="200" cy="112" r="11" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M108 112 h81 M211 112 h81" stroke="${SOFT}" stroke-width="2.4"/>
    <path d="M120 196 h160" stroke="${SOFT}" stroke-width="1.8" opacity=".6"/>
    <path d="M296 122 V196 M290 122 h12 M290 196 h12" stroke="${SOFT}" stroke-width="1.8"/>`,

  'اسپیسر ۷.۵ سانتی‌متر': () => `
    <path d="M132 202 h136 l-22 -96 h-92 z"/>
    <path d="M154 106 h92" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="200" cy="96" r="11" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M104 96 h85 M211 96 h85" stroke="${SOFT}" stroke-width="2.4"/>
    <path d="M112 202 h176" stroke="${SOFT}" stroke-width="1.8" opacity=".6"/>
    <path d="M300 106 V202 M294 106 h12 M294 202 h12" stroke="${SOFT}" stroke-width="1.8"/>`,

  // ---------------------------------------------------------- توری
  'توری پرسی چشمه ۲×۲': () => mesh(16),
  'توری پرسی چشمه ۴×۴': () => mesh(32),

  // ---------------------------------------------------------- فوم
  'فوم ۱ سانت': () => foam(10),
  'فوم ۱.۵ سانت': () => foam(17),
  'فوم ۲ سانت': () => foam(24),

  // ---------------------------------------------------- ابزار و مصرفی
  'الکترود ۳ میکا': () => `
    ${[0, 1, 2].map((i) => {
      const x = 150 + i * 34;
      return `<path d="M${x} 78 V212" stroke-width="7"/>
    <path d="M${x} 212 V236" stroke="${SOFT}" stroke-width="4"/>`;
    }).join('\n    ')}
    <path d="M132 96 h124" stroke="${SOFT}" stroke-width="1.8" opacity=".5"/>
    <path d="M304 78 V236 M298 78 h12 M298 236 h12" stroke="${SOFT}" stroke-width="1.8"/>`,

  'الکترود ۴ میکا': () => `
    ${[0, 1, 2].map((i) => {
      const x = 148 + i * 38;
      return `<path d="M${x} 68 V216" stroke-width="9.5"/>
    <path d="M${x} 216 V242" stroke="${SOFT}" stroke-width="5"/>`;
    }).join('\n    ')}
    <path d="M128 88 h136" stroke="${SOFT}" stroke-width="1.8" opacity=".5"/>
    <path d="M308 68 V242 M302 68 h12 M302 242 h12" stroke="${SOFT}" stroke-width="1.8"/>`,

  'استیل بر بزرگ': () => disc(78, 7),
  'استیل بر مینی': () => disc(48, 5),
  'صفحه ساب اوآسیس': () => disc(74, 18),

  'چسب ماستیک ۲۲': () => `
    <path d="M144 108 h92 v112 a10 10 0 0 1 -10 10 h-72 a10 10 0 0 1 -10 -10 z"/>
    <path d="M170 108 V84 h40 v24" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M182 84 l8 -26 h0 l8 26" stroke-width="2.4"/>
    <path d="M156 140 h68 M156 160 h68 M156 180 h48" stroke="${SOFT}" stroke-width="2"/>
    <path d="M252 128 v96" stroke="${SOFT}" stroke-width="2"/>
    <path d="M246 128 h12 M246 224 h12" stroke="${SOFT}" stroke-width="2"/>`,

  'متر ۵ متری اسیست': () => `
    <rect x="120" y="112" width="118" height="104" rx="14"/>
    <circle cx="179" cy="164" r="30" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="179" cy="164" r="10"/>
    <path d="M238 140 h64 l0 26 h-64" stroke-width="2.4"/>
    <path d="M250 140 v26 M266 140 v18 M282 140 v26" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M138 216 v14 h82 v-14" stroke="${SOFT}" stroke-width="2"/>`,

  'متر ۵ متری فیسکو': () => `
    <rect x="126" y="106" width="112" height="112" rx="18"/>
    <circle cx="182" cy="162" r="34" stroke="${SOFT}" stroke-width="2.2"/>
    <circle cx="182" cy="162" r="11"/>
    <path d="M238 146 h68 l0 24 h-68" stroke-width="2.4"/>
    <path d="M252 146 v24 M268 146 v16 M284 146 v24" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M150 106 h64" stroke="${SOFT}" stroke-width="2"/>`,

  // ------------------------------------------------- ورق ناودان و چوب
  'ورق ناودان عرض ۱ متر': () => `
    <path d="M96 108 v84 h32 v-52 h144 v52 h32 v-84" stroke-width="3"/>
    <path d="M96 108 l24 -22 v84 M304 108 l24 -22 v84" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M120 86 h208" stroke="${SOFT}" stroke-width="2.2"/>
    <path d="M128 140 h144" stroke="${SOFT}" stroke-width="1.8" opacity=".6"/>
    <path d="M96 226 H304" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M96 220v12M304 220v12" stroke="${SOFT}" stroke-width="1.8"/>`,

  'چوب نراد ۳×۵': () => `
    <path d="M104 168 h168 v40 h-168 z"/>
    <path d="M104 168 l28 -26 h168 l-28 26 M272 168 l28 -26 v40 l-28 26"/>
    <path d="M118 178 c40 -8 90 6 140 -2 M118 192 c46 8 96 -8 140 0" stroke="${SOFT}" stroke-width="1.6" opacity=".8"/>
    <path d="M104 232 H272" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M104 226v12M272 226v12" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M318 142 V208" stroke="${SOFT}" stroke-width="1.8"/>
    <path d="M312 142 h12 M312 208 h12" stroke="${SOFT}" stroke-width="1.8"/>`,
};

// اسلاگ‌ساز باید دقیقاً همان چیزی باشد که سایت استفاده می‌کند
const { slugify } = require('../src/utils/slug');

fs.mkdirSync(OUT, { recursive: true });
let n = 0;
for (const [name, build] of Object.entries(ART)) {
  fs.writeFileSync(path.join(OUT, `${slugify(name)}.svg`), wrap(build()));
  n++;
}
console.log(`${n} تصویرسازی ساخته شد در ${OUT}`);
