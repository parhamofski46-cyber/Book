'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');
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

/**
 * پوشه‌ی عکس‌های آپلودی.
 *
 * روی سرور معمولی همان public/uploads است. روی سرویس‌های ابری (لیارا و
 * مانند آن) که فایل‌سیستم با هر دیپلوی پاک می‌شود، باید یک «دیسک» به
 * سرویس وصل و مسیرش در متغیر محیطی UPLOAD_DIR داده شود، وگرنه عکس‌هایی
 * که مدیر آپلود کرده با اولین به‌روزرسانی از بین می‌روند.
 */
const PREFERRED_UPLOAD_DIR =
  process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'public', 'uploads');

/**
 * همان منطق «شکست نرم» پوشه‌ی داده (src/db/index.js را ببین): اگر مسیر
 * آپلود قابل نوشتن نبود، به پوشه‌ی موقت پناه می‌بریم تا آپلود عکس از پنل
 * دست‌کم کار کند، ولی هشدار می‌دهیم که عکس‌ها با دیپلوی بعدی پاک می‌شوند.
 */
function pickUploadDir() {
  try {
    fs.mkdirSync(PREFERRED_UPLOAD_DIR, { recursive: true });
    fs.accessSync(PREFERRED_UPLOAD_DIR, fs.constants.W_OK);
    return { dir: PREFERRED_UPLOAD_DIR, temporary: false, reason: '' };
  } catch (err) {
    const fallback = path.join(os.tmpdir(), 'foolad-iman-uploads');
    try {
      fs.mkdirSync(fallback, { recursive: true });
      return { dir: fallback, temporary: true, reason: err.message };
    } catch (err2) {
      // آپلود عکس اختیاری است — برنامه را نمی‌کشیم، فقط اعلام می‌کنیم.
      return { dir: PREFERRED_UPLOAD_DIR, temporary: false, reason: err.message, broken: true };
    }
  }
}

const pickedUpload = pickUploadDir();
const UPLOAD_DIR = pickedUpload.dir;

/** متن هشدار وضعیت ذخیره‌سازی عکس‌ها (اگر مشکلی هست)، وگرنه null. */
const UPLOAD_WARNING = pickedUpload.broken
  ? `پوشه‌ی عکس‌های آپلودی (${PREFERRED_UPLOAD_DIR}) قابل نوشتن نیست؛ آپلود عکس از پنل کار نمی‌کند.`
  : pickedUpload.temporary
    ? `عکس‌های آپلودی روی حافظه‌ی موقت (${UPLOAD_DIR}) ذخیره می‌شود و با هر به‌روزرسانی پاک خواهد شد.` +
      (process.env.UPLOAD_DIR
        ? ` مسیر تنظیم‌شده در UPLOAD_DIR قابل نوشتن نبود (${pickedUpload.reason}).`
        : ' متغیر محیطی UPLOAD_DIR تنظیم نشده (راهنما: LIARA.md).')
    : null;

if (UPLOAD_WARNING) console.error(`\n⚠️  ${UPLOAD_WARNING}\n`);

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

/**
 * رشته‌ی srcset برای واکنش‌گرا بودن عکس‌ها.
 *
 * @param {string} basename نام پایه‌ی فایل
 * @param {number} [originalWidth] عرض عکس اصلی (ستون width در product_images)
 *
 * ⚠️ چرا originalWidth مهم است: هنگام ساخت نسخه‌ها از withoutEnlargement
 * استفاده می‌شود، یعنی عکسی که اصلش ۵۰۰ پیکسل است در هر سه نسخه ۵۰۰ پیکسل
 * می‌ماند. اگر بدون توجه به این موضوع در srcset بنویسیم «۱۶۰۰w»، مرورگر
 * باور می‌کند فایل ۱۶۰۰ پیکسلی در دست دارد، آن را برای جای بزرگ انتخاب
 * می‌کند و نتیجه یک عکس تارِ کش‌آمده است. با دانستن عرض اصلی، عرض واقعی هر
 * نسخه min(اندازه‌ی هدف، عرض اصلی) است و نسخه‌های تکراری هم حذف می‌شوند.
 */
function imageSrcset(basename, originalWidth) {
  if (!basename) return '';
  const seen = new Set();
  const parts = [];
  for (const [label, target] of Object.entries(SIZES)) {
    const actual = originalWidth ? Math.min(target, originalWidth) : target;
    if (seen.has(actual)) continue; // نسخه‌ی هم‌عرض تکراری به مرورگر ندهیم
    seen.add(actual);
    parts.push(`${imageUrl(basename, label)} ${actual}w`);
  }
  return parts.join(', ');
}

module.exports = {
  processUpload,
  deleteImageFiles,
  imageUrl,
  imageSrcset,
  UPLOAD_DIR,
  UPLOAD_WARNING,
  SIZES,
};
