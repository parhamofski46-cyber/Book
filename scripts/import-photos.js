#!/usr/bin/env node
'use strict';

/**
 * وارد کردن عکس واقعی محصولات به سایت
 * ==========================================================================
 * استفاده:
 *   node scripts/import-photos.js ghouti=/path/عکس-قوطی.jpg rabis=/path/rabis.jpg
 *
 * برای هر عکس، چند نسخه با عرض‌های مختلف در قالب WebP ساخته می‌شود و در
 * public/img/photos/ ذخیره می‌گردد؛ مرورگر خودش مناسب‌ترین اندازه را برای
 * صفحه‌ی کاربر برمی‌دارد (روی گوشی نسخه‌ی کوچک، روی دسکتاپ نسخه‌ی بزرگ).
 *
 * چرا اینجا و نه پوشه‌ی uploads؟
 * پوشه‌ی public/uploads/ عمداً در گیت نیست (عکس‌هایی که مدیر از پنل آپلود
 * می‌کند روی سرور می‌مانند). ولی این عکس‌ها بخشی از خودِ سایت‌اند و باید
 * همراه کد روی سرور بروند، پس در public/img/photos/ که تحت گیت است ذخیره
 * می‌شوند. مدیر بعداً می‌تواند از پنل عکس بهتری آپلود کند؛ عکس آپلودی
 * همیشه بر این‌ها اولویت دارد.
 *
 * ⚠️ هرگز عکس را بزرگ‌تر از اندازه‌ی اصلی نمی‌سازیم. بزرگ‌کردن، کیفیت را
 * بالا نمی‌برد و فقط حجم فایل و تاری را زیاد می‌کند.
 */

const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const OUT_DIR = path.join(__dirname, '..', 'public', 'img', 'photos');

// عرض‌های هدف. هر کدام که از عرض عکس اصلی بزرگ‌تر باشد ساخته نمی‌شود و
// به‌جایش خودِ عرض اصلی به فهرست اضافه می‌گردد.
const TARGET_WIDTHS = [400, 800, 1600];

// ۸۸ برای عکس واقعی نقطه‌ی خوبی است: جزئیات (رزوه‌ی پیچ، بافت توری) حفظ
// می‌شود ولی حجم پایین می‌ماند.
const WEBP_QUALITY = 88;

async function importOne(key, srcPath) {
  if (!/^[a-z0-9-]+$/.test(key)) {
    throw new Error(`کلید «${key}» باید فقط حروف کوچک انگلیسی، عدد و خط تیره باشد.`);
  }
  if (!fs.existsSync(srcPath)) throw new Error(`فایل پیدا نشد: ${srcPath}`);

  const meta = await sharp(srcPath).metadata();
  if (!meta.width || !meta.height) throw new Error(`فایل معتبر نیست: ${srcPath}`);

  const widths = [...new Set(TARGET_WIDTHS.filter((w) => w < meta.width).concat(meta.width))].sort(
    (a, b) => a - b
  );

  const made = [];
  for (const w of widths) {
    const pipeline = sharp(srcPath).rotate(); // rotate() = اصلاح چرخش EXIF
    if (w < meta.width) {
      // بعد از کوچک‌کردن، یک شارپ ملایم لبه‌ها را دوباره واضح می‌کند
      pipeline.resize({ width: w, withoutEnlargement: true }).sharpen({ sigma: 0.5 });
    }
    const file = path.join(OUT_DIR, `${key}-${w}.webp`);
    await pipeline.webp({ quality: WEBP_QUALITY, effort: 6 }).toFile(file);
    made.push({ w, bytes: fs.statSync(file).size });
  }

  return { key, src: meta.width + '×' + meta.height, made };
}

(async () => {
  const args = process.argv.slice(2);
  if (!args.length) {
    console.error('استفاده: node scripts/import-photos.js <کلید>=<مسیر فایل> ...');
    process.exit(1);
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });

  for (const arg of args) {
    const i = arg.indexOf('=');
    if (i < 1) {
      console.error(`آرگومان نامعتبر: ${arg}`);
      process.exit(1);
    }
    const key = arg.slice(0, i);
    const src = arg.slice(i + 1);
    try {
      const r = await importOne(key, src);
      const list = r.made.map((m) => `${m.w}px (${Math.round(m.bytes / 1024)}KB)`).join('، ');
      console.log(`✓ ${r.key.padEnd(18)} اصلی ${r.src}  →  ${list}`);
    } catch (err) {
      console.error(`✗ ${key}: ${err.message}`);
      process.exitCode = 1;
    }
  }
})();
