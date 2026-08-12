/**
 * ممیزی خودکار طراحی بر اساس قواعد ui-ux-pro-max
 * اندازه‌گیری واقعی در مرورگر: کنتراست، اندازه‌ی هدف لمسی، اندازه‌ی فونت،
 * طول خط، سرفصل‌ها، alt، و لایه‌بندی z-index
 */
const { chromium } = require('playwright');
const B = process.argv[2] || 'http://localhost:3000';

const AUDIT = () => {
  // ---- محاسبه‌ی کنتراست WCAG
  const lum = (rgb) => {
    const [r, g, b] = rgb.map((v) => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const parse = (c) => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(',').map((x) => parseFloat(x));
    return { rgb: [p[0], p[1], p[2]], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (fg, bg) => fg.map((c, i) => c * 1 + bg[i] * 0); // placeholder
  const blend = (fg, a, bg) => fg.map((c, i) => c * a + bg[i] * (1 - a));
  const ratio = (a, b) => {
    const l1 = lum(a), l2 = lum(b);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  };
  // پس‌زمینه‌ی مؤثر یک عنصر (اولین والد با پس‌زمینه‌ی مات)
  const bgOf = (el) => {
    let n = el;
    while (n && n !== document.documentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0.85) return c.rgb;
      n = n.parentElement;
    }
    return [255, 255, 255];
  };

  const out = { contrast: [], touch: [], fontSize: [], noAlt: [], headings: [], zIndex: [], lineLen: [] };
  const seen = new Set();

  document.querySelectorAll('body *').forEach((el) => {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return;
    // نکته: display:none روی «والد» باعث نمی‌شود getComputedStyle فرزند هم
    // none برگرداند؛ برای همین باید جداگانه بررسی کنیم که عنصر واقعاً رندر
    // شده باشد. بدون این خط، دکمه‌های منوی موبایل (که روی دسکتاپ پنهان‌اند)
    // به‌عنوان «کنتراست ناکافی» گزارش می‌شدند و ایرادهای واقعی گم می‌شد.
    if (!el.getClientRects().length) return;
    const rect = el.getBoundingClientRect();

    // --- متن مستقیم دارد؟
    const ownText = Array.from(el.childNodes)
      .filter((n) => n.nodeType === 3)
      .map((n) => n.textContent.trim())
      .join(' ')
      .trim();

    if (ownText.length > 1) {
      const fs = parseFloat(cs.fontSize);
      const fw = parseInt(cs.fontWeight) || 400;
      const fg = parse(cs.color);
      if (fg) {
        const bg = bgOf(el);
        const eff = fg.a < 1 ? blend(fg.rgb, fg.a, bg) : fg.rgb;
        const r = ratio(eff, bg);
        const large = fs >= 24 || (fs >= 18.66 && fw >= 700);
        const need = large ? 3 : 4.5;
        const key = `${cs.color}|${fs}|${el.className}`;
        if (r < need && !seen.has(key)) {
          seen.add(key);
          out.contrast.push({
            sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ').slice(0, 2).join('.') : ''),
            color: cs.color, fontSize: fs, ratio: Math.round(r * 100) / 100, need,
            sample: ownText.slice(0, 30),
          });
        }
      }
      // اندازه‌ی فونت کوچک
      if (fs < 12 && !seen.has('fs' + fs + el.className)) {
        seen.add('fs' + fs + el.className);
        out.fontSize.push({ sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0], px: fs, sample: ownText.slice(0, 25) });
      }
    }

    // --- هدف لمسی
    if (/^(A|BUTTON|INPUT|SELECT|LABEL)$/.test(el.tagName) && rect.width > 0) {
      const inNav = el.closest('.breadcrumb, .footer-links, .prose');
      if (!inNav && (rect.height < 44 || rect.width < 44)) {
        out.touch.push({
          sel: el.tagName.toLowerCase() + (el.className ? '.' + String(el.className).split(' ')[0] : ''),
          w: Math.round(rect.width), h: Math.round(rect.height),
          text: (el.textContent || '').trim().slice(0, 20),
        });
      }
    }

    // --- z-index
    if (cs.zIndex !== 'auto' && cs.position !== 'static') {
      out.zIndex.push({ sel: el.tagName.toLowerCase() + '.' + String(el.className).split(' ')[0], z: cs.zIndex });
    }
  });

  // --- تصاویر بدون alt
  document.querySelectorAll('img').forEach((im) => {
    if (!im.hasAttribute('alt')) out.noAlt.push(im.src.slice(-40));
  });

  // --- ترتیب سرفصل‌ها
  document.querySelectorAll('h1,h2,h3,h4,h5,h6').forEach((h) => {
    out.headings.push({ tag: h.tagName, text: h.textContent.trim().slice(0, 40) });
  });

  // --- طول خط پاراگراف‌های اصلی
  document.querySelectorAll('p').forEach((p) => {
    const t = p.textContent.trim();
    if (t.length < 60) return;
    const w = p.getBoundingClientRect().width;
    const fs = parseFloat(getComputedStyle(p).fontSize);
    const chars = Math.round(w / (fs * 0.5)); // تقریب برای فارسی
    if (chars > 85) out.lineLen.push({ chars, width: Math.round(w), sample: t.slice(0, 30) });
  });

  return out;
};

(async () => {
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
  const pages = ['/', '/products', '/forge', '/about', '/reviews', '/contact'];

  for (const size of [{ n: 'دسکتاپ 1440', w: 1440, h: 900, m: false }, { n: 'موبایل 390', w: 390, h: 844, m: true }]) {
    const ctx = await b.newContext({ viewport: { width: size.w, height: size.h }, isMobile: size.m });
    const p = await ctx.newPage();
    const agg = { contrast: [], touch: [], fontSize: [], noAlt: [], zIndex: [], lineLen: [] };
    for (const url of pages) {
      await p.goto(B + url, { waitUntil: 'networkidle' });
      await p.evaluate(() => document.querySelectorAll('.reveal').forEach((e) => e.classList.add('in')));
      const r = await p.evaluate(AUDIT);
      for (const k of Object.keys(agg)) if (r[k]) agg[k] = agg[k].concat(r[k].map((x) => ({ ...x, page: url })));
    }
    console.log('\n══════════════════ ' + size.n + ' ══════════════════');

    const uniq = (arr, keyf) => {
      const m = new Map();
      arr.forEach((x) => { const k = keyf(x); if (!m.has(k)) m.set(k, x); });
      return [...m.values()];
    };

    const c = uniq(agg.contrast, (x) => x.sel + x.color + x.fontSize);
    console.log('\n▸ کنتراست ناکافی (' + c.length + ' مورد یکتا):');
    c.slice(0, 12).forEach((x) => console.log(`   ${x.ratio}:1 (نیاز ${x.need}) — ${x.sel} ${x.color} ${x.fontSize}px « ${x.sample} »`));

    const t = uniq(agg.touch, (x) => x.sel + x.w + x.h);
    console.log('\n▸ هدف لمسی کوچک‌تر از ۴۴px (' + t.length + '):');
    t.slice(0, 12).forEach((x) => console.log(`   ${x.w}×${x.h} — ${x.sel} « ${x.text} »`));

    const f = uniq(agg.fontSize, (x) => x.sel + x.px);
    console.log('\n▸ فونت کوچک‌تر از ۱۲px (' + f.length + '):');
    f.slice(0, 10).forEach((x) => console.log(`   ${x.px}px — ${x.sel} « ${x.sample} »`));

    console.log('\n▸ عکس بدون alt: ' + agg.noAlt.length);
    const z = [...new Set(agg.zIndex.map((x) => x.z))].sort((a, b2) => a - b2);
    console.log('▸ مقادیر z-index استفاده‌شده: ' + z.join(', '));
    console.log('▸ پاراگراف با خط بلندتر از ۸۵ کاراکتر: ' + agg.lineLen.length);
    await ctx.close();
  }
  await b.close();
})();
