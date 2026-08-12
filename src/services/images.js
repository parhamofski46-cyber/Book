'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');

/**
 * پردازش عکس‌های آپلودشده
 * ------------------------------------------------------------------
 * هر عکسی که از پنل مدیریت آپلود شود، به‌صورت خودکار:
 *   ۱) چرخش درست می‌شود (بر اساس اطلاعات EXIF دوربین/موبایل)
 *   ۲) در سه سایز تولید می‌شود: thumb (گرید)، medium (موبایل)، large (صفحه‌ی محصول)
 *   ۳) با فرمت WebP و کیفیت بالا ذخیره می‌شود (حجم کم، جزئیات حفظ‌شده)
 * نتیجه: طرح‌های ظریف فرفورژه واضح دیده می‌شوند ولی سایت سنگین نمی‌شود.
 */

const UPLOAD_DIR = path.join(__dirname, '..', '..', 'public', 'uploads');
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// سایزهای تولیدی (عرض بر حسب پیکسل)
const SIZES = {
  thumb: 400, // کارت محصول در گرید
  medium: 800, // موبایل / تبلت
  large: 1600, // صفحه‌ی جزئیات محصول و گالری
};

// کیفیت WebP — ۸۶ نقطه‌ی تعادل خوبی بین وضوح جزئیات و حجم فایل است
const WEBP_QUALITY = 86;

/**
 * نام یکتای فایل بر اساس زمان + رشته‌ی تصادفی.
 * عمداً فقط از حروف انگلیسی و عدد استفاده می‌شود: نام فایل فارسی روی بعضی
 * هاست‌ها، FTPها و سیستم‌های پشتیبان‌گیری خراب می‌شود.
 */
function makeBasename(hint = 'img') {
  const safe =
    String(hint)
      .replace(/[^a-zA-Z0-9]+/g, '-') // فقط حروف لاتین و عدد
      .replace(/^-+|-+$/g, '')
      .slice(0, 24)
      .toLowerCase() || 'photo';
  const rand = crypto.randomBytes(4).toString('hex');
  return `${safe}-${Date.now().toString(36)}-${rand}`;
}

/**
 * پردازش و ذخیره‌ی یک عکس.
 * @param {Buffer} buffer محتوای فایل آپلودشده
 * @param {string} nameHint بخشی از نام فایل (معمولاً نام محصول)
 * @returns {Promise<{basename: string, width: number, height: number}>}
 */
async function processUpload(buffer, nameHint) {
  const basename = makeBasename(nameHint);
  const image = sharp(buffer, { failOn: 'none' }).rotate(); // rotate() = اصلاح چرخش EXIF
  const meta = await image.metadata();

  if (!meta.width || !meta.height) {
    throw new Error('فایل ارسالی یک عکس معتبر نیست.');
  }

  for (const [label, width] of Object.entries(SIZES)) {
    // اگر عکس اصلی از سایز هدف کوچک‌تر است، بزرگش نمی‌کنیم (withoutEnlargement)
    await sharp(buffer, { failOn: 'none' })
      .rotate()
      .resize({ width, withoutEnlargement: true })
      .webp({ quality: WEBP_QUALITY, effort: 5 })
      .toFile(path.join(UPLOAD_DIR, `${basename}-${label}.webp`));
  }

  return { basename, width: meta.width, height: meta.height };
}

/** حذف همه‌ی سایزهای یک عکس از دیسک */
function deleteImageFiles(basename) {
  if (!basename || /[\\/]/.test(basename)) return; // محافظت در برابر path traversal
  for (const label of Object.keys(SIZES)) {
    const file = path.join(UPLOAD_DIR, `${basename}-${label}.webp`);
    fs.rm(file, { force: true }, () => {});
  }
}

/** آدرس عمومی یک سایز مشخص از عکس */
function imageUrl(basename, size = 'medium') {
  if (!basename) return '/img/placeholder.svg';
  return `/uploads/${basename}-${size}.webp`;
}

/** رشته‌ی srcset برای واکنش‌گرا بودن عکس‌ها */
function imageSrcset(basename) {
  if (!basename) return '';
  return Object.entries(SIZES)
    .map(([label, width]) => `${imageUrl(basename, label)} ${width}w`)
    .join(', ');
}

module.exports = { processUpload, deleteImageFiles, imageUrl, imageSrcset, UPLOAD_DIR, SIZES };
