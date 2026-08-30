/**
 * تولید تصویرسازی خطی اختصاصی برای هر دسته‌ی محصول.
 * چون هنوز عکس واقعی محصولات وجود ندارد، به‌جای یک placeholder خاکستری
 * برای همه، هر دسته یک تصویر خطی منحصربه‌فرد می‌گیرد. این هم گرید را
 * «طراحی‌شده» نشان می‌دهد، هم صادقانه است (واضحاً تصویرسازی است نه عکس).
 */
const fs = require('fs');
const path = require('path');

const OUT = '/home/user/Book/public/img/cat';
fs.mkdirSync(OUT, { recursive: true });

const RUST = '#A8431A';
const COPPER = '#C0763C';
const BG = '#FBF7F3';
const INK = '#8C5A3C';

/** قاب مشترک: پس‌زمینه‌ی کرم گرم + شبکه‌ی بسیار محو + هاله‌ی گوشه */
const frame = (body, extraDefs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img">
  <defs>
    <pattern id="g" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M20 0H0v20" fill="none" stroke="${RUST}" stroke-width=".5" opacity=".07"/>
    </pattern>
    <radialGradient id="glow" cx="78%" cy="18%" r="70%">
      <stop offset="0" stop-color="${COPPER}" stop-opacity=".16"/>
      <stop offset="1" stop-color="${COPPER}" stop-opacity="0"/>
    </radialGradient>
    ${extraDefs}
  </defs>
  <rect width="400" height="300" fill="${BG}"/>
  <rect width="400" height="300" fill="url(#g)"/>
  <rect width="400" height="300" fill="url(#glow)"/>
  <g fill="none" stroke="${RUST}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
${body}
  </g>
</svg>
`;

const files = {};

// ─────────────────────────────────────────────── ۱) قوطی — مقطع مربعی توخالی
files['qooti'] = frame(`
    <!-- وجه جلو -->
    <rect x="118" y="112" width="126" height="126" rx="4"/>
    <rect x="146" y="140" width="70" height="70" rx="3" stroke="${COPPER}"/>
    <!-- عمق (ایزومتریک) -->
    <path d="M118 112 L172 70 H298 L244 112"/>
    <path d="M244 112 L298 70 V196 L244 238"/>
    <path d="M146 140 L200 98 H270" stroke="${COPPER}" stroke-width="2"/>
    <path d="M216 140 L270 98" stroke="${COPPER}" stroke-width="2"/>
    <!-- خط اندازه -->
    <path d="M118 258 H244" stroke="${INK}" stroke-width="1.6" opacity=".55"/>
    <path d="M118 252v12M244 252v12" stroke="${INK}" stroke-width="1.6" opacity=".55"/>
`);

// ─────────────────────────────────────────────── ۲) پروفیل نبشی — مقطع L
files['nabshi'] = frame(`
    <!-- مقطع L جلو -->
    <path d="M128 92 h30 v112 h108 v30 H128 Z"/>
    <!-- عمق -->
    <path d="M128 92 L178 56 h30 L158 92"/>
    <path d="M158 204 L208 168 h58"/>
    <path d="M266 204 L316 168 v30 L266 234"/>
    <path d="M208 56 v112 h108" stroke="${COPPER}" stroke-width="2"/>
    <path d="M316 168 L316 198" />
    <!-- گونیا -->
    <path d="M150 218 h18 v-18" stroke="${COPPER}" stroke-width="2"/>
`);

// ─────────────────────────────────────────────── ۳) رابیتس — شبکه‌ی رومبی
{
  let mesh = '';
  for (let i = 0; i < 9; i++) {
    for (let j = 0; j < 6; j++) {
      const x = 90 + i * 26;
      const y = 76 + j * 26 + (i % 2 ? 13 : 0);
      mesh += `    <path d="M${x} ${y} l13 8 l-13 8 l-13 -8 Z" stroke="${i % 2 ? COPPER : RUST}" stroke-width="1.9"/>\n`;
    }
  }
  files['rabits'] = frame(`
    <clipPath id="c"><rect x="82" y="62" width="236" height="176" rx="6"/></clipPath>
    <g clip-path="url(#c)">
${mesh}    </g>
    <rect x="82" y="62" width="236" height="176" rx="6" stroke-width="3"/>
    <!-- گوشه‌ی تاخورده -->
    <path d="M282 62 q36 26 36 58" stroke="${COPPER}" stroke-width="2.2"/>
`);
}

// ─────────────────────────────────────────────── ۴) شاخ گوزنی — حفاظ دیوار
files['shakh'] = frame(`
    <!-- دیوار -->
    <path d="M74 200 h252 v58 H74 Z"/>
    <path d="M74 229 h252" stroke-width="1.8" opacity=".8"/>
    <path d="M126 200v29M200 200v29M274 200v29M100 229v29M164 229v29M236 229v29M300 229v29"
          stroke-width="1.6" opacity=".6"/>
    <!-- سه پایه‌ی شاخ گوزنی -->
    <g stroke="${RUST}">
      <path d="M126 200 V150"/><path d="M126 158 l-26 -32M126 158 l26 -32M126 172 V132"/>
      <path d="M200 200 V138"/><path d="M200 148 l-30 -36M200 148 l30 -36M200 164 V118"/>
      <path d="M274 200 V150"/><path d="M274 158 l-26 -32M274 158 l26 -32M274 172 V132"/>
    </g>
    <!-- نوک‌ها -->
    <g fill="${COPPER}" stroke="none">
      <path d="M100 126 l7 12 l-13 2z"/><path d="M152 126 l-7 12 l13 2z"/>
      <path d="M170 112 l8 13 l-14 2z"/><path d="M230 112 l-8 13 l14 2z"/>
      <path d="M248 126 l7 12 l-13 2z"/><path d="M300 126 l-7 12 l13 2z"/>
    </g>
`);

// ─────────────────────────────────────────────── ۵) فنس و توری — توری حصاری
{
  let net = '';
  for (let i = -6; i <= 12; i++) net += `    <path d="M${88 + i * 30} 66 L${88 + i * 30 + 174} 240"/>\n`;
  for (let i = -6; i <= 12; i++) net += `    <path d="M${88 + i * 30} 240 L${88 + i * 30 + 174} 66"/>\n`;
  files['fence'] = frame(`
    <clipPath id="cf"><rect x="112" y="66" width="176" height="174"/></clipPath>
    <g clip-path="url(#cf)" stroke="${COPPER}" stroke-width="1.8" opacity=".95">
${net}    </g>
    <!-- پایه‌ها و ریل -->
    <path d="M100 54 v210M300 54 v210" stroke-width="4"/>
    <path d="M96 66 h208M96 240 h208" stroke-width="3"/>
    <path d="M100 54 q100 -14 200 0" stroke-width="2.4" stroke="${COPPER}"/>
`);
}

// ─────────────────────────────────────────────── ۶) ایزوگام و عایق — رول
files['izogam'] = frame(`
    <!-- ورق باز شده -->
    <path d="M182 108 L342 108 L342 214 L182 214"/>
    <path d="M182 214 q80 -12 160 0" stroke-width="2" stroke="${COPPER}"/>
    <path d="M212 108 v106M252 108 v106M292 108 v106" stroke-width="1.4" stroke="${COPPER}" opacity=".7"/>
    <!-- رول -->
    <ellipse cx="132" cy="161" rx="26" ry="53"/>
    <path d="M132 108 h50M132 214 h50"/>
    <ellipse cx="132" cy="161" rx="12" ry="24" stroke="${COPPER}" stroke-width="2"/>
    <path d="M132 137 a12 24 0 0 1 0 48" stroke="${COPPER}" stroke-width="2"/>
    <!-- قطرات (ضدآب) -->
    <g stroke="${COPPER}" stroke-width="2">
      <path d="M232 82 q-8 -12 0 -20 q8 8 0 20"/>
      <path d="M282 74 q-7 -10 0 -17 q7 7 0 17"/>
    </g>
`);

// ─────────────────────────────────────────────── ۷) ورق گالوانیزه — طرح سفال
{
  let ribs = '';
  for (let i = 0; i < 6; i++) {
    const x = 86 + i * 40;
    ribs += `    <path d="M${x} 214 L${x + 22} 174 L${x + 40} 214"/>\n`;
    ribs += `    <path d="M${x + 30} 146 L${x + 52} 106 L${x + 70} 146" opacity=".55"/>\n`;
  }
  files['varagh'] = frame(`
    <!-- سقف شیب‌دار -->
    <path d="M60 232 L164 92 h176 L236 232 Z" stroke-width="3"/>
    <g stroke="${COPPER}" stroke-width="2.2">
${ribs}    </g>
    <path d="M60 232 h176M164 92 h176" stroke-width="3" stroke="${RUST}"/>
    <path d="M236 232 L340 92" stroke-width="3" stroke="${RUST}"/>
`);
}

// ─────────────────────────────────────────────── ۸) پیچ و یراق‌آلات
files['pich'] = frame(`
    <!-- پیچ سرمته -->
    <g transform="rotate(-18 150 150)">
      <path d="M126 74 h48 v20 h-48 Z"/>
      <path d="M138 94 h24 v104 h-24 Z" stroke="${COPPER}" stroke-width="2"/>
      <path d="M138 108 l24 10M138 128 l24 10M138 148 l24 10M138 168 l24 10"
            stroke="${COPPER}" stroke-width="2"/>
      <path d="M150 198 l14 26 l-28 0 Z" fill="${RUST}" stroke="none"/>
      <path d="M132 78 h36" stroke-width="2"/>
    </g>
    <!-- قفل -->
    <rect x="228" y="152" width="106" height="82" rx="10"/>
    <path d="M248 152 v-22 a33 33 0 0 1 66 0 v22" stroke-width="3"/>
    <circle cx="281" cy="186" r="11" stroke="${COPPER}" stroke-width="2.4"/>
    <path d="M281 197 v18" stroke="${COPPER}" stroke-width="2.4"/>
`);

// ─────────────────────────────────────────────── ۹) فرفورژه — گل و طرح
files['ferforzhe'] = frame(`
    <!-- قاب نرده -->
    <path d="M76 54 h248M76 246 h248" stroke-width="3"/>
    <path d="M112 54 v192M200 54 v192M288 54 v192" stroke-width="2.2" opacity=".85"/>
    <!-- حلزونی‌های قرینه‌ی بالا -->
    <path d="M200 116 c0-26 22-44 44-34 s16 42-8 42 c-20 0-30-24-14-36"/>
    <path d="M200 116 c0-26-22-44-44-34 s-16 42 8 42 c20 0 30-24 14-36"/>
    <!-- پایین -->
    <path d="M200 184 c0 26 22 44 44 34 s16-42-8-42 c-20 0-30 24-14 36"/>
    <path d="M200 184 c0 26-22 44-44 34 s-16-42 8-42 c20 0 30 24 14 36"/>
    <!-- برگ مرکزی -->
    <path d="M200 134 c-22 6-34 16-34 16 s12 10 34 16 c22-6 34-16 34-16 s-12-10-34-16Z"
          stroke="${COPPER}" stroke-width="2.2"/>
    <circle cx="200" cy="150" r="6" fill="${RUST}" stroke="none"/>
    <!-- حلزونی گوشه -->
    <path d="M112 92 c-14 0-22 10-18 20 s18 8 18-4" stroke="${COPPER}" stroke-width="2"/>
    <path d="M288 208 c14 0 22-10 18-20 s-18-8-18 4" stroke="${COPPER}" stroke-width="2"/>
`);

// ─────────────────────────────────────────── تصویر پیش‌فرض (دسته‌ی ناشناس)
files['default'] = frame(`
    <path d="M200 74 L306 132 v112 L200 226 L94 244 V132 Z" stroke-width="2.6"/>
    <path d="M94 132 L200 190 L306 132M200 190 v96" stroke-width="2.2" stroke="${COPPER}"/>
    <path d="M147 103 L253 161" stroke-width="1.8" stroke="${COPPER}" opacity=".7"/>
`);

let total = 0;
for (const [name, svg] of Object.entries(files)) {
  const p = path.join(OUT, name + '.svg');
  fs.writeFileSync(p, svg);
  total += Buffer.byteLength(svg);
  console.log(`  ${name}.svg  ${Math.round(Buffer.byteLength(svg) / 102.4) / 10}KB`);
}
console.log(`\nمجموع: ${Object.keys(files).length} فایل، ${Math.round(total / 1024)}KB`);
