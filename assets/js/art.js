/* =============================================================
   art.js — تصویرسازی برداری (SVG) قطعات جواهر و آیکون‌ها
   همه‌ی گرادیان‌ها یک‌بار در <body> تزریق می‌شوند و آثار به آن‌ها ارجاع می‌دهند.
   ============================================================= */

export const GRADIENT_DEFS = `
<svg width="0" height="0" aria-hidden="true" focusable="false" style="position:absolute">
  <defs>
    <linearGradient id="zgYellow" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#7d5e14"/><stop offset="22%" stop-color="#f0dc9a"/>
      <stop offset="44%" stop-color="#fff6d6"/><stop offset="60%" stop-color="#d4af37"/>
      <stop offset="80%" stop-color="#9d7a1e"/><stop offset="100%" stop-color="#e6cd7d"/>
    </linearGradient>
    <linearGradient id="zgRose" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#8a4a3c"/><stop offset="26%" stop-color="#f3cbbd"/>
      <stop offset="50%" stop-color="#ffeae2"/><stop offset="68%" stop-color="#d98a72"/>
      <stop offset="100%" stop-color="#a35a48"/>
    </linearGradient>
    <linearGradient id="zgWhite" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#6f7784"/><stop offset="26%" stop-color="#eef2f8"/>
      <stop offset="52%" stop-color="#ffffff"/><stop offset="72%" stop-color="#c4ccd8"/>
      <stop offset="100%" stop-color="#828b98"/>
    </linearGradient>
    <radialGradient id="zgDiamond" cx="42%" cy="34%" r="72%">
      <stop offset="0%"  stop-color="#ffffff"/><stop offset="42%" stop-color="#dfe9ff"/>
      <stop offset="76%" stop-color="#9fb4e0"/><stop offset="100%" stop-color="#e8f0ff"/>
    </radialGradient>
    <radialGradient id="zgRuby" cx="40%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#ff8fa8"/><stop offset="45%" stop-color="#d61f4a"/><stop offset="100%" stop-color="#77081f"/>
    </radialGradient>
    <radialGradient id="zgEmerald" cx="40%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#7ff0bd"/><stop offset="45%" stop-color="#12a469"/><stop offset="100%" stop-color="#064d31"/>
    </radialGradient>
    <radialGradient id="zgSapphire" cx="40%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#8fb4ff"/><stop offset="45%" stop-color="#2b5ce6"/><stop offset="100%" stop-color="#0e2472"/>
    </radialGradient>
    <radialGradient id="zgAmethyst" cx="40%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#d7aef5"/><stop offset="45%" stop-color="#8b4fd6"/><stop offset="100%" stop-color="#3c1a6b"/>
    </radialGradient>
    <radialGradient id="zgCitrine" cx="40%" cy="32%" r="72%">
      <stop offset="0%" stop-color="#ffe3a0"/><stop offset="45%" stop-color="#e0a11a"/><stop offset="100%" stop-color="#7c5405"/>
    </radialGradient>
    <radialGradient id="zgPearl" cx="36%" cy="30%" r="74%">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#f0e7de"/><stop offset="100%" stop-color="#c9bcae"/>
    </radialGradient>
    <filter id="zgSoft" x="-40%" y="-40%" width="180%" height="180%">
      <feGaussianBlur stdDeviation="3.4" result="b"/>
      <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
</svg>`;

const METAL_URL = { yellow: 'url(#zgYellow)', rose: 'url(#zgRose)', white: 'url(#zgWhite)' };
const GEM_URL = {
  diamond: 'url(#zgDiamond)', ruby: 'url(#zgRuby)', emerald: 'url(#zgEmerald)',
  sapphire: 'url(#zgSapphire)', amethyst: 'url(#zgAmethyst)', citrine: 'url(#zgCitrine)',
};

/* یک نگین تراش‌خورده‌ی برلیان در مختصات دلخواه */
function gem(cx, cy, r, fill) {
  // نمای روبه‌روی تراش برلیان: تیبل پهن در بالا، کمربند، و پاویون که به کولت می‌رسد
  const T = r * 0.50, G = r, gy = -r * 0.26, ty = -r * 0.74, cy2 = r * 0.98;
  return `
  <g transform="translate(${cx} ${cy})">
    <polygon points="${-T},${ty} ${T},${ty} ${G},${gy} ${G * 0.62},${r * 0.30} 0,${cy2} ${-G * 0.62},${r * 0.30} ${-G},${gy}"
             fill="${fill}" stroke="rgba(255,255,255,.55)" stroke-width=".9" stroke-linejoin="round"/>
    <polygon points="${-T},${ty} ${T},${ty} ${T * 0.86},${gy} ${-T * 0.86},${gy}" fill="rgba(255,255,255,.34)"/>
    <g stroke="rgba(255,255,255,.45)" stroke-width=".7" fill="none">
      <path d="M${-T},${ty} L${-T * 0.86},${gy} M${T},${ty} L${T * 0.86},${gy}"/>
      <path d="M${-G},${gy} L${G},${gy}"/>
      <path d="M${-G * 0.55},${gy} L0,${cy2} M${G * 0.55},${gy} L0,${cy2} M0,${gy} L0,${cy2}"/>
      <path d="M${-G * 0.62},${r * 0.30} L${G * 0.62},${r * 0.30}" opacity=".55"/>
    </g>
  </g>`;
}
function sparkle(x, y, s, o = .9) {
  return `<path d="M${x} ${y - s} Q${x + s * .18} ${y - s * .18} ${x + s} ${y} Q${x + s * .18} ${y + s * .18} ${x} ${y + s} Q${x - s * .18} ${y + s * .18} ${x - s} ${y} Q${x - s * .18} ${y - s * .18} ${x} ${y - s} Z" fill="#fff" opacity="${o}"/>`;
}

/* ---------------------- طرح‌های قطعات ---------------------- */
const ART = {
  ring: (m, g) => `
    <ellipse cx="100" cy="126" rx="52" ry="54" fill="none" stroke="${m}" stroke-width="13"/>
    <ellipse cx="100" cy="126" rx="52" ry="54" fill="none" stroke="rgba(255,255,255,.28)" stroke-width="2.6"/>
    <path d="M70 84 Q100 62 130 84" fill="none" stroke="${m}" stroke-width="9" stroke-linecap="round"/>
    <path d="M84 76 L84 62 M116 76 L116 62 M92 70 L92 58 M108 70 L108 58" stroke="${m}" stroke-width="3.4" stroke-linecap="round"/>
    ${gem(100, 54, 27, g)}
    ${sparkle(133, 40, 8)}${sparkle(70, 34, 5.6, .75)}${sparkle(146, 74, 4.4, .6)}`,

  necklace: (m, g) => `
    <path d="M42 34 Q100 128 158 34" fill="none" stroke="${m}" stroke-width="6" stroke-linecap="round"/>
    <path d="M42 34 Q100 128 158 34" fill="none" stroke="rgba(255,255,255,.32)" stroke-width="1.6" stroke-linecap="round"/>
    <circle cx="63" cy="70" r="3.6" fill="${m}"/><circle cx="82" cy="97" r="3.6" fill="${m}"/>
    <circle cx="118" cy="97" r="3.6" fill="${m}"/><circle cx="137" cy="70" r="3.6" fill="${m}"/>
    <circle cx="100" cy="112" r="6" fill="none" stroke="${m}" stroke-width="3.6"/>
    <path d="M100 118 L100 128" stroke="${m}" stroke-width="3.4"/>
    ${gem(100, 152, 26, g)}
    <circle cx="100" cy="152" r="34" fill="none" stroke="${m}" stroke-width="2.4" opacity=".55"/>
    ${sparkle(140, 128, 7)}${sparkle(58, 132, 5, .7)}`,

  earring: (m, g) => `
    <g>
      <path d="M62 40 a18 18 0 1 1 0 .1" fill="none" stroke="${m}" stroke-width="6"/>
      <path d="M62 58 L62 84" stroke="${m}" stroke-width="4"/>
      ${gem(62, 108, 24, g)}
      <path d="M62 132 L62 144" stroke="${m}" stroke-width="3"/>
      <circle cx="62" cy="153" r="8" fill="${m}"/>
    </g>
    <g>
      <path d="M138 40 a18 18 0 1 1 0 .1" fill="none" stroke="${m}" stroke-width="6"/>
      <path d="M138 58 L138 84" stroke="${m}" stroke-width="4"/>
      ${gem(138, 108, 24, g)}
      <path d="M138 132 L138 144" stroke="${m}" stroke-width="3"/>
      <circle cx="138" cy="153" r="8" fill="${m}"/>
    </g>
    ${sparkle(100, 56, 7)}${sparkle(100, 150, 5, .6)}`,

  bracelet: (m, g) => `
    <ellipse cx="100" cy="100" rx="66" ry="52" fill="none" stroke="${m}" stroke-width="11" stroke-dasharray="17 8" stroke-linecap="round"/>
    <ellipse cx="100" cy="100" rx="66" ry="52" fill="none" stroke="rgba(255,255,255,.26)" stroke-width="2.4" stroke-dasharray="17 8" stroke-linecap="round"/>
    <rect x="79" y="30" width="42" height="26" rx="12" fill="${m}"/>
    <rect x="86" y="37" width="28" height="12" rx="6" fill="rgba(255,255,255,.3)"/>
    ${gem(100, 100, 25, g)}
    ${sparkle(158, 66, 7)}${sparkle(40, 138, 5.4, .7)}`,

  bangle: (m) => `
    <circle cx="100" cy="100" r="66" fill="none" stroke="${m}" stroke-width="16"/>
    <circle cx="100" cy="100" r="66" fill="none" stroke="rgba(255,255,255,.3)" stroke-width="3"/>
    <circle cx="100" cy="100" r="58" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.6"/>
    <circle cx="100" cy="100" r="74" fill="none" stroke="rgba(0,0,0,.22)" stroke-width="1.6"/>
    <g stroke="rgba(255,255,255,.36)" stroke-width="2.2" stroke-linecap="round">
      <path d="M100 34 l0 0"/><path d="M148 52 l6 -6"/><path d="M52 52 l-6 -6"/>
      <path d="M166 100 l8 0"/><path d="M34 100 l-8 0"/>
      <path d="M148 148 l6 6"/><path d="M52 148 l-6 6"/><path d="M100 166 l0 8"/>
    </g>
    ${sparkle(146, 54, 8)}${sparkle(52, 148, 5.5, .65)}`,

  coin: (m) => `
    <circle cx="100" cy="100" r="72" fill="${m}"/>
    <circle cx="100" cy="100" r="72" fill="none" stroke="rgba(0,0,0,.3)" stroke-width="2"/>
    <circle cx="100" cy="100" r="62" fill="none" stroke="rgba(0,0,0,.26)" stroke-width="3"/>
    <circle cx="100" cy="100" r="55" fill="rgba(255,255,255,.14)"/>
    <g fill="none" stroke="rgba(0,0,0,.4)" stroke-width="3" stroke-linecap="round">
      <path d="M100 66 Q118 84 100 102 Q82 120 100 138"/>
      <path d="M78 84 Q100 100 78 116"/><path d="M122 84 Q100 100 122 116"/>
    </g>
    <g stroke="rgba(0,0,0,.22)" stroke-width="2">
      ${Array.from({ length: 36 }, (_, i) => {
        const a = (i / 36) * Math.PI * 2;
        return `<path d="M${100 + Math.cos(a) * 66} ${100 + Math.sin(a) * 66} L${100 + Math.cos(a) * 72} ${100 + Math.sin(a) * 72}"/>`;
      }).join('')}
    </g>
    ${sparkle(140, 52, 9)}${sparkle(58, 146, 6, .7)}`,

  set: (m, g) => `
    <path d="M46 30 Q100 112 154 30" fill="none" stroke="${m}" stroke-width="5.4" stroke-linecap="round"/>
    ${gem(100, 122, 22, g)}
    <circle cx="100" cy="122" r="30" fill="none" stroke="${m}" stroke-width="2.2" opacity=".5"/>
    <g>
      <path d="M36 118 L36 136" stroke="${m}" stroke-width="3.4"/>${gem(36, 152, 15, g)}
      <path d="M164 118 L164 136" stroke="${m}" stroke-width="3.4"/>${gem(164, 152, 15, g)}
    </g>
    ${sparkle(132, 66, 7)}${sparkle(66, 70, 5, .7)}${sparkle(100, 176, 5, .6)}`,

  pendant: (m, g) => `
    <path d="M50 26 Q100 96 150 26" fill="none" stroke="${m}" stroke-width="5" stroke-linecap="round"/>
    <circle cx="100" cy="84" r="9" fill="none" stroke="${m}" stroke-width="4"/>
    <path d="M100 93 L100 104" stroke="${m}" stroke-width="3.4"/>
    <path d="M100 104 L142 132 L124 178 L76 178 L58 132 Z" fill="${m}" opacity=".95"/>
    <path d="M100 104 L142 132 L124 178 L76 178 L58 132 Z" fill="none" stroke="rgba(255,255,255,.35)" stroke-width="2"/>
    ${gem(100, 144, 21, g)}
    ${sparkle(146, 100, 7)}${sparkle(56, 104, 5, .7)}`,
};

/**
 * ساخت SVG یک قطعه
 * @param {string} kind کلید طرح (ring, necklace, ...)
 * @param {object} o { metal:'yellow'|'rose'|'white', gem:'diamond'|null, size:number, cls:string }
 */
export function jewelSVG(kind, o = {}) {
  const metal = METAL_URL[o.metal] || METAL_URL.yellow;
  const g = GEM_URL[o.gem] || GEM_URL.diamond;
  const body = (ART[kind] || ART.ring)(metal, g);
  return `<svg viewBox="0 0 200 200" class="${o.cls || ''}" role="img" aria-label="${o.alt || 'تصویر قطعه'}" xmlns="http://www.w3.org/2000/svg">
    <g filter="url(#zgSoft)">${body}</g>
  </svg>`;
}

/* --------------------------- آیکون‌ها --------------------------- */
const I = (d, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}${extra}</svg>`;

export const ICONS = {
  search:   I('<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>'),
  cart:     I('<path d="M3 4h2l2.4 11.2a2 2 0 0 0 2 1.6h7.7a2 2 0 0 0 2-1.55L21 8H6"/><circle cx="10" cy="20" r="1.4"/><circle cx="18" cy="20" r="1.4"/>'),
  heart:    I('<path d="M12 20.2 4.6 13a4.6 4.6 0 0 1 6.5-6.5l.9.9.9-.9A4.6 4.6 0 1 1 19.4 13Z"/>'),
  user:     I('<circle cx="12" cy="8" r="3.6"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0"/>'),
  menu:     I('<path d="M4 7h16M4 12h16M4 17h10"/>'),
  close:    I('<path d="M6 6l12 12M18 6L6 18"/>'),
  plus:     I('<path d="M12 5v14M5 12h14"/>'),
  minus:    I('<path d="M5 12h14"/>'),
  chevDown: I('<path d="m6 9 6 6 6-6"/>'),
  chevLeft: I('<path d="m14 6-6 6 6 6"/>'),
  chevRight:I('<path d="m10 6 6 6-6 6"/>'),
  arrowL:   I('<path d="M19 12H5M11 6l-6 6 6 6"/>'),
  arrowR:   I('<path d="M5 12h14M13 6l6 6-6 6"/>'),
  star:     '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="m12 2.6 2.9 5.9 6.5.95-4.7 4.6 1.1 6.45L12 17.45 6.2 20.5l1.1-6.45-4.7-4.6 6.5-.95Z"/></svg>',
  check:    I('<path d="m5 12.5 4.5 4.5L19 7.5"/>'),
  shield:   I('<path d="M12 3 5 6v6c0 4.4 3 7.9 7 9 4-1.1 7-4.6 7-9V6Z"/><path d="m9 12 2 2 4-4"/>'),
  truck:    I('<path d="M2 7h11v9H2z"/><path d="M13 10h4l3 3v3h-7z"/><circle cx="6" cy="18" r="1.7"/><circle cx="17" cy="18" r="1.7"/>'),
  gem:      I('<path d="m6 3 6 0 6 0 3 5-9 13L3 8Z"/><path d="M3 8h18M9 3 6 8l6 13L18 8l-3-5"/>'),
  cert:     I('<rect x="4" y="3" width="16" height="13" rx="2"/><path d="M8 8h8M8 11.5h5"/><path d="m9 16 1 5 2-1.4L14 21l1-5"/>'),
  phone:    I('<path d="M6.5 3h3l1.5 4-2 1.5a12 12 0 0 0 6.5 6.5L17 13l4 1.5v3a2 2 0 0 1-2.2 2A17 17 0 0 1 3.5 5.2 2 2 0 0 1 5.5 3Z"/>'),
  mail:     I('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 7 8.5 6 8.5-6"/>'),
  map:      I('<path d="M12 21s7-6 7-11a7 7 0 1 0-14 0c0 5 7 11 7 11Z"/><circle cx="12" cy="10" r="2.6"/>'),
  clock:    I('<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>'),
  insta:    I('<rect x="3.5" y="3.5" width="17" height="17" rx="5"/><circle cx="12" cy="12" r="3.8"/><circle cx="16.9" cy="7.1" r="1.1" fill="currentColor" stroke="none"/>'),
  whatsapp: I('<path d="M20.5 11.6a8.4 8.4 0 0 1-12.4 7.4L3.5 20.5l1.6-4.5A8.4 8.4 0 1 1 20.5 11.6Z"/><path d="M9 9.2c0 3 2.4 5.4 5.3 5.4.5 0 1-.4 1-1l-.1-.9-1.7-.5-.8.9a4.6 4.6 0 0 1-2.3-2.3l.9-.8-.5-1.7-.9-.1c-.5 0-.9.4-.9 1Z"/>'),
  telegram: I('<path d="m21 4-2.8 15.3c-.2 1-.8 1.3-1.6.8l-4.4-3.2-2.1 2c-.3.3-.5.5-1 .5l.4-4.9L18 6.4c.3-.3-.1-.4-.5-.2L7.5 12.6l-4.3-1.3c-.9-.3-.9-.9.2-1.4l16.4-6.3c.8-.3 1.4.2 1.2 1Z"/>'),
  sun:      I('<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M19 5l-1.5 1.5M6.5 17.5 5 19"/>'),
  moon:     I('<path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>'),
  eye:      I('<path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/>'),
  rotate:   I('<path d="M3 12a9 9 0 0 1 15.5-6.2M21 12a9 9 0 0 1-15.5 6.2"/><path d="M18 3v3.5h-3.5M6 21v-3.5h3.5"/>'),
  sparkles: I('<path d="M12 3.5 13.6 8 18 9.6 13.6 11.2 12 15.7l-1.6-4.5L6 9.6 10.4 8Z"/><path d="M18.5 15.5 19.3 17.7 21.5 18.5 19.3 19.3 18.5 21.5 17.7 19.3 15.5 18.5 17.7 17.7Z"/>'),
  scale:    I('<path d="M12 4v16M7 20h10"/><path d="M4 9h6l-3 5a2.5 2.5 0 0 1-3-5ZM14 9h6l-3 5a2.5 2.5 0 0 1-3-5Z"/><path d="M12 5 5 8M12 5l7 3"/>'),
  ruler:    I('<rect x="2.5" y="8" width="19" height="8" rx="1.6"/><path d="M7 8v3M11 8v4M15 8v3M19 8v4"/>'),
  chat:     I('<path d="M20.5 12c0 4-3.8 7.2-8.5 7.2-1 0-2-.15-2.9-.42L4 20.5l1.1-3.4A6.9 6.9 0 0 1 3.5 12C3.5 8 7.3 4.8 12 4.8s8.5 3.2 8.5 7.2Z"/>'),
  arrowUp:  I('<path d="M12 20V5M6 11l6-6 6 6"/>'),
  play:     I('<circle cx="12" cy="12" r="9"/><path d="m10 8.5 6 3.5-6 3.5Z"/>'),
  spin3d:   I('<ellipse cx="12" cy="12" rx="9" ry="4"/><ellipse cx="12" cy="12" rx="4" ry="9"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>'),
  drag:     I('<path d="M9 6.5 12 3.5l3 3M9 17.5l3 3 3-3M6.5 9 3.5 12l3 3M17.5 9l3 3-3 3"/>'),
  filter:   I('<path d="M3 5h18l-7 8v6l-4 2v-8Z"/>'),
  grid:     I('<rect x="3.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.4"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.4"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.4"/>'),
  box:      I('<path d="m12 3 8 4.2v9.6L12 21l-8-4.2V7.2Z"/><path d="M4 7.2 12 11.5l8-4.3M12 11.5V21"/>'),
  refresh:  I('<path d="M3.5 12a8.5 8.5 0 0 1 14.5-6"/><path d="M18 3v3.5h-3.5"/><path d="M20.5 12a8.5 8.5 0 0 1-14.5 6"/><path d="M6 21v-3.5h3.5"/>'),
};

export const LOGO_MARK = `
<svg viewBox="0 0 64 64" class="logo__mark" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="zlm" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#8a6a1c"/><stop offset="30%" stop-color="#f6e6b0"/>
      <stop offset="55%" stop-color="#d4af37"/><stop offset="100%" stop-color="#9d7a1e"/>
    </linearGradient>
  </defs>
  <path d="M32 3 58 22 48 55H16L6 22Z" fill="none" stroke="url(#zlm)" stroke-width="2.6" stroke-linejoin="round"/>
  <path d="M6 22h52M32 3 20 22l12 33 12-33Z" fill="none" stroke="url(#zlm)" stroke-width="1.7" stroke-linejoin="round" opacity=".85"/>
  <path d="M20 22h24" stroke="url(#zlm)" stroke-width="1.4" opacity=".7"/>
  <circle cx="32" cy="30" r="3.2" fill="url(#zlm)"/>
</svg>`;

export function stars(rate) {
  let out = '';
  for (let i = 1; i <= 5; i++) out += `<span class="${i <= Math.round(rate) ? '' : 'off'}">${ICONS.star}</span>`;
  return `<span class="stars" aria-label="امتیاز ${rate} از ۵">${out}</span>`;
}
