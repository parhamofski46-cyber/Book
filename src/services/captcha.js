'use strict';

const crypto = require('crypto');
const GLYPHS = require('../content/captcha-glyphs.json');

/**
 * کپچای صفحه‌ی ورود مدیر.
 * ==========================================================================
 *
 * چرا خودمان نوشتیم و از reCAPTCHA گوگل استفاده نکردیم:
 *  • سیاست امنیتی محتوای سایت (CSP) سخت‌گیر است و اسکریپت از دامنه‌ی
 *    بیرونی را بلاک می‌کند. برای reCAPTCHA باید CSP را سوراخ می‌کردیم —
 *    یعنی برای بستن یک در، در دیگری را باز کنیم.
 *  • هر بار باز شدن صفحه‌ی ورود، چند صد کیلوبایت جاوااسکریپت از سرور
 *    گوگل می‌آمد؛ روی اینترنت موبایل ایران کند و گاهی اصلاً در دسترس نیست.
 *  • کلید API می‌خواست و مالک باید حساب می‌ساخت.
 *
 * این نسخه: یک جمع ساده که جوابش فقط در نشست سرور است، تصویرش SVG است و
 * هیچ جاوااسکریپتی لازم ندارد.
 *
 * ⚠️ نکته‌ی مهم و صادقانه: رقم‌ها به‌صورت مسیر برداری (<path>) کشیده
 * می‌شوند، نه <text>. برای همین یک ربات عمومی — که فقط فرم‌ها را پر
 * می‌کند — نمی‌تواند عدد را از سورس صفحه بردارد. ولی مهاجمی که *مشخصاً*
 * همین سایت را هدف بگیرد، می‌تواند با OCR یا تطبیق مسیرها آن را بشکند.
 * سد اصلی در برابر حمله‌ی هدفمند، محدودیت تلاش ورود
 * (`login_attempts` در `src/middleware/auth.js`) است؛ کپچا لایه‌ی دوم
 * است، نه جایگزین آن.
 */

/** اعتبار هر پرسش: پنج دقیقه. بیشتر از این یعنی فرصت بیشتر برای حمله. */
const TTL_MS = 5 * 60 * 1000;

/** عدد تصادفی امن در بازه‌ی [min, max] */
function rnd(min, max) {
  return min + crypto.randomInt(max - min + 1);
}

/** رقم‌های لاتین و عربی را به لاتین برمی‌گرداند تا مقایسه‌ی جواب ساده شود */
function toLatinDigits(str) {
  return String(str)
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0)) // فارسی
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)); // عربی
}

/**
 * پرسش تازه می‌سازد و جوابش را در نشست می‌گذارد.
 * جواب هرگز به مرورگر فرستاده نمی‌شود.
 * @returns {{svg: string, label: string}}
 */
function issue(session) {
  // فقط جمع، و هر دو عدد یک‌رقمی: جواب حداکثر دورقمی می‌شود و کسی که
  // عجله دارد هم بدون فکر کردن جواب می‌دهد. هدف کپچا سخت‌کردن کار ربات
  // است، نه امتحان گرفتن از مالک مغازه.
  const a = rnd(2, 9);
  const b = rnd(2, 9);
  session.captcha = { answer: a + b, expires: Date.now() + TTL_MS };
  return {
    svg: renderSvg(String(a) + '+' + String(b)),
    label: 'حاصل جمع دو عددی که در تصویر می‌بینید را بنویسید',
  };
}

/**
 * جواب کاربر را می‌سنجد.
 *
 * پرسش در هر حالت — درست یا غلط — از نشست پاک می‌شود. بدون این، یک جوابِ
 * درست می‌توانست بارها برای تلاش‌های پیاپی رمز استفاده شود و کپچا عملاً
 * فقط یک‌بار سد راه مهاجم می‌شد.
 */
function verify(session, input) {
  const c = session && session.captcha;
  if (session) delete session.captcha;

  if (!c || typeof c.answer !== 'number') return false;
  if (Date.now() > c.expires) return false;

  const given = toLatinDigits(input || '').replace(/[^0-9]/g, '');
  if (!given) return false;
  return Number(given) === c.answer;
}

// ------------------------------------------------------------------ تصویر

const W = 190;
const H = 64;
const FONT_SIZE = 40;

/** یک عدد اعشاری کوتاه، برای اینکه SVG بی‌خودی بزرگ نشود */
const n = (x) => Math.round(x * 10) / 10;

/**
 * رشته را به SVG تبدیل می‌کند.
 *
 * هر نویسه با اندازه، چرخش و جابه‌جایی عمودی کمی متفاوت کشیده می‌شود و
 * چند خط و نقطه‌ی تصادفی هم روی تصویر می‌افتد. این‌ها تشخیص خودکار را
 * سخت می‌کنند بدون اینکه خواندنش برای آدم دشوار شود.
 *
 * علامت «+» در فونت نیست (فقط ارقام استخراج شده‌اند)، پس با دو خط
 * کشیده می‌شود.
 */
function renderSvg(text) {
  const scale = FONT_SIZE / GLYPHS.unitsPerEm;
  const parts = [];

  // پس‌زمینه + نویز
  parts.push(`<rect width="${W}" height="${H}" rx="10" fill="#f6f1ea"/>`);
  for (let i = 0; i < 5; i++) {
    const y1 = rnd(6, H - 6);
    const y2 = rnd(6, H - 6);
    parts.push(
      `<path d="M0 ${y1}Q${W / 2} ${rnd(0, H)} ${W} ${y2}" fill="none" ` +
        `stroke="rgba(120,90,60,.28)" stroke-width="${rnd(1, 2)}"/>`
    );
  }
  for (let i = 0; i < 26; i++) {
    parts.push(`<circle cx="${rnd(4, W - 4)}" cy="${rnd(4, H - 4)}" r="${rnd(1, 2)}" fill="rgba(120,90,60,.22)"/>`);
  }

  // چیدمان نویسه‌ها از چپ به راست (عدد در فارسی هم چپ‌به‌راست خوانده می‌شود)
  const chars = text.split('');
  const widths = chars.map((ch) =>
    ch === '+' ? FONT_SIZE * 0.75 : GLYPHS.glyphs[ch].adv * scale
  );
  const total = widths.reduce((s, w) => s + w, 0) + (chars.length - 1) * 6;
  let x = (W - total) / 2;
  const baseY = H / 2 + FONT_SIZE * 0.36;

  chars.forEach((ch, i) => {
    const rot = rnd(-16, 16);
    const dy = rnd(-4, 4);
    const cx = x + widths[i] / 2;
    const cy = baseY - FONT_SIZE * 0.3;
    const color = `rgb(${rnd(40, 80)},${rnd(30, 60)},${rnd(25, 55)})`;
    const t = `transform="rotate(${rot} ${n(cx)} ${n(cy)})"`;

    if (ch === '+') {
      const s = FONT_SIZE * 0.3;
      parts.push(
        `<g ${t} stroke="${color}" stroke-width="5" stroke-linecap="round">` +
          `<path d="M${n(cx - s)} ${n(cy + dy)}H${n(cx + s)}"/>` +
          `<path d="M${n(cx)} ${n(cy + dy - s)}V${n(cy + dy + s)}"/></g>`
      );
    } else {
      // مسیر فونت از پایین به بالا است، پس محور Y وارونه می‌شود
      parts.push(
        `<g ${t}><path d="${GLYPHS.glyphs[ch].d}" fill="${color}" ` +
          `transform="translate(${n(x)} ${n(baseY + dy)}) scale(${n(scale * 1000) / 1000} ${-n(scale * 1000) / 1000})"/></g>`
      );
    }
    x += widths[i] + 6;
  });

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" ` +
    `class="captcha-img" role="img" aria-label="پرسش امنیتی تصویری">${parts.join('')}</svg>`
  );
}

module.exports = { issue, verify, toLatinDigits };
